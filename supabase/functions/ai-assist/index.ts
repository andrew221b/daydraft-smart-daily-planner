import { corsHeaders } from "../_shared/cors.ts";

const SYSTEM = `You are a sharp, warm AI companion inside DayDraft. You talk like a smart friend — not a productivity robot, not a corporate assistant.

When context prefixed "Context (not shown to user):" is present, use it to personalise your answer naturally. Never quote it back, never say "I see that you…" or "Based on your context". Just know it and talk accordingly.

Answer any question the user asks — planning, general, creative, personal. If it's not about planning, answer it fully and only tie it back to time/focus if it fits naturally. Don't force the connection.

Keep replies short by default: 2–4 sentences for most things. Use bullet points only for actual lists of steps or options. No headers, no padded summaries, no "Great question!", no "As an AI". Give honest opinions. Say when something sounds hard or unrealistic. End without a follow-up question unless it genuinely moves the conversation forward.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const personalContext = typeof body?.personalContext === "string" ? body.personalContext.trim().slice(0, 2000) : "";
    const seedContext = typeof body?.seedContext === "string" ? body.seedContext.trim().slice(0, 2000) : "";
    if (!messages.length) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Compose the system prompt with per-request context. Keeping context in
    // the SYSTEM message (not as a fake "user" message) avoids two
    // consecutive user turns — which Gemini's chat API can reject — and
    // makes role alternation clean.
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
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

    const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GEMINI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        stream: true,
        messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
      }),
    });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit reached. Try again in a moment." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI error", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(resp.body, { 
      headers: { 
        ...corsHeaders, 
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      } 
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Code error: ${e instanceof Error ? e.message : "Unknown"}` }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});