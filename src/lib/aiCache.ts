import { supabase } from "@/integrations/supabase/client";
import {
  recordAiCacheHit,
  recordAiCacheMiss,
  recordAiCall,
} from "./perfMonitor";

/**
 * Cached + deduplicated invocation wrapper for our Supabase Edge Functions.
 *
 *   const { data, error } = await invokeAiCached("generate-plan", payload, {
 *     ttlMs: 60_000,             // memoize identical requests for 60s
 *     persistMs: 7 * 86_400_000, // also persist to localStorage for 7 days
 *     cacheKey: ...,             // override the auto-derived key if needed
 *   });
 *
 * Three layers:
 *
 *   1. In-flight deduplication. If the same payload is in flight already,
 *      hand back the same Promise. Saves a roundtrip on double-tap and on
 *      transient duplicate calls from race conditions.
 *
 *   2. In-memory TTL cache. Identical requests within `ttlMs` return the
 *      cached response. Stays warm across tab switches but resets on
 *      reload.
 *
 *   3. Optional persistent layer (localStorage) with its own TTL. Use this
 *      for outputs that are stable across reloads — weekly digests,
 *      monthly reports, PDF narratives.
 *
 * All durations are tracked via perfMonitor so the debug panel can show
 * cache hit ratio + p95 call duration.
 */

type InvokeResult<T = unknown> = {
  data: T | null;
  error: { message: string; [k: string]: unknown } | null;
};

type CacheEntry<T = unknown> = {
  data: T;
  expiresAt: number;
};

type Options = {
  /** In-memory cache lifetime. 0 disables the memory layer. */
  ttlMs?: number;
  /** Persistent (localStorage) cache lifetime. 0 disables persistence. */
  persistMs?: number;
  /** Override the auto-derived cache key. */
  cacheKey?: string;
  /** Per-call timeout — aborts the request when exceeded. */
  timeoutMs?: number;
  /**
   * Caller-supplied AbortSignal. When it fires we *stop waiting* for the
   * result and return `{ data: null, error: { aborted: true } }`. The
   * underlying network request keeps running so other in-flight observers
   * (and the cache) still benefit — only this caller hands back early.
   * Pass a signal tied to your component's lifecycle to prevent
   * "set-state-after-unmount" warnings when the user navigates away
   * mid-call.
   */
  signal?: AbortSignal;
};

const ABORT_ERROR = { message: "aborted", aborted: true } as const;

/**
 * Is this the class of error that means "we never actually reached the
 * server" (offline blip, DNS hiccup, cold edge function refusing the
 * connection) rather than a real response the backend sent us? This is the
 * one category safe to silently retry — a fast failure, not a slow timeout,
 * and not a deliberate error from the AI itself (rate limit, safety refusal,
 * validation). Shared so the retry decision here and the "friendly message"
 * classification at each call site can never drift apart.
 */
export function isNetworkError(message: string | null | undefined): boolean {
  return /Load failed|Failed to fetch|NetworkError|TypeError|net::|ENOTFOUND|ECONNREFUSED|Failed to send a request/i.test(
    message || "",
  );
}

/**
 * fetch() with one silent retry when the connection itself fails (the class
 * `isNetworkError` matches) — covers the common "cold edge function" or
 * "flaky cell handoff" blip that would otherwise surface as a scary
 * "couldn't reach AI" toast on the very first try. Never retries a call the
 * caller has already cancelled (component unmounted / user navigated away),
 * and never retries a real HTTP response (non-2xx) — only a fetch() that
 * threw with a network-class error. Caveat: fetch can throw AFTER the server
 * already accepted the request (body sent, response headers never arrived —
 * TLS reset, iOS cell handoff), so the retry may re-run a POST whose side
 * effects (ai-assist rate-limit tick, Gemini tokens) already happened. Rare
 * and cheap for our endpoints; a proper fix is an idempotency key + edge
 * dedupe if this ever matters.
 */
export async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    const signal = init.signal as AbortSignal | undefined;
    const msg = e instanceof Error ? e.message : String(e);
    if (signal?.aborted || !isNetworkError(msg)) throw e;
    await new Promise((r) => setTimeout(r, 600));
    if (signal?.aborted) throw e;
    return fetch(input, init);
  }
}

/**
 * Resolve with whichever happens first: the underlying promise, or the
 * caller's signal firing. Used so an unmounted React component can stop
 * caring about an AI response without cancelling the shared request for
 * other consumers.
 */
function settleWithSignal<T>(p: Promise<InvokeResult<T>>, signal?: AbortSignal): Promise<InvokeResult<T>> {
  if (!signal) return p;
  if (signal.aborted) return Promise.resolve({ data: null, error: { ...ABORT_ERROR } });
  return new Promise<InvokeResult<T>>((resolve) => {
    let done = false;
    const finish = (val: InvokeResult<T>) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", onAbort);
      resolve(val);
    };
    const onAbort = () => finish({ data: null, error: { ...ABORT_ERROR } });
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(finish).catch((e: unknown) => {
      finish({ data: null, error: { message: e instanceof Error ? e.message : String(e) } });
    });
  });
}

const DEFAULT_TTL_MS = 30_000;
const memCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<InvokeResult<unknown>>>();

const PERSIST_PREFIX = "dd_ai_cache:";

function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value)[k])}`).join(",")}}`;
}

function deriveKey(name: string, body: unknown): string {
  return `${name}:${djb2(stableStringify(body))}`;
}

function readPersistent<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(PERSIST_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writePersistent<T>(key: string, data: T, ttlMs: number): void {
  try {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
    localStorage.setItem(PERSIST_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota exceeded — best effort */
  }
}

export async function invokeAiCached<T = unknown>(
  name: string,
  body: unknown,
  options: Options = {},
): Promise<InvokeResult<T>> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const persistMs = options.persistMs ?? 0;
  const key = options.cacheKey ?? deriveKey(name, body);

  // 1. memory layer
  if (ttlMs > 0) {
    const hit = memCache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      recordAiCacheHit();
      return { data: hit.data as T, error: null };
    }
  }

  // 2. persistent layer
  if (persistMs > 0) {
    const persisted = readPersistent<T>(key);
    if (persisted !== null) {
      recordAiCacheHit();
      // promote to memory cache so subsequent hits skip JSON.parse
      memCache.set(key, { data: persisted, expiresAt: Date.now() + Math.min(ttlMs || persistMs, persistMs) });
      return { data: persisted, error: null };
    }
  }

  // 3. dedup in-flight
  const existing = inflight.get(key);
  if (existing) {
    recordAiCacheHit();
    return settleWithSignal(existing as Promise<InvokeResult<T>>, options.signal);
  }

  recordAiCacheMiss();
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();

  // One attempt: fresh AbortController per try, timed independently so a
  // retry gets the same budget as the first attempt rather than whatever's
  // left over. Reports whether ITS OWN timeout fired (as opposed to the
  // caller's signal, or a genuine connect failure) — a timeout means the
  // server was slow, not unreachable, and isn't worth silently retrying at
  // the same timeoutMs (that would just double the worst-case wait).
  const attempt = async (): Promise<{ result: InvokeResult<T>; timedOut: boolean }> => {
    let controller: AbortController | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (options.timeoutMs && options.timeoutMs > 0) {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller?.abort(), options.timeoutMs);
    }
    try {
      const invokeOpts: Record<string, unknown> = { body };
      if (controller) invokeOpts.signal = controller.signal;
      const { data, error } = await supabase.functions.invoke(name, invokeOpts as { body: unknown });
      return { result: { data: (data as T) ?? null, error: error ?? null }, timedOut: controller?.signal.aborted ?? false };
    } catch (e) {
      return {
        result: { data: null, error: { message: e instanceof Error ? e.message : String(e) } },
        timedOut: controller?.signal.aborted ?? false,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const runner = (async (): Promise<InvokeResult<T>> => {
    try {
      let outcome = await attempt();
      // A fast connect-level failure (offline blip, cold edge function) gets
      // one silent retry before we give up — this is the fix for "couldn't
      // reach AI" firing on the very first hiccup. Not for our own timeout
      // (server was slow, not unreachable) and not once the caller has
      // already stopped caring (component unmounted / user moved on).
      if (outcome.result.error && !outcome.timedOut && !options.signal?.aborted && isNetworkError(outcome.result.error.message)) {
        await new Promise((r) => setTimeout(r, 600));
        if (!options.signal?.aborted) {
          outcome = await attempt();
        }
      }
      const result = outcome.result;
      if (result.data != null) {
        if (ttlMs > 0) memCache.set(key, { data: result.data, expiresAt: Date.now() + ttlMs });
        if (persistMs > 0) writePersistent(key, result.data, persistMs);
      }
      return result;
    } finally {
      const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
      recordAiCall(name, ended - started);
      inflight.delete(key);
    }
  })();

  inflight.set(key, runner as Promise<InvokeResult<unknown>>);
  return settleWithSignal(runner, options.signal);
}

/** Forget a specific cache entry (or all entries when `name` is omitted). */
export function invalidateAiCache(name?: string): void {
  if (!name) {
    memCache.clear();
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PERSIST_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    return;
  }
  for (const k of Array.from(memCache.keys())) {
    if (k.startsWith(name + ":")) memCache.delete(k);
  }
  try {
    const prefix = PERSIST_PREFIX + name + ":";
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
