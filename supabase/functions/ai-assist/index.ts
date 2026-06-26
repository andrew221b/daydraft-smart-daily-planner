import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "../_shared/cors.ts";
import { DAYDRAFT_PERSONA } from "../_shared/persona.ts";
import { callGeminiWithRetry, isTransientStatus } from "../_shared/geminiRetry.ts";

// Burst guard, not a daily cap — see migration 20260625223726. Generous
// enough that no real chat session ever brushes it; tight enough to choke a
// script hammering the endpoint.
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;

const SYSTEM = `${DAYDRAFT_PERSONA}

You are in open conversation with the user right now — they may ask anything.

When a context block (e.g. "ABOUT THE USER" or "CURRENT MOMENT") is present, use it to personalise your answer naturally. Never quote it back, never say "I see that you…" or "Based on your context". Just talk as if you know it. But personalising means using what is ACTUALLY in that block — not inventing more. If the context doesn't contain a fact, you don't have it: don't name a person, place, or past event the user never gave you, and never imply you remember an earlier chat (you don't — see GROUNDING in your persona). When you'd need a detail you don't have, ask one short question instead of fabricating one.

Answer any question the user asks — planning, general, creative, personal. If it's not about planning, answer it fully and only tie it back to time/focus if it fits naturally. Don't force the connection.

When they ask you to look at their day — what to start with, where it's weak, whether it's realistic, where a break fits — actually read the schedule in the context block and answer about THAT specific day: name the real tasks and times, point at the actual pressure point, and commit to one concrete recommendation. "Your two deep-work blocks are stacked back-to-back before lunch with no buffer — move the second to 2pm" is the job. Generic planning wisdom that ignores what's actually on their plate is the failure mode to avoid; if two people with different days could get the same answer from you, you didn't look hard enough.

Not every message is a real question. If the input is gibberish or random letters ("asdfgh", "фывафыва"), makes no logical sense, or is purely insults, swearing, or a provocation aimed at you — do NOT invent a meaning for it, and do NOT get defensive, offended, or preachy. Read it for what it most likely is — a slipped keyboard, a test, or someone blowing off steam — name that in one light, unbothered line, and offer to actually help with their day. Stay calm and a little dry; never lecture or moralize. Exception: when swearing is just the emotional colour on a real request ("блин, помоги уже спланировать день"), ignore the heat and answer the real thing.

Keep replies short by default: 2–4 sentences for most things. Use bullet points only for actual lists of steps or options. No headers, no padded summaries. Give honest opinions — say plainly when something sounds hard or unrealistic; pretending everything is easy is a quiet form of disrespect. End without a follow-up question unless it genuinely moves the conversation forward.`;

// Model chain + transient-retry now live in _shared/geminiRetry.ts.

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
    const detail = typeof body === "string" ? body.trim().slice(0, 150) : "";
    return { msg: `AI rejected the request: ${detail || "Bad request"}.`, clientStatus: 400 };
  }
  if (isTransientStatus(status)) {
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

    // Require a real signed-in user — no falling back to the public anon
    // key, which ships inside the app bundle and would otherwise let anyone
    // hit this (now Pro-model) endpoint with zero attribution.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Sign in to use AI chat." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) {
      return new Response(JSON.stringify({ error: "Sign in to use AI chat." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Burst guard (see RATE_LIMIT_* above + migration 20260625223726). Fail
    // OPEN on an infra error so a Postgres hiccup never blocks a real user —
    // only a confirmed "too many requests" verdict returns 429.
    const { data: withinLimit, error: rateLimitError } = await supabase.rpc("check_ai_rate_limit", {
      p_max_requests: RATE_LIMIT_MAX_REQUESTS,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    if (rateLimitError) {
      console.error("[ai-assist] rate-limit check failed", rateLimitError.message);
    } else if (withinLimit === false) {
      return new Response(JSON.stringify({ error: "Slow down a bit — too many messages in a short time. Try again shortly." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    // `userFacts` is the compact background block the client assembles from the
    // in-memory profile + local time + lazily-fetched patterns. It supersedes
    // the older `personalContext` field (kept as a fallback for older clients).
    const userFacts = typeof body?.userFacts === "string" ? body.userFacts.trim().slice(0, 1200) : "";
    const personalContext = typeof body?.personalContext === "string" ? body.personalContext.trim().slice(0, 2000) : "";
    const aboutUser = userFacts || personalContext;
    const seedContext = typeof body?.seedContext === "string" ? body.seedContext.trim().slice(0, 2000) : "";
    if (!messages.length) {
      return new Response(JSON.stringify({ error: "Tell me what you want to ask." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemParts = [SYSTEM];
    if (aboutUser) {
      systemParts.push(`\nABOUT THE USER (quiet background, never quote back):\n${aboutUser}`);
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

    // Chat/Coach is the one surface where deeper reasoning is actually felt —
    // unlike the high-volume structured calls (parse-tasks, generate-plan),
    // so it runs on Pro first. Flash/Flash-lite stay as fallback if Pro errors
    // or quota-limits, so this never trades reliability for the upgrade.
    const CHAT_MODEL_CHAIN = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

    // Shared model-chain + transient-retry (incl 404/429), abort-aware. Streams
    // the OK response straight through; see _shared/geminiRetry.ts.
    const { response: resp, model: usedModel, lastStatus, lastBody } = await callGeminiWithRetry(
      (model) => callGemini(model, payloadMessages, GEMINI_API_KEY, controller.signal),
      {
        models: CHAT_MODEL_CHAIN,
        baseBackoffMs: 400,
        signal: controller.signal,
        onError: ({ model, attempt, status, body }) =>
          console.error("[ai-assist] upstream error", { model, attempt, status, body }),
      },
    );

    if (resp) {
      // Successful stream — pipe straight through. Clear the timeout: once
      // streaming starts, the platform's response lifetime takes over.
      clearTimeout(requestTimeout);
      return new Response(resp.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Ai-Model": usedModel ?? "",
        },
      });
    }

    // No model succeeded. If the client disconnected mid-flight, surface that.
    if (controller.signal.aborted) throw new Error("Request cancelled");

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
