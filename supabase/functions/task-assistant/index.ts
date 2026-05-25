import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { title, type, location, duration_min, ai_tone, ai_tone_custom, runtime_reason, ai_planning_rules } = await req.json();
    if (!title || typeof title !== "string") {
      return new Response(JSON.stringify({ error: "title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const toneMap: Record<string, string> = {
      professional: `Tone: concise and professional.
- Sentence style: short, neutral, concrete.
- Vocabulary: operational and direct.
- Constraints: no emojis, no hype.`,
      coach: `Tone: supportive coach.
- Sentence style: warm but specific.
- Vocabulary: encouragement + action verbs.
- Constraints: include one gentle encouragement phrase.`,
      playful: `Tone: light and friendly.
- Sentence style: crisp, upbeat.
- Vocabulary: approachable and energetic.
- Constraints: max one subtle emoji total.`,
      motivational: `Tone: intense and momentum-first.
- Sentence style: decisive, active voice.
- Vocabulary: strong verbs, urgency, commitment.
- Constraints: no vague motivational fluff.`,
      tough_love: `Tone: strict accountability.
- Sentence style: short, firm, directive.
- Vocabulary: blunt priorities and trade-offs.
- Constraints: no emojis, no sugarcoating.`,
      philosophical: `Tone: reflective clarity.
- Sentence style: calm and intentional.
- Vocabulary: perspective + concrete next step.
- Constraints: keep practical; no abstract rambling.`,
    };
    const toneLine = ai_tone === "custom" && ai_tone_custom
      ? `Custom tone guidance: ${String(ai_tone_custom).slice(0, 250)}`
      : (toneMap[ai_tone] || toneMap.professional);
    const prefsBlock =
      typeof ai_planning_rules === "string" && ai_planning_rules.trim()
        ? `\nUSER PLANNING PREFERENCES (keep advice compatible with these constraints):\n${String(ai_planning_rules).trim().slice(0, 900)}`
        : "";

    const system = `You are a focused execution coach. The user is about to start a single task.
${toneLine}${prefsBlock}
Return:
- 3-5 concrete sub-steps (verb-led, max 8 words each) that break the task down.
- 2-4 useful resource links (real, well-known URLs only — docs, official sites, common tools). If you're not certain a URL is correct, omit it. Do not invent links.
- One pro tip (1 sentence) tailored to the task type.
- recovery_actions: always include exactly 3 actions with ids:
  1) compress_rest_day, 2) defer_low_priority, 3) split_current_block
  For each action return {id,label,why}. Keep label under 40 chars and why under 100 chars.
- If the task looks like writing an email, slack/sms message, or short note (verbs: "email", "write to", "reply", "message", "DM", "text", "send to"), produce a "draft" object:
  • subject (omit/empty for chat messages)
  • body: 3-8 lines, ready to send, friendly-professional, fill placeholders like [Name] / [Date]
  • If the task is NOT a writing task, omit the draft field entirely (do not include empty strings).
If runtime_reason is:
- "stuck": prioritize split_current_block and concrete first action in 2-10 minutes.
- "skip": prioritize defer_low_priority and compress_rest_day.
- "overtime": prioritize compress_rest_day and realistic cut-down choices.
Be terse. No fluff. No greetings.`;

    const tools = [{
      type: "function",
      function: {
        name: "task_help",
        description: "Return execution help for a single task.",
        parameters: {
          type: "object",
          properties: {
            substeps: { type: "array", items: { type: "string" } },
            links: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  url: { type: "string" },
                },
                required: ["label", "url"],
                additionalProperties: false,
              },
            },
            tip: { type: "string" },
            recovery_actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", enum: ["compress_rest_day", "defer_low_priority", "split_current_block"] },
                  label: { type: "string" },
                  why: { type: "string" },
                },
                required: ["id", "label", "why"],
                additionalProperties: false,
              },
            },
            draft: {
              type: "object",
              properties: {
                subject: { type: "string" },
                body: { type: "string" },
              },
              required: ["body"],
              additionalProperties: false,
            },
          },
          required: ["substeps", "links", "tip", "recovery_actions"],
          additionalProperties: false,
        },
      },
    }];

    const userMsg = `Task: ${title}
Type: ${type || "unknown"}
Allotted: ${duration_min || "?"} min${location ? `\nLocation: ${location}` : ""}${runtime_reason ? `\nRuntime reason: ${runtime_reason}` : ""}`;

    const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "task_help" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) return new Response(JSON.stringify({ error: "Rate limit. Try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Workspace > Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await resp.text();
      console.error("AI error", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("No tool call returned");
    const args = JSON.parse(call.function.arguments);
    return new Response(JSON.stringify(args), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});