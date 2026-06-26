import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { raw_input } = await req.json();

    if (!raw_input || typeof raw_input !== "string") {
      return new Response(JSON.stringify({ error: "raw_input required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const systemInstruction = `You are a sharp, perceptive planning ally who actually read the user's task list. Ask 0–5 questions — only what genuinely helps. Two kinds matter.

THINK FIRST (read the whole list semantically before deciding what to ask):
- Read for MEANING, not just words — grasp what each task really is and the day they're picturing ("a few emails" can be an hour of dread; "gym" means leaving the house). Judge each by what it actually involves.
- Hold the entire list in view and check it adds up — overlapping times, durations that can't fit, a relaxed evening stacked with hard tasks. A real clash earns a question; a list that already fits does not.
- Never ask what the text already answers, and never pad to a count. One question that truly changes the plan beats three safe ones.

SENSE-CHECKS — catch things that are off. ALWAYS ask at least one when any apply:
A. Nonsense / gibberish — a "task" that is random characters, a stray word, or clearly not a task ("asdfgh", "ggg", "blah", "test"): ask if it's real or just a test. Never silently keep it.
B. Venting / profanity — a line that is mostly swearing or frustration: answer with light humour, never a lecture. Ask what's really behind it so it becomes a real task (or gets dropped). Stay on their side.
C. Contradictions / impossible plans — tasks that clash or can't fit ("sleep 9h" + "finish 30 tasks before noon"; two fixed things at once; a 6h task starting at 5pm with an 11pm bedtime): name the clash and ask how to resolve it.

SCHEDULING — only when it changes the plan:
D. Travel — a task that means going somewhere (gym, office, doctor, store, client): ask how long the ONE-WAY trip there takes. This is separate from the activity's own length — never fold it into the task's duration. Set kind="travel".
E. Fixed commitments — a call/meeting/appointment with no time: ask what time. (DO NOT ASK if the task string already contains a time, e.g. "call at 3pm", "звонок в 14:00").
F. Vague duration — a task with no obvious length ("cook dinner", "workout", "write report"): ask a rough estimate. (DO NOT ASK if the task string already contains a duration, e.g. "read for 1 hour", "бегаю 30 мин").
G. Priority — a heavy or mixed list: ask what matters most.

RULES:
- Max 5. Prefer the few that change the most. Return [] ONLY when every task is sensible, clear, AND already time-set — never pad with filler to hit a count.
- NEVER ASK for a start time if the user already wrote a time (e.g., "15:00", "at 3pm", "вечером").
- NEVER ASK for a duration if the user already wrote a duration (e.g., "1 hour", "30m", "полчаса").
- ALWAYS ask at least one when A, B, or C applies. Nonsense, venting, and impossible plans must never pass unquestioned.
- Each question MUST name the actual task it is about.
- Every question MUST set \`kind\`: "travel" for D, "timing" for E, "duration" for F, "other" for A/B/C/G. The app uses this to decide whether an answer is allowed to overwrite the task's own length (only "duration" may) — a travel question tagged wrong will silently corrupt that task's duration.
- Write questions in the user's language. Question text under 12 words; options max 4 words; 2–4 options each (a free-text field is also shown, so cover the common cases).
- Voice: plain, dry, a little witty. Never preachy, never shaming. For venting/profanity, be playful and warm.
- Option IDs are short snake_case strings.

EXAMPLES (use the actual task names, in the user's language):
- "asdfgh" → "Is 'asdfgh' a real task or a test?" → ["Real task", "Just testing", "Remove it"]
- "finish everything this f***ing day" → "Rough one — what's the real task here?" → ["Name it", "Just venting", "Skip it"]
- "sleep 9h" + "30 tasks before noon" → "30 tasks before noon — realistic?" → ["Trim the list", "Move the deadline", "Keep it"]
- "gym" → "How long is travel to the gym?" → ["5–10 min", "15–20 min", "30+ min", "Nearby"]
- "call with client" (no time) → "When is the client call?" → ["Morning", "Midday", "Afternoon", "Evening"]`;

    const schema = {
      type: "OBJECT",
      properties: {
        questions: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "Short snake_case id, e.g. 'gym_travel_time' or 'client_call_time'" },
              text: { type: "STRING", description: "The question, referencing the actual task name, under 12 words" },
              options: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "2–4 concise options (max 4 words each), covering the most common answers",
              },
              kind: {
                type: "STRING",
                enum: ["duration", "travel", "timing", "other"],
                description: "'duration' = answer is the task's OWN length, safe to overwrite duration_min. 'travel' = one-way commute/trip time to the task's location — NEVER the task's own duration. 'timing' = when / what time of day. 'other' = sense-checks, priority, anything else.",
              },
            },
            required: ["id", "text", "options", "kind"],
          },
        },
      },
      required: ["questions"],
    };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    let resp;
    try {
      resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: `Tasks:\n${raw_input}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: 0.4,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    if (!resp.ok) {
      console.error("[generate-clarification] API error", resp.status, await resp.text());
      return new Response(JSON.stringify({ questions: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOut) {
      console.error("[generate-clarification] Empty response", JSON.stringify(data).slice(0, 300));
      return new Response(JSON.stringify({ questions: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const parsed = JSON.parse(textOut);
    return new Response(JSON.stringify({ questions: parsed.questions || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[generate-clarification] Fatal error", err?.message || err);
    return new Response(JSON.stringify({ questions: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
