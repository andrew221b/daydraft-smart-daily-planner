import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { ACTIVITY_DURATIONS, resolveProfessionalRef } from "../_shared/activityDurations.ts";
import { callGeminiWithRetry } from "../_shared/geminiRetry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  
  try {
    const { raw_input, mode, list_name } = await req.json();

    if (!raw_input || typeof raw_input !== "string" || !raw_input.trim()) {
      return new Response(JSON.stringify({ tasks: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    // ── CHECKLIST MODE ────────────────────────────────────────────────────────
    // The checklist brain-dump needs the OPPOSITE of the timeline planner: where
    // the timeline groups "buy milk, eggs, bread" into ONE shopping errand (you
    // don't want six timeline blocks), a checklist wants each thing as its own
    // tickable row. This is a lean, fast path — semantic SPLITTING only, no
    // duration/start-time/questions/personalization. Free-form, run-on, or voice
    // input ("надо купить молоко яйца хлеб воду подгузники корм для кошки") is the
    // exact case the regex splitter can't crack, so the model does it by meaning.
    if (mode === "checklist") {
      return await parseChecklist(raw_input, list_name, GEMINI_API_KEY, corsHeaders);
    }

    const baseSystem = `You are an intelligent task parser and planning assistant for a daily planning app.
The user will provide a raw, messy input text describing their tasks for the day. It might contain typos, run-on sentences, time estimates, and start-time hints.

HOW YOU THINK (read the whole input semantically before you parse or ask):
- Read for MEANING, not just words. Understand the day they're sketching and what each line actually IS — "a few emails" can be an hour of quiet dread, "sort out taxes" is heavier and longer than it sounds, "gym" means leaving the house. Size and treat each task by what it really involves, not its surface wording.
- Be logically consistent. Hold the entire list in view at once and check it adds up: times that overlap, durations that can't fit the hours implied, a "relaxing evening" stacked with hard work, a fixed deadline that fights another commitment. A genuine clash is worth a question (rule C); a list that already fits is not.
- Earn every question. Never ask what the text already answers (a stated time, a stated duration), never pad to a count, and don't ask two questions that resolve the same thing. One question that truly changes the plan beats three safe ones.

PART 1 — Parse tasks:
1. Extract each distinct task from the text.
2. Fix any typos or spelling mistakes. Each \`title\` MUST be written in the SAME language the user wrote that task in — English input → English title, Russian input → Russian title. Translate nothing. The many example phrases in these instructions are illustrative only and MUST NOT influence your output language.
3. If the user specifies a duration (e.g., "for 8 hours", "30 mins", "около 8 часов", "буду работать 3 часа"), extract it into \`duration_min\`. An explicit duration ALWAYS wins — never override it.
3b. If NO duration is given, estimate a realistic \`duration_min\`. Order of preference: (1) if a "YOUR OWN MEASURED DURATIONS" section is present and the task matches one of its rows, use THAT — it's this user's real time and beats any average; (2) otherwise use the ACTIVITY DURATION REFERENCE — read what kind of task it is, anchor to the closest matching row. Either way, scale for any "quick"/"brief" (shorter) or "deep"/"full session" (longer) signal. Never a token 30-min block for something that obviously takes longer (a gym session, a movie, cooking dinner). Use null ONLY when the length is genuinely unknowable and nothing matches (e.g. "work on the report").
3c. If (and only if) you anchored a task to a row in the PROFESSIONAL & WORK TASKS block specifically (rule 3b's option 2, the "[Role] Label:N,..." lines), set \`ref\` to that exact "Role.Label" pair, copied character-for-character (e.g. "Software Dev.Code", "UI/UX.Wireframe") — regardless of what language the task title is in. This lets the app verify your number against the table. If the task doesn't clearly match a row in THAT block (errands, personal life, generic/unlisted work, or anything from the other reference sections), leave \`ref\` null — never invent one that isn't written verbatim there.
4. If the user specifies a start time (e.g., "at 9am", "в 6 утра", "начну в 14:30", "с 10 часов", "9:00", "after 6"), extract into \`start_time\` as "HH:MM" 24h format. If no start time, output null.
4b. If the user gives a time RANGE for a task (e.g. "6-7pm", "10-11pm", "14:00-15:30", "с 14 до 15", "from 2 to 3pm"): the FIRST time is \`start_time\`, and \`duration_min\` is the difference between the two times in minutes (handle ranges that cross noon, e.g. "11-1pm" = 11am–1pm = 120 min). Neither number may remain in the title.
5. The \`title\` should NOT include the time or duration — those go into the separate fields. Never leave a bare number (e.g. a stray hour from a time range) stuck in the title.

LANGUAGE RULE (mandatory — apply to EVERYTHING you output):
Detect the language of the user's input text. EVERY string you return — each task \`title\` AND every question, option, and word in the \`questions\` array — MUST be in that same language. English input → English output. Russian input → Russian output. Ukrainian → Ukrainian. Your output language is decided SOLELY by the user's input text, NEVER by the language of the examples in these instructions (which are deliberately multilingual). Never flip an English task into Russian or vice-versa. This is not optional.

PART 2 — Clarification questions (return 0–5; a sharp friend who actually read the list):
You are perceptive. Read between the lines and only ask what genuinely helps. Two kinds of question matter:

SENSE-CHECKS — catch things that are off. ALWAYS ask at least one when any of these apply:
A. Nonsense / gibberish — input that is keyboard mashing, random characters, or completely meaningless in any language (e.g. "asdfgh", "ggg", "фывафыва", "йцуйцу"): do NOT include it as a task. Ask directly whether it's a real task or just a test — one short question. Never silently parse it.
B. Profanity / insults / provocations — if the entire input (or a line) is swearing, insults, or aggression with no real task underneath it: name it plainly without moralizing — say there's no task here to plan, just a provocation — and ask once what they actually wanted. One question, no lecture. EXCEPTION: if profanity is mixed with a real task (e.g. "блин, надо в спортзал"), treat it as the task and skip the question.
C. Contradictions / impossible plans — tasks that logically clash or can't fit (e.g. "sleep 9h" + "finish 30 tasks before noon"; two fixed things at the same time; a 6h task starting at 5pm with an 11pm bedtime): name the clash and ask how to resolve it.
D. Fantasy / unreal tasks — a "task" that involves things that don't exist in reality (unicorns, fictional creatures, impossible physics, e.g. "поймать розового крокодила", "покормить единорога", "телепортироваться на луну"): do NOT plan it as a real task. Note lightly in one sentence that this isn't a real task (or is a test), and ask if they meant something else.

SCHEDULING — the questions that actually shape WHEN and HOW LONG. Prefer these; they matter most:
E. Timing of leisure / flexible tasks — MANDATORY when the list contains BOTH (a) any entertainment or relaxation item (movie, show, game, reading, hobby, walk, nap) AND (b) any work, call, or errand. You MUST generate this question. Ask when they want the downtime; leisure belongs AFTER work, so lead with evening. Example for Russian input: "Фильм — вечером или в свободное время?" → ["Вечером", "Днём", "Как получится"].
F. Fixed commitments — a call/meeting/appointment with no time: ask roughly when. Offer parts of day, not clock times.
G. Duration that really varies — a task whose length swings a lot: confirm a rough length. Skip ones already estimated by rule 3b.
G2. Travel / commute time — a task that means leaving home (gym, office, doctor, store, class, errand, meeting elsewhere): you may ask how long the ONE-WAY trip there takes. This is separate from the activity's own length — never fold it into the task's duration.
H. Day anchor — if NO task has a start time and nothing tells you when their day begins, ask when they want to start.
I. Priority — a heavy or mixed list: ask what matters most.

RULES for questions:
- Max 5. Spend them on TIMING and DURATION first — those build the plan. Return [] ONLY when every task is sensible, clear, time-set AND sensibly-lengthed.
- ALWAYS ask at least one question when A, B, C, or D applies.
- E (formerly D) is MANDATORY when entertainment + work/calls coexist in the list.
- Each question MUST name the actual task it is about (in the user's language). LANGUAGE RULE: every question, option, and word MUST be in the same language as the user's input.
- Every question MUST set \`kind\`, matching which rule produced it: "duration" for G, "travel" for G2, "timing" for E/F/H, "other" for A/B/C/D/I. This tells the app whether the answer is allowed to overwrite the task's own length (only "duration" may) — getting it wrong on a travel question will silently corrupt that task's duration, so be precise.
- Question text under 12 words; options max 4 words; 2–4 options each.
- Voice: plain, dry, a little witty. Never preachy, never shaming.
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
              ref: { type: "STRING", nullable: true, description: "Exact 'Role.Label' pair from the PROFESSIONAL & WORK TASKS block if duration_min was anchored to one of those rows (e.g. 'Software Dev.Code'), else null. Never invented." },
            },
            required: ["title", "duration_min", "start_time", "ref"],
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
      required: ["tasks", "questions"],
    };

    // ── Personalize the questions ───────────────────────────────────────────
    // Pull the user's self-described context + what we've learned about them so
    // the clarifying questions are relevant, not generic. Fetched server-side
    // from the caller's JWT, best-effort and in parallel — any failure here just
    // means the questions fall back to non-personalized (it never blocks parsing).
    let personalBlock = "";
    let personalDurations = "";
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
          const [{ data: prof }, { data: pat }, { data: histBlocks }] = await Promise.all([
            supabase.from("profiles")
              .select("display_name, ai_context_custom, ai_planning_rules, ai_personalization_enabled, energy_preference, active_hours_start, active_hours_end")
              .eq("id", u.user.id).maybeSingle(),
            supabase.from("user_patterns")
              .select("deep_work_overrun_pct, abandoned_types, completion_by_hour")
              .eq("user_id", u.user.id).maybeSingle(),
            // The user's OWN tracked task durations. actual_minutes is only ever
            // set from real time-tracking (never invented), so a non-null value
            // is an honest measured signal — the most accurate prior for THIS
            // person. Recent-first; aggregation below caps the prompt cost.
            supabase.from("blocks")
              .select("title, actual_minutes")
              .eq("user_id", u.user.id)
              .not("actual_minutes", "is", null)
              .order("created_at", { ascending: false })
              .limit(400),
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
          // Personal duration calibration — blend the population/profession
          // reference with what THIS user actually measured. Group their tracked
          // tasks by title, take the median (robust to a stray left-running
          // timer) and the sample count so the model can weigh reliability.
          if (prof?.ai_personalization_enabled !== false && Array.isArray(histBlocks) && histBlocks.length) {
            const groups = new Map<string, { label: string; vals: number[] }>();
            for (const b of histBlocks as any[]) {
              const title = String(b?.title || "").trim();
              const mins = Number(b?.actual_minutes || 0);
              if (!title || !(mins > 0)) continue;
              const key = title.toLowerCase().replace(/\s+/g, " ");
              const g = groups.get(key) || { label: title, vals: [] };
              g.vals.push(mins);
              groups.set(key, g);
            }
            const median = (a: number[]): number => {
              const s = [...a].sort((x, y) => x - y);
              const mid = Math.floor(s.length / 2);
              return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
            };
            const rows = [...groups.values()]
              .sort((a, b) => b.vals.length - a.vals.length)
              .slice(0, 20)
              .map((g) => `- "${g.label}" → ~${median(g.vals)}m${g.vals.length > 1 ? ` (their avg across ${g.vals.length})` : ""}`);
            if (rows.length) {
              personalDurations = `\n\nYOUR OWN MEASURED DURATIONS (this user's REAL tracked time on past tasks — the single most accurate signal for THIS person). When a task you're estimating matches one of these (even with different wording or in another language), PREFER the user's own time below over the population/profession reference. More samples = more reliable:\n${rows.join("\n")}`;
            }
          }
          if (name || about || rules || habits || dayShape) {
            personalBlock = `\n\nABOUT THIS USER (quiet background — use ONLY to make a question sharper or more relevant; NEVER quote it back, and never turn the context itself into a question):\n${name ? `- Name: ${name}\n` : ""}${about ? `- About them: ${about}\n` : ""}${rules ? `- Their planning rules: ${rules}\n` : ""}${dayShape ? `- Day shape: ${dayShape}\n` : ""}${habits ? `- Learned habits: ${habits}\n` : ""}`;
          }
        }
      } catch (_e) { /* non-fatal — questions just won't be personalized */ }
    }

    const system = baseSystem + personalBlock + "\n\n" + ACTIVITY_DURATIONS + personalDurations;

    // gemini-2.5-flash = the app's current primary (same as the planner & chat);
    // 2.0-flash stays only as a resilience fallback. Thinking is forced off in
    // generationConfig so this stays flash-tier on cost — the task is structured
    // extraction plus short questions, no chain-of-thought needed.
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

    // Shared model-chain + transient-retry (incl 404/429). See _shared/geminiRetry.ts.
    const { response: resp, lastStatus } = await callGeminiWithRetry((model) => callModel(model));

    if (!resp) {
      return new Response(JSON.stringify({ error: "AI failed to parse" }), { status: lastStatus || 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    const data = await resp.json();
    const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOut) throw new Error("No content returned");
    
    const args = JSON.parse(textOut);

    // Verify each task's duration against the reference table it claims to be
    // anchored to. The model names the row (language/phrasing-agnostic — it
    // already did the hard part); minutes come from the table, not from
    // trusting the model's own arithmetic. A reasonable scaling band ("quick"
    // → shorter, "deep work" → longer, rule 3b) is still honored — only a
    // genuine outlier gets pulled back to the table value.
    const REF_CLAMP_LOW = 0.4;
    const REF_CLAMP_HIGH = 2.5;
    const tasksOut = (Array.isArray(args.tasks) ? args.tasks : []).map((t: any) => {
      const anchorMin = resolveProfessionalRef(t?.ref);
      let duration_min = t?.duration_min ?? null;
      if (anchorMin != null) {
        if (duration_min == null) {
          duration_min = anchorMin;
        } else if (duration_min < anchorMin * REF_CLAMP_LOW || duration_min > anchorMin * REF_CLAMP_HIGH) {
          console.log(`[parse-tasks] clamped "${t?.title}" duration ${duration_min}m -> ${anchorMin}m (ref=${t.ref})`);
          duration_min = anchorMin;
        }
        duration_min = Math.max(5, Math.round(duration_min / 5) * 5);
      }
      return { title: t?.title, duration_min, start_time: t?.start_time ?? null };
    });

    // Deterministic backstop for rule H (day anchor): the prompt already asks the
    // model to ask when no task has a start time, but compliance is discretionary —
    // the client (DayView's allTimesSet) silently auto-schedules with zero questions
    // if the model returns none. Only fires when the model genuinely asked nothing
    // AND no task carries any time signal; never overrides the model's own questions.
    const questionsOut = args.questions || [];
    const noTaskHasTime = tasksOut.length > 0 && !tasksOut.some((t: any) => t.start_time);
    if (questionsOut.length === 0 && noTaskHasTime) {
      const isCyrillic = /[Ѐ-ӿ]/.test(JSON.stringify(tasksOut));
      questionsOut.push(isCyrillic
        ? { id: "day_anchor", text: "Когда хочешь начать день?", options: ["Утром", "Днём", "Вечером", "Гибко"], kind: "timing" }
        : { id: "day_anchor", text: "When do you want to start your day?", options: ["Morning", "Afternoon", "Evening", "Flexible"], kind: "timing" });
    }

    // The model occasionally drops the separator in a numeric range option
    // ("3 4 часа" instead of "3-4 часа") — insert a dash between two bare
    // numbers immediately followed by a duration unit so it reads as a range.
    // Trailing \b doesn't work here — \w never includes Cyrillic, so a
    // boundary check right after "часа" sees non-word-on-both-sides and
    // never fires. A negative lookahead for any letter (either alphabet)
    // does the same job without that gap.
    const fixRangeSeparator = (s: string) =>
      typeof s === "string"
        ? s.replace(/(\b\d+)\s+(\d+)(\s*(?:h|hours?|hrs?|ч\.?|час(?:а|ов)?|m|min|minutes?|мин(?:ут\w*)?))(?![a-zA-Zа-яёА-ЯЁ])/giu, "$1-$2$3")
        : s;
    for (const q of questionsOut) {
      if (Array.isArray(q?.options)) q.options = q.options.map(fixRangeSeparator);
    }

    return new Response(JSON.stringify({ tasks: tasksOut, questions: questionsOut }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

/**
 * Checklist brain-dump parser. Turns a messy / spoken / run-on dump into a clean
 * list of individual, tickable checklist items. Deliberately separate from the
 * timeline parser above: no times, no durations, no questions — just smart
 * semantic splitting of enumerations (shopping lists, packing lists, errands)
 * that the regex splitter on the client can't handle.
 */
async function parseChecklist(
  raw_input: string,
  list_name: unknown,
  GEMINI_API_KEY: string,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const listCtx = typeof list_name === "string" && list_name.trim()
    ? `\n\nCONTEXT: these items are being added to a list the user named "${list_name.trim()}". Use it only as a hint for how granular to split (e.g. a "Groceries"/"Покупки" list means each product is its own item) — never invent items from the name, and never add the list name as an item.`
    : "";

  const system = `You convert a raw brain-dump into a clean checklist. The user typed or SPOKE (voice → text, so expect NO punctuation, run-on words, repetition and filler) a pile of things they need to do or buy. Return each distinct thing as its own short, tickable checklist item.

HOW TO THINK:
- Read for MEANING, not surface words. Input may be one long unpunctuated breath: "надо купить молоко яйца хлеб воду подгузники ещё ещё корм для кошки". Understand it: a shopping list of six things.
- SPLIT enumerations. When several things are listed under ONE action — a shopping list, a packing list, a run of errands — EACH thing becomes a separate item. "купить молоко яйца хлеб воду подгузники корм для кошки" → six items: молоко · яйца · хлеб · вода · подгузники · корм для кошки. "buy milk eggs bread, call the dentist, return books" → milk · eggs · bread · call the dentist · return books.
- KEEP MULTI-WORD ITEMS WHOLE. A single item that happens to span words is ONE item, not several: "корм для кошки", "стиральный порошок", "подарок маме на день рождения", "dish soap", "birthday gift for mom" each stay intact. Words joined by "для/of/with/for/к/на/со" belong to the same item.
- For a clear shopping/grocery/packing enumeration, output just the ITEM (the noun) — the umbrella action ("buy/купить/взять/pack") is implied by the list, so don't repeat "buy" on every row.
- For DISTINCT separate tasks (not items under one shared action), keep each task's own wording and verb: "позвонить маме", "забрать посылку", "оплатить счёт".
- STRIP filler and lead-ins: "надо", "нужно", "ещё ещё", "вот", "ну", "так", "need to", "i have to", "also", "and then", repeated words. Fix typos and obvious voice mis-hearings.
- Keep every title SHORT and scannable — a checklist row, not a sentence. Sentence case. No numbering, no bullets, no trailing punctuation.
- Deduplicate.

LANGUAGE RULE (mandatory): every item title MUST be in the SAME language the user wrote in. Russian input → Russian items, English → English, Ukrainian → Ukrainian. The examples above are deliberately multilingual and MUST NOT change your output language. Translate nothing.

If the input is genuine gibberish / keyboard-mashing with no real to-do in it, return an empty list.${listCtx}`;

  const schema = {
    type: "OBJECT",
    properties: {
      tasks: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "One clean, short checklist item in the user's own language" },
          },
          required: ["title"],
        },
      },
    },
    required: ["tasks"],
  };

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
            // Low temp — this is deterministic extraction, not creative writing.
            temperature: 0.1,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  };

  const { response: resp, lastStatus } = await callGeminiWithRetry((model) => callModel(model));
  if (!resp) {
    return new Response(JSON.stringify({ error: "AI failed to parse", tasks: [] }), {
      status: lastStatus || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await resp.json();
  const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOut) {
    return new Response(JSON.stringify({ tasks: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let parsed: any = {};
  try { parsed = JSON.parse(textOut); } catch { parsed = {}; }
  const seen = new Set<string>();
  const tasksOut = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
    .map((t: any) => ({ title: String(t?.title ?? "").trim() }))
    .filter((t: { title: string }) => {
      if (!t.title) return false;
      const key = t.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 60);

  return new Response(JSON.stringify({ tasks: tasksOut }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
