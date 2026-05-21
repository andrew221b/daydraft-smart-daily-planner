import { supabase } from "@/integrations/supabase/client";
import { recordAiCall } from "@/lib/perfMonitor";

/**
 * Streaming wrapper for Supabase Edge Functions.
 *
 * Designed so the edge function can opt in to streaming (NDJSON: one
 * newline-delimited JSON object per chunk) without breaking existing
 * non-streaming callers.
 *
 * Usage on the client:
 *
 *   await streamAi("generate-plan", payload, {
 *     onBlock: (b) => appendOptimisticBlock(b),
 *     onDone:  (final) => persistPlan(final),
 *   });
 *
 * Server-side (edge function) opts in by returning
 * `Content-Type: application/x-ndjson` and writing `JSON.stringify(obj) + "\n"`
 * for each block; the final summary object goes last with `{ done: true, ... }`.
 *
 * If the response isn't NDJSON (older edge function version, or any
 * non-streaming function), we fall back to parsing the whole body as JSON
 * and surfacing `{ blocks: [...] }` chunks via `onBlock`, then `onDone` with
 * the full payload. So callers can adopt this helper without depending on
 * server-side changes landing first.
 */
export type StreamOptions<TBlock = unknown, TFinal = unknown> = {
  onBlock?: (block: TBlock, index: number) => void;
  onDone?: (final: TFinal) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

async function authHeader(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? `Bearer ${token}` : ANON_KEY ? `Bearer ${ANON_KEY}` : null;
  } catch {
    return ANON_KEY ? `Bearer ${ANON_KEY}` : null;
  }
}

export async function streamAi<TBlock = any, TFinal = any>(
  functionName: string,
  body: unknown,
  options: StreamOptions<TBlock, TFinal> = {},
): Promise<TFinal | null> {
  if (!SUPABASE_URL || !ANON_KEY) {
    options.onError?.(new Error("Supabase env missing"));
    return null;
  }
  const url = `${SUPABASE_URL}/functions/v1/${functionName}`;
  const auth = await authHeader();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    accept: "application/x-ndjson, application/json",
  };
  if (auth) headers.Authorization = auth;

  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    options.onError?.(err);
    return null;
  }

  if (!response.ok) {
    const err = new Error(`${functionName} failed: ${response.status}`);
    options.onError?.(err);
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const isStream =
    contentType.includes("application/x-ndjson") || contentType.includes("text/event-stream");

  try {
    if (isStream && response.body) {
      const final = await consumeNdjson<TBlock, TFinal>(response.body, options);
      return final;
    }
    // Fallback: non-streaming response. Replay it as a single-chunk stream
    // so callers see the same callback shape.
    const json = (await response.json()) as { blocks?: TBlock[] } & TFinal;
    if (Array.isArray(json?.blocks)) {
      json.blocks.forEach((b: TBlock, i: number) => options.onBlock?.(b, i));
    }
    options.onDone?.(json as TFinal);
    return json as TFinal;
  } catch (e) {
    options.onError?.(e instanceof Error ? e : new Error(String(e)));
    return null;
  } finally {
    const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordAiCall(`${functionName}:stream`, ended - started);
  }
}

async function consumeNdjson<TBlock, TFinal>(
  body: ReadableStream<Uint8Array>,
  options: StreamOptions<TBlock, TFinal>,
): Promise<TFinal | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let blockIndex = 0;
  let final: TFinal | null = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try {
            const obj = JSON.parse(line);
            if (obj && obj.done) {
              final = obj as TFinal;
            } else {
              options.onBlock?.(obj as TBlock, blockIndex++);
            }
          } catch {
            /* skip malformed line — server should be well-behaved */
          }
        }
        nl = buffer.indexOf("\n");
      }
    }
    // Tail flush.
    const tail = buffer.trim();
    if (tail) {
      try {
        const obj = JSON.parse(tail);
        if (obj?.done) final = obj as TFinal;
        else options.onBlock?.(obj as TBlock, blockIndex++);
      } catch {
        /* ignore */
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  if (final) options.onDone?.(final);
  return final;
}
