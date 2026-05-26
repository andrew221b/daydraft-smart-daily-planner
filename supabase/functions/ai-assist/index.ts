import { corsHeaders } from "../_shared/cors.ts";

const SYSTEM = `You are a sharp, warm personal assistant living inside the user's daily planner. You help them think through their day — not by making decisions for them, but by being the smart friend who asks the right question or gives a grounded take.

Your strengths:
- Time estimates that feel honest ("that's probably 90 min, not 30")
- Breaking tasks into steps that are actually actionable
- Spotting the one thing that'll derail the day before it does
- Giving real opinions when asked, not just options

Tone: natural and direct. Like a smart colleague who knows your work style. Not a corporate chatbot. Not a cheerleader. If something sounds hard, say so. If a plan looks solid, say that too.

Format: conversational prose by default. Use a short list only when it genuinely helps (steps, comparisons). No markdown headers. Keep it tight — but don't cut yourself off if the answer needs room. Never say "I have created / scheduled / added" — you cannot touch the plan. End with a follow-up only when it moves the conversation forward.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (!messages.length) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        messages: [{ role: "system", content: SYSTEM }, ...safeMessages],
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