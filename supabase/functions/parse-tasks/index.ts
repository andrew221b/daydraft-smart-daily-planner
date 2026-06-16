import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

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

    const baseSystem = `You are an intelligent task parser and planning assistant for a daily planning app.
The user will provide a raw, messy input text describing their tasks for the day. It might contain typos, run-on sentences, time estimates, and start-time hints.

PART 1 — Parse tasks:
1. Extract each distinct task from the text.
2. Fix any typos or spelling mistakes. Keep the original language (e.g. if Russian, output Russian).
3. If the user specifies a duration (e.g., "for 8 hours", "30 mins", "около 8 часов", "буду работать 3 часа"), extract into \`duration_min\`. If no duration, output null.
4. If the user specifies a start time (e.g., "at 9am", "в 6 утра", "начну в 14:30", "с 10 часов", "9:00", "after 6"), extract into \`start_time\` as "HH:MM" 24h format. If no start time, output null.
5. The \`title\` should NOT include the time or duration — those go into the separate fields.

PART 2 — Clarification questions (return 0–5; a sharp friend who actually read the list):
You are perceptive. Read between the lines and only ask what genuinely helps. Two kinds of question matter:

SENSE-CHECKS — catch things that are off. ALWAYS ask at least one when any of these apply:
A. Nonsense / gibberish — a "task" that is random characters, a stray word, or clearly not a task (e.g. "asdfgh", "ggg", "blah", "test"): ask if it's a real task or just a test. Never silently keep it.
B. Venting / profanity — a line that is mostly swearing or frustration: answer with light humour, never a lecture. Ask what's really behind it so it can become a real task (or get dropped). Stay on their side.
C. Contradictions / impossible plans — tasks that logically clash or can't fit (e.g. "sleep 9h" + "finish 30 tasks before noon"; two fixed things at the same time; a 6h task starting at 5pm with an 11pm bedtime): name the clash and ask how to resolve it.

SCHEDULING — only when it changes the plan:
D. Travel — a task that means going somewhere (gym, office, doctor, store, client): ask how long travel takes.
E. Fixed commitments — a call/meeting/appointment with no time: ask what time.
F. Vague duration — a task with no obvious length: ask for a rough estimate.
G. Priority — a heavy or mixed list: ask what matters most.

RULES for questions:
- Max 5. Prefer the few that change the most. Return [] ONLY when every task is sensible, clear, AND already time-set — never pad with filler just to hit a count.
- ALWAYS ask at least one question when A, B, or C applies. Nonsense, venting, and impossible plans must never pass unquestioned.
- Each question MUST name the actual task it is about.
- Write questions in the user's language. Question text under 12 words; options max 4 words; 2–4 options each.
- Voice: plain, dry, a little witty. Never preachy, never shaming. For venting/profanity, be playful and warm.
- Option IDs are short snake_case strings.`;

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

    // ── Personalize the questions ───────────────────────────────────────────
    // Pull the user's self-described context + what we've learned about them so
    // the clarifying questions are relevant, not generic. Fetched server-side
    // from the caller's JWT, best-effort and in parallel — any failure here just
    // means the questions fall back to non-personalized (it never blocks parsing).
    let personalBlock = "";
    const auth = req.headers.get("Authorization");
    if (auth) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: auth } } },
        );
        const { data: u } = await supabase.auth.getUser();
        if (u?.user) {
          const [{ data: prof }, { data: pat }] = await Promise.all([
            supabase.from("profiles")
              .select("display_name, ai_context_custom, ai_planning_rules, ai_personalization_enabled, energy_preference, active_hours_start, active_hours_end")
              .eq("id", u.user.id).maybeSingle(),
            supabase.from("user_patterns")
              .select("deep_work_overrun_pct, abandoned_types, completion_by_hour")
              .eq("user_id", u.user.id).maybeSingle(),
          ]);
          const name = String(prof?.display_name || "").trim();
          // User-authored fields are usually short; the cap is just a safety
          // ceiling. 700 chars ≈ a paragraph each — richer context, still cheap.
          const about = String(prof?.ai_context_custom || "").trim().slice(0, 700);
          const rules = String(prof?.ai_planning_rules || "").trim().slice(0, 700);
          // Day shape — a few tokens, high signal for time-of-day questions.
          const energy = String(prof?.energy_preference || "").trim();
          const ahStart = String(prof?.active_hours_start || "").trim();
          const ahEnd = String(prof?.active_hours_end || "").trim();
          const dayShape = [
            energy ? `${energy} person` : "",
            ahStart && ahEnd ? `active ${ahStart}–${ahEnd}` : "",
          ].filter(Boolean).join(", ");
          // Learned habits — only when the user hasn't switched personalization off.
          let habits = "";
          if (prof?.ai_personalization_enabled !== false && pat) {
            const bits: string[] = [];
            const overrun = Number(pat.deep_work_overrun_pct || 0);
            if (overrun > 10) bits.push(`runs ~${overrun.toFixed(0)}% over on deep work`);
            const abandoned = Array.isArray(pat.abandoned_types) ? pat.abandoned_types.slice(0, 3) : [];
            if (abandoned.length) bits.push(`often drops: ${abandoned.join(", ")}`);
            const cbh = pat.completion_by_hour && typeof pat.completion_by_hour === "object"
              ? pat.completion_by_hour as Record<string, number> : null;
            if (cbh) {
              const top = Object.entries(cbh).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
              if (top) bits.push(`most reliable around ${top[0]}:00`);
            }
            habits = bits.join("; ");
          }
          if (name || about || rules || habits || dayShape) {
            personalBlock = `\n\nABOUT THIS USER (quiet background — use ONLY to make a question sharper or more relevant; NEVER quote it back, and never turn the context itself into a question):\n${name ? `- Name: ${name}\n` : ""}${about ? `- About them: ${about}\n` : ""}${rules ? `- Their planning rules: ${rules}\n` : ""}${dayShape ? `- Day shape: ${dayShape}\n` : ""}${habits ? `- Learned habits: ${habits}\n` : ""}`;
          }
        }
      } catch (_e) { /* non-fatal — questions just won't be personalized */ }
    }

    const system = baseSystem + personalBlock;

    // gemini-2.5-flash = the app's current primary (same as the planner & chat);
    // 2.0-flash stays only as a resilience fallback. Thinking is forced off in
    // generationConfig so this stays flash-tier on cost — the task is structured
    // extraction plus short questions, no chain-of-thought needed.
    const MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.0-flash"];
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
              // A touch of warmth makes the questions livelier without risking the
              // structured extraction; thinking off keeps 2.5-flash at flash cost.
              temperature: 0.4,
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
