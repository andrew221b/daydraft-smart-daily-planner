import { corsHeaders } from "../_shared/cors.ts";
import { DAYDRAFT_PERSONA } from "../_shared/persona.ts";

const SYSTEM = `${DAYDRAFT_PERSONA}

You are in open conversation with the user right now — they may ask anything.

When context prefixed "Context (not shown to user):" is present, use it to personalise your answer naturally. Never quote it back, never say "I see that you…" or "Based on your context". Just know it and talk accordingly — that quiet familiarity is what makes you feel close.

Answer any question the user asks — planning, general, creative, personal. If it's not about planning, answer it fully and only tie it back to time/focus if it fits naturally. Don't force the connection.

Keep replies short by default: 2–4 sentences for most things. Use bullet points only for actual lists of steps or options. No headers, no padded summaries. Give honest opinions — say plainly when something sounds hard or unrealistic; pretending everything is easy is a quiet form of disrespect. End without a follow-up question unless it genuinely moves the conversation forward.

If the user's input is completely unintelligible gibberish or random letters (e.g., "asdfasdf"), do not invent a meaning. Just gently ask if their keyboard slipped or tell them you didn't quite catch that.`;

/** Models to try, in order. Falls back to a cheaper/older model when the
 *  preferred one is overloaded or rate-limited so the user still gets an answer
 *  instead of an error toast. */
const MODEL_CHAIN = ["gemini-2.5-flash", "gemini-1.5-flash-latest"];

/** Errors worth a quick retry. Gemini sometimes 503s / 500s transiently. */
const isTransient = (status: number) => status === 500 || status === 502 || status === 503 || status === 504;

/** Sleep helper for backoff. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call Gemini once. Returns the raw Response (caller decides retry / fallback). */
async function callGemini(model: string, payloadMessages: unknown, apiKey: string, signal: AbortSignal): Promise<Response> {
  return fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: payloadMessages,
    }),
    signal,
  });
}

/** User-facing error message derived from Gemini's response status/body. */
function explainError(status: number, body: string): { msg: string; clientStatus: number } {
  if (status === 429 || /quota|rate.?limit/i.test(body)) {
    return { msg: "Too many requests — give it a moment and try again.", clientStatus: 429 };
  }
  if (status === 401 || status === 403) {
    return { msg: "AI is misconfigured on the server. Please contact support.", clientStatus: 500 };
  }
  if (status === 400 && /safety|blocked|harm/i.test(body)) {
    return { msg: "That question hit a safety filter — try rephrasing.", clientStatus: 400 };
  }
  if (status === 400) {
    return { msg: "AI didn't understand the request. Try rephrasing.", clientStatus: 400 };
  }
  if (isTransient(status)) {
    return { msg: "AI is having a moment. Please try again.", clientStatus: 503 };
  }
  return { msg: "AI couldn't respond. Please try again.", clientStatus: 500 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Per-request hard ceiling so a hanging upstream doesn't leave the client
  // spinning forever. Streaming responses can legitimately take up to ~45s for
  // longer generations; pick a comfortable upper bound.
  const controller = new AbortController();
  const requestTimeout = setTimeout(() => controller.abort(), 55_000);
  // Forward client disconnects to Gemini so we stop billing tokens for an
  // answer nobody will see.
  req.signal.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      console.error("[ai-assist] GEMINI_API_KEY missing");
      return new Response(JSON.stringify({ error: "AI is misconfigured on the server. Please contact support." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const personalContext = typeof body?.personalContext === "string" ? body.personalContext.trim().slice(0, 2000) : "";
    const seedContext = typeof body?.seedContext === "string" ? body.seedContext.trim().slice(0, 2000) : "";
    if (!messages.length) {
      return new Response(JSON.stringify({ error: "Tell me what you want to ask." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemParts = [SYSTEM];
    if (personalContext) {
      systemParts.push(`\nUSER CONTEXT (background, never quote back):\n${personalContext}`);
    }
    if (seedContext) {
      systemParts.push(`\nCURRENT MOMENT (background, never quote back):\n${seedContext}`);
    }
    const systemPrompt = systemParts.join("\n");

    const safeMessages = messages
      .filter((m: any) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
      .slice(-15)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

    const payloadMessages = [{ role: "system", content: systemPrompt }, ...safeMessages];

    // Try each model with one retry per transient error. Total worst case is
    // 2 models × 2 attempts = 4 calls, capped by the 55s outer timeout above.
    let lastStatus = 0;
    let lastBody = "";
    for (const model of MODEL_CHAIN) {
      for (let attempt = 0; attempt < 2; attempt++) {
        // Abort-aware: if the user already disconnected, bail.
        if (controller.signal.aborted) {
          throw new Error("Request cancelled");
        }
        const resp = await callGemini(model, payloadMessages, GEMINI_API_KEY, controller.signal);

        if (resp.ok) {
          // Successful stream — pipe straight through. Clear the timeout: once
          // streaming starts, the platform's response lifetime takes over.
          clearTimeout(requestTimeout);
          return new Response(resp.body, {
            headers: {
              ...corsHeaders,
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "X-Ai-Model": model,
            },
          });
        }

        // Drain body for log + diagnostics. Up to 1KB is plenty.
        lastStatus = resp.status;
        try {
          const txt = await resp.text();
          lastBody = txt.slice(0, 1024);
        } catch {
          lastBody = "";
        }
        console.error("[ai-assist] upstream error", { model, attempt, status: resp.status, body: lastBody });

        // Rate limit → don't retry same model, but try next model.
        if (resp.status === 429) break;
        // Auth/config errors → fail fast.
        if (resp.status === 401 || resp.status === 403) break;
        // 4xx (other than 429) → user input issue, retrying won't help.
        if (resp.status >= 400 && resp.status < 500) break;
        // 5xx transient → quick backoff then retry once.
        if (isTransient(resp.status) && attempt === 0) {
          await sleep(400 + Math.floor(Math.random() * 300));
          continue;
        }
        // Otherwise stop attempting this model.
        break;
      }
    }

    const { msg, clientStatus } = explainError(lastStatus, lastBody);
    return new Response(JSON.stringify({ error: msg }), {
      status: clientStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const aborted = req.signal.aborted || /cancel|abort/i.test(raw);
    if (aborted) {
      return new Response(JSON.stringify({ error: "Request cancelled." }), {
        status: 499,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("[ai-assist] handler crash", raw);
    return new Response(JSON.stringify({ error: "AI couldn't respond. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    clearTimeout(requestTimeout);
  }
});
