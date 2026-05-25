import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { blocks, energy_preference, ai_tone, ai_tone_custom } = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
    const summary = (blocks || []).map((b: any) => `${b.start_time} ${b.title} (${b.type}, ${b.duration_min}min) ${b.completed ? "✓" : "✗"}`).join("\n");
    const toneMap: Record<string, string> = {
      professional: "Use concise professional language. Prioritize clarity and specific recommendations. No emojis.",
      coach: "Use supportive coach language with concrete encouragement and one actionable recommendation.",
      playful: "Use light friendly language while staying clear and practical. Max one subtle emoji.",
      motivational: "Use energetic, momentum-focused language with clear action framing.",
      tough_love: "Use direct accountability language, firm but respectful. No emojis.",
      philosophical: "Use reflective language with a practical takeaway. Avoid abstract wording without action.",
    };
    const toneLine = ai_tone === "custom" && ai_tone_custom
      ? `Use this custom tone: ${String(ai_tone_custom).slice(0, 250)}. Keep it practical and concise.`
      : (toneMap[ai_tone] || toneMap.professional);

    const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-1.5-flash",
        messages: [
          { role: "system", content: `You are a focused productivity coach. Given a user's day with energy preference "${energy_preference}", return ONE concise insight (1-2 sentences max) reflecting on what worked plus one specific suggestion for tomorrow.
${toneLine}
Plain text only.` },
          { role: "user", content: `Today:\n${summary}` },
        ],
      }),
    });
    if (!resp.ok) {
      if (resp.status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resp.status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI ${resp.status}`);
    }
    const data = await resp.json();
    const insight = data.choices?.[0]?.message?.content?.trim() || "Solid day. Keep your peak hours protected tomorrow.";
    return new Response(JSON.stringify({ insight }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
