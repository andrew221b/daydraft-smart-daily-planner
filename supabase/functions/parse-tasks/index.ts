import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  
  try {
    const { raw_input } = await req.json();
    
    if (!raw_input || typeof raw_input !== "string" || !raw_input.trim()) {
      return new Response(JSON.stringify({ tasks: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const system = `You are an intelligent task parser and planning assistant for a daily planning app.
The user will provide a raw, messy input text describing their tasks for the day. It might contain typos, run-on sentences, time estimates, and start-time hints.

PART 1 — Parse tasks:
1. Extract each distinct task from the text.
2. Fix any typos or spelling mistakes. Keep the original language (e.g. if Russian, output Russian).
3. If the user specifies a duration (e.g., "for 8 hours", "30 mins", "около 8 часов", "буду работать 3 часа"), extract into \`duration_min\`. If no duration, output null.
4. If the user specifies a start time (e.g., "at 9am", "в 6 утра", "начну в 14:30", "с 10 часов", "9:00", "after 6"), extract into \`start_time\` as "HH:MM" 24h format. If no start time, output null.
5. The \`title\` should NOT include the time or duration — those go into the separate fields.

PART 2 — Clarification questions (ask 3–5 to improve the schedule):
Look at the parsed tasks and generate questions that will meaningfully improve scheduling. Think like a detective.
WHAT TO LOOK FOR:
1. Physical travel — if any task involves going somewhere (gym, store, office, doctor, cafe, school, client): ask how long the travel takes.
2. Fixed commitments — if any task is a call, meeting, appointment: ask what time it's at (if not given).
3. Duration unknowns — if a task is vague about how long it takes: ask for a rough estimate.
4. Ordering dependencies — if one task must happen before another: ask to confirm the order.
5. Energy/priority — if the list is heavy or mixed: ask what to prioritize.
RULES for questions:
- Minimum 3, maximum 5.
- Only return [] if EVERY task already has an explicit start time AND no ambiguity.
- Questions MUST reference actual task names from the input.
- Keep question text under 12 words. Options max 4 words each.
- Each question has 2–4 preset options.
- Option IDs should be snake_case short strings.`;

    const schema = {
      type: "OBJECT",
      properties: {
        tasks: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "Cleaned and spell-checked task title (no time/duration in title)" },
              duration_min: { type: "INTEGER", nullable: true, description: "Duration in minutes if specified, else null" },
              start_time: { type: "STRING", nullable: true, description: "Start time as HH:MM (24h) if the user mentioned one, else null" },
            },
            required: ["title", "duration_min", "start_time"],
          },
        },
        questions: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING", description: "Short snake_case id, e.g. 'gym_travel_time'" },
              text: { type: "STRING", description: "The question, referencing the actual task name, under 12 words" },
              options: { type: "ARRAY", items: { type: "STRING" }, description: "2–4 concise options (max 4 words each)" },
            },
            required: ["id", "text", "options"],
          },
        },
      },
      required: ["tasks", "questions"],
    };

    // Thinking disabled: no complex reasoning needed for structured extraction.
    const MODEL_CHAIN = ["gemini-2.0-flash"];
    const isTransient = (s: number) => s === 500 || s === 502 || s === 503 || s === 504;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let resp: Response | null = null;
    let lastStatus = 0;

    const callModel = async (model: string): Promise<Response> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      try {
        return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: raw_input }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: schema,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
    };

    outer:
    for (const model of MODEL_CHAIN) {
      for (let attempt = 0; attempt < 2; attempt++) {
        let r: Response;
        try {
          r = await callModel(model);
        } catch (err) {
          lastStatus = 504;
          break;
        }
        if (r.ok) { resp = r; break outer; }
        lastStatus = r.status;
        if (r.status === 429 || (r.status >= 400 && r.status < 500)) break; // try next model
        if (isTransient(r.status) && attempt === 0) { await sleep(300); continue; }
        break;
      }
    }

    if (!resp) {
      return new Response(JSON.stringify({ error: "AI failed to parse" }), { status: lastStatus || 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    const data = await resp.json();
    const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOut) throw new Error("No content returned");
    
    const args = JSON.parse(textOut);

    return new Response(JSON.stringify({ tasks: args.tasks || [], questions: args.questions || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
