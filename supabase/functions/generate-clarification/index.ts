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

    const systemInstruction = `You are a planning detective. The user has listed their tasks for the day.
Your job: ask 3–5 sharp, specific questions that will meaningfully improve their schedule.
Think like a detective — look at every task and spot ambiguities that CHANGE how the plan is built.

WHAT TO LOOK FOR (in order of importance):
1. Physical travel — if any task involves going somewhere (gym, store, office, doctor, cafe, school, client): ask how long the travel takes or what time they need to leave.
2. Fixed commitments — if any task is a call, meeting, appointment, or event: ask what time it's at (if not given) or if it has a hard deadline.
3. Ordering dependencies — if one task clearly must happen before or after another: ask to confirm the order.
4. Duration unknowns — if a task is vague about how long it takes ("cook dinner", "workout", "write report"): ask for a rough estimate.
5. Energy/priority — if the list is heavy or has a mix of hard + easy tasks: ask what to prioritize or how much energy they have today.

RULES:
- Minimum 3 questions, maximum 5.
- Only ask [] (empty) if EVERY task already has an explicit start time AND no travel/ordering/duration is ambiguous.
- Questions MUST reference the actual task names from the input — no generic questions.
- Keep question text under 12 words. Options max 4 words each.
- Each question has 2–4 preset options PLUS the UI will show a free-text field for custom input — so options should cover the most common cases.
- The option IDs should be snake_case short strings.

EXAMPLES of good questions (using actual task names):
- Task "gym" → "How long is your travel to the gym?" → ["5–10 min", "15–20 min", "30+ min", "It's nearby"]
- Task "call with client" (no time given) → "When is the call with the client?" → ["Morning", "Midday", "Afternoon", "Evening"]
- Task "dentist" → "What time is your dentist appointment?" → ["Morning", "Afternoon", "Evening", "Not fixed"]
- Task "write report" → "How long do you expect the report to take?" → ["~30 min", "~1 hour", "2+ hours"]
- Mixed heavy day → "What should come first today?" → ["Most important task", "Easiest first", "By fixed time"]
- Tasks in wrong obvious order → "Does X need to be done before Y?" → ["Yes, in that order", "No, can be reversed", "Doesn't matter"]`;

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
            },
            required: ["id", "text", "options"],
          },
        },
      },
      required: ["questions"],
    };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    let resp;
    try {
      resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: `Tasks:\n${raw_input}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: 0.25,
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
