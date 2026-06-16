import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dd-dev-pro",
};

// ── Curated "fact of the day" pool ──────────────────────────────────────────
// Rotates daily by date seed. Genuine intellectual facts, no productivity fluff.
const PHRASES = [
  "Zeigarnik effect: unfinished tasks occupy more mental space than finished ones — closure is a real cognitive event.",
  "The word 'deadline' originated in Civil War prisoner-of-war camps — a line drawn in the dirt: cross it and guards would shoot.",
  "Parkinson's Law (1955): work expands to fill the time available for its completion.",
  "The average adult makes roughly 35,000 decisions per day, most of them unconscious.",
  "Forgetting is not memory failure — it's an active process. The brain deletes to prevent interference and save energy.",
  "The word 'focus' comes from Latin for 'hearth' — the point around which a household organises itself.",
  "Flow state was first described by Csikszentmihalyi studying chess players and rock climbers, not office workers.",
  "When you remember something, you're actually remembering the last time you remembered it — not the original event.",
  "The Baader-Meinhof phenomenon: once you notice something new, you see it everywhere. Selective attention, not coincidence.",
  "A jiffy is a real unit: 1/100th of a second in computing; the time light takes to travel 1 cm in physics.",
  "The word 'salary' comes from Latin 'salarium' — payment in salt. Salt was once so valuable it was used as currency.",
  "Oxford University is older than the Aztec Empire. Teaching began ~1096; the Aztecs founded Tenochtitlan in 1325.",
  "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.",
  "The Eiffel Tower grows ~15 cm taller in summer — iron expands as it heats.",
  "Honey never spoils. Archaeologists found 3,000-year-old honey in Egyptian tombs that was still edible.",
  "Crows can recognise individual human faces and hold grudges for years — and teach their offspring to avoid specific people.",
  "The word 'silly' originally meant 'blessed' in Old English. It drifted through 'happy' → 'naive' → 'foolish' over 500 years.",
  "There are more possible games of chess than there are atoms in the observable universe.",
  "Nintendo was founded in 1889 — as a playing card company in Kyoto, Japan.",
  "Marie Curie is the only person to win Nobel Prizes in two different sciences. Her notebooks are still too radioactive to handle safely.",
  "A day on Venus is longer than its year: 243 Earth days to rotate once, but only 225 to orbit the sun.",
  "Bananas are technically berries. Strawberries are not.",
  "The shortest war in history lasted 38–45 minutes: the Anglo-Zanzibar War, August 1896.",
  "The number zero didn't reach Europe until the 12th century, arriving from India via Arab mathematicians.",
  "A flea can jump 200 times its own body height. The human equivalent would be clearing a 60-storey building.",
  "In 1905, Einstein worked 48-hour weeks as a patent clerk and wrote 4 papers that changed physics — in his spare time.",
  "The Great Wall of China is not visible from space with the naked eye. At the Moon's distance it would look thinner than a hair.",
  "Average cloud weight: ~500,000 kg (equivalent to 100 elephants). It floats because the droplets are so widely dispersed.",
  "Humans are the only animals that blush. Darwin called it 'the most peculiar and most human of all expressions.'",
  "The fingerprints of a koala are so similar to human fingerprints they've been mistaken at crime scenes.",
  "The first computer bug was a real bug — a moth found trapped in a relay of the Harvard Mark II in 1947.",
  "In ancient Rome, 'vacation' (vacatio) meant exemption from military service — not leisure or travel.",
  "The human brain uses 20% of the body's total energy despite being only 2% of its mass.",
  "A group of flamingos is called a flamboyance. A group of ravens: an unkindness. A group of owls: a parliament.",
  "The Mpemba effect: hot water can freeze faster than cold water under certain conditions, first noted by a Tanzanian student in 1963.",
  "Nikola Tesla claimed to sleep 2 hours a night, supplemented by 20-minute naps. He died alone and in debt.",
  "Glass is an amorphous solid, not a liquid. Old windows appear thicker at the bottom due to manufacturing, not flow.",
  "When you learn a new word, you'll hear it within 24 hours. Not magic — your reticular activating system filters it in.",
  "The word 'robot' was coined in 1920 by Czech playwright Karel Capek, from the Czech 'robota' meaning forced labour.",
  "Wristwatches were considered feminine until World War I, when soldiers found pocket watches impractical in the trenches.",
];

// ── Gemini tool-call helper ──────────────────────────────────────────────────
// One place for the model name, forced structured output, temperature, and —
// critically — error logging. The old per-mode blocks swallowed every failure
// silently and fell back to static date-seeded content, which is exactly why
// the riddle/quiz/challenge looked frozen. `tool_choice: "required"` is the
// broadly-supported way to force a call on Gemini's OpenAI-compat layer (the
// named-function object form often 400s there).
const GEMINI_MODEL = "gemini-2.5-flash";
async function callGeminiTool(
  apiKey: string,
  system: string,
  userMsg: string,
  toolName: string,
  parameters: Record<string, unknown>,
  temperature: number,
): Promise<Record<string, any> | null> {
  try {
    const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        tools: [{ type: "function", function: { name: toolName, parameters } }],
        tool_choice: "required",
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(`[yesterday-debrief] Gemini ${toolName} HTTP ${resp.status}: ${body.slice(0, 300)}`);
      return null;
    }
    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      console.error(`[yesterday-debrief] Gemini ${toolName} returned no tool call`);
      return null;
    }
    return JSON.parse(call.function.arguments);
  } catch (e) {
    console.error(`[yesterday-debrief] Gemini ${toolName} threw:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

// Money / duration formatters for the recap earnings line.
function fmtMoney(n: number, cur: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${cur} ${Math.round(n)}`;
  }
}
function fmtHrMin(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { timezone, now_iso, force_mode, variation } = await req.json().catch(() => ({}));
    // Dev "Refresh Insights" sends a bumping nonce so each refresh rotates the
    // theme + fallback and re-samples the model — proving generation is live.
    // Absent for normal users → daily output stays deterministic as before.
    const varSeed = Number.isFinite(Number(variation)) ? (Number(variation) >>> 0) : 0;
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = now_iso ? new Date(now_iso) : new Date();
    const tz = typeof timezone === "string" && timezone ? timezone : "UTC";
    const todayLocal = (() => {
      try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
      } catch {
        return now.toISOString().slice(0, 10);
      }
    })();
    const y = new Date(`${todayLocal}T12:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    const yesterday = y.toISOString().slice(0, 10);

    const { data: plan } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("date", yesterday)
      .maybeSingle();
    if (!plan?.id) {
      return new Response(JSON.stringify({ show: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: blocks } = await supabase
      .from("blocks")
      .select("id,title,type,kind,completed,is_calendar_event,estimated_minutes,actual_minutes,duration_min,start_time,completed_at")
      .eq("plan_id", plan.id)
      .order("position");
    const tasks = (blocks || []).filter((b: any) => b.kind === "task" && !b.is_calendar_event);
    const done = tasks.filter((b: any) => b.completed);
    if (!tasks.length || done.length === 0) {
      return new Response(JSON.stringify({ show: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const doneCount = done.length;
    const totalCount = tasks.length;
    const skipped = tasks
      .filter((b: any) => !b.completed)
      .map((b: any) => String(b.title || "").trim())
      .filter(Boolean);

    type TaskRow = { title: string; type: string; estMin: number; actMin: number; variance: number };
    const doneRows: TaskRow[] = done.map((b: any): TaskRow => {
      const estMin = Math.max(0, Number(b.estimated_minutes || b.duration_min || 0));
      const actMin = Math.max(0, Number(b.actual_minutes || estMin));
      return {
        title: String(b.title || "").trim().slice(0, 60) || "(untitled)",
        type: String(b.type || "task"),
        estMin,
        actMin,
        variance: actMin - estMin,
      };
    });

    const deepDone = doneRows.filter((b) => b.type === "deep_work");
    const deepUnderMin = deepDone.reduce((sum, b) => sum + Math.max(0, -b.variance), 0);
    const sortedByOverrun = [...doneRows].sort((a, b) => b.variance - a.variance);
    const biggestOverrun = sortedByOverrun[0]?.variance > 5 ? sortedByOverrun[0] : null;

    const completedTimestamps = done
      .map((b: any) => (typeof b.completed_at === "string" ? Date.parse(b.completed_at) : NaN))
      .filter((n: number) => Number.isFinite(n));
    const lastCompletedAt = completedTimestamps.length ? new Date(Math.max(...completedTimestamps)) : null;
    const lastCompletedLocal = lastCompletedAt
      ? new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
        }).format(lastCompletedAt)
      : null;

    const startTimes = done
      .map((b: any) => (typeof b.start_time === "string" ? b.start_time.slice(0, 5) : ""))
      .filter((s: string) => /^\d{2}:\d{2}$/.test(s))
      .sort();
    const firstStart = startTimes[0] || null;

    // ── Week stats (last 7 days) ─────────────────────────────────────────────
    const weekStart = new Date(`${yesterday}T12:00:00Z`);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);
    const weekStartDate = weekStart.toISOString().slice(0, 10);

    const { data: weekPlans } = await supabase
      .from("plans")
      .select("id, date")
      .eq("user_id", user.id)
      .gte("date", weekStartDate)
      .lte("date", yesterday);

    let weekStat = "";
    // Hoisted so the recap branch can feed them to the AI for sharper, more
    // personal observations (e.g. "third day in a row").
    let weekDone = 0;
    let weekTotal = 0;
    let weekPct = 0;
    let weekStreak = 0;
    if (weekPlans && weekPlans.length > 1) {
      const planIds = weekPlans.map((p: any) => p.id);
      const { data: weekBlocks } = await supabase
        .from("blocks")
        .select("plan_id, completed, kind, is_calendar_event")
        .in("plan_id", planIds)
        .eq("kind", "task")
        .eq("is_calendar_event", false);

      if (weekBlocks) {
        weekDone = weekBlocks.filter((b: any) => b.completed).length;
        weekTotal = weekBlocks.length;

        // Completion streak: consecutive days ending yesterday where done > 0
        const completionsByPlanId = new Map<string, number>();
        for (const b of weekBlocks) {
          if (b.completed) {
            completionsByPlanId.set(b.plan_id, (completionsByPlanId.get(b.plan_id) || 0) + 1);
          }
        }
        const planDateMap = new Map((weekPlans as any[]).map((p) => [p.date, p.id]));

        for (let i = 0; i < 7; i++) {
          const d = new Date(`${yesterday}T12:00:00Z`);
          d.setUTCDate(d.getUTCDate() - i);
          const dateStr = d.toISOString().slice(0, 10);
          const pid = planDateMap.get(dateStr);
          if (!pid || (completionsByPlanId.get(pid) || 0) === 0) break;
          weekStreak++;
        }

        if (weekTotal > 0) {
          weekPct = Math.round((weekDone / weekTotal) * 100);
          // Spell it out so it can't be misread as "days" — these are tasks.
          weekStat = `${weekDone} of ${weekTotal} tasks done this week`;
          if (weekStreak >= 2) weekStat = `${weekStreak}-day streak · ${weekStat}`;
          else if (weekPct === 100) weekStat = `Perfect week · ${weekStat}`;
        }
      }
    }

    // Fallback to yesterday-only stat if week data unavailable
    if (!weekStat) {
      weekStat = `${doneCount}/${totalCount} done yesterday${lastCompletedLocal ? ` · finished ${lastCompletedLocal}` : ""}`;
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    const { data: debProf } = await supabase
      .from("profiles")
      .select("ai_planning_rules, ai_context_custom, is_developer, ai_personalization_enabled")
      .eq("id", user.id)
      .maybeSingle();
    const debPrefs = typeof debProf?.ai_planning_rules === "string" && debProf.ai_planning_rules.trim()
      ? `\nHonor these recurring user planning preferences:\n${String(debProf.ai_planning_rules).trim().slice(0, 800)}`
      : "";
    const debPersonal = typeof (debProf as any)?.ai_context_custom === "string" && (debProf as any).ai_context_custom.trim()
      ? `\nPersonal context (background only):\n${(debProf as any).ai_context_custom.trim().slice(0, 500)}`
      : "";

    // Learned behavioural patterns (precomputed nightly) — only used when the
    // user hasn't opted out of personalization. Feeds the recap sharper signals.
    const personalizationOn = (debProf as any)?.ai_personalization_enabled !== false;
    let debPattern: { deep_work_overrun_pct?: number; completion_by_hour?: Record<string, number>; abandoned_types?: string[] } | null = null;
    if (personalizationOn) {
      const { data: pat } = await supabase
        .from("user_patterns")
        .select("deep_work_overrun_pct, completion_by_hour, abandoned_types")
        .eq("user_id", user.id)
        .maybeSingle();
      if (pat) debPattern = pat as any;
    }

    // Date-based seeds
    const modeSeed = yesterday.split("-").reduce((acc, p) => acc + parseInt(p, 10) * 13, 3) >>> 0;
    const phraseSeed = (yesterday.split("-").reduce((acc, p) => acc * 7 + parseInt(p, 10), 11) >>> 0) + varSeed;
    const themeSeed = ((modeSeed >>> 2) + varSeed) % 6;

    const MODES = ["recap", "riddle", "quiz", "challenge"] as const;
    type Mode = typeof MODES[number];
    const VALID_MODES = new Set<string>(MODES);
    // Developer force_mode override: only honored for is_developer accounts
    const mode: Mode =
      debProf?.is_developer && typeof force_mode === "string" && VALID_MODES.has(force_mode)
        ? (force_mode as Mode)
        : MODES[modeSeed % MODES.length];

    // "Fact of the day" — always shown in non-recap modes, rotates daily
    const phraseOfDay = PHRASES[phraseSeed % PHRASES.length];

    const RIDDLE_THEMES = [
      "wordplay or a linguistic paradox",
      "lateral thinking — the most obvious answer is wrong",
      "a counterintuitive fact from science or biology",
      "history — something that existed far earlier than people assume",
      "psychology or perception — how the mind tricks itself",
      "mathematics or probability — a result that defies intuition",
    ];
    const QUIZ_THEMES = [
      "human biology or medicine",
      "ancient history or archaeology",
      "physics or chemistry",
      "animal behaviour or evolution",
      "psychology or cognitive bias",
      "language, etymology, or linguistics",
    ];
    const CHALLENGE_THEMES = [
      "a sensory or perceptual experiment you can do right now",
      "a memory or attention test",
      "a mathematical or logical puzzle",
      "a language or wordplay challenge",
      "a cognitive trick or metacognition exercise",
      "an observational challenge — noticing something you've never noticed before",
    ];

    const trim = (s: string, max = 140) => s.length > max ? s.slice(0, max - 3).trimEnd() + "…" : s;
    const cleanLine = (s: string) => String(s || "").trim().replace(/^[-•*]\s*/, "").replace(/\s+/g, " ");

    // ── Recap (stats-based) ────────────────────────────────────────────────
    if (mode === "recap") {
      const BANNED = /\b(productive|great|well done|good job|nice work|kudos|awesome|amazing|fantastic|wonderful|congrats|keep it up|you crushed|you smashed)\b/i;
      const HAS_NUMBER = /\d/;
      const HAS_QUOTED_TITLE = /['''"][^'''"]{2,}['''"]/;
      const allTitles = new Set([...doneRows.map((r) => r.title.toLowerCase()), ...skipped.map((s) => s.toLowerCase())]);
      const mentionsKnownTitle = (s: string) => {
        const low = s.toLowerCase();
        for (const t of allTitles) { if (t.length >= 3 && low.includes(t)) return true; }
        return false;
      };

      // Strongest completion hours from the learned pattern (e.g. "9am, 2pm").
      const strongestHours = debPattern?.completion_by_hour
        ? Object.entries(debPattern.completion_by_hour)
            .map(([h, pct]) => [parseInt(h, 10), Number(pct)] as [number, number])
            .filter(([h, pct]) => Number.isFinite(h) && pct >= 70)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .sort((a, b) => a[0] - b[0])
            .map(([h]) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`)
        : [];

      // ── Earnings yesterday (tracked sessions) ────────────────────────────
      // Turns the dry "done by 20:51" recap into a striking time→money line.
      // Over-fetch a ±1-day UTC window then filter to the user's local
      // `yesterday`, aggregate per snapshot currency, keep the dominant one.
      let earnedYesterday = 0;
      let trackedSecYesterday = 0;
      let earnCurrency = "";
      try {
        const lo = new Date(`${yesterday}T00:00:00Z`); lo.setUTCDate(lo.getUTCDate() - 1);
        const hi = new Date(`${yesterday}T00:00:00Z`); hi.setUTCDate(hi.getUTCDate() + 2);
        const { data: entries } = await supabase
          .from("time_entries")
          .select("started_at, ended_at, snapshot_hourly_rate, snapshot_currency")
          .eq("user_id", user.id)
          .gte("started_at", lo.toISOString())
          .lt("started_at", hi.toISOString());
        const byCur = new Map<string, { earned: number; sec: number }>();
        for (const e of entries || []) {
          if (typeof e.started_at !== "string") continue;
          let localDate: string;
          try { localDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(e.started_at)); }
          catch { localDate = e.started_at.slice(0, 10); }
          if (localDate !== yesterday) continue;
          const st = Date.parse(e.started_at);
          const en = e.ended_at ? Date.parse(e.ended_at) : st;
          const sec = Math.max(0, (en - st) / 1000);
          const rate = Number(e.snapshot_hourly_rate || 0);
          if (rate <= 0 || sec <= 0) continue;
          const cur = String(e.snapshot_currency || "USD").toUpperCase();
          const b = byCur.get(cur) || { earned: 0, sec: 0 };
          b.earned += (rate * sec) / 3600;
          b.sec += sec;
          byCur.set(cur, b);
        }
        let top: [string, { earned: number; sec: number }] | null = null;
        for (const entry of byCur.entries()) if (!top || entry[1].earned > top[1].earned) top = entry;
        if (top && top[1].earned > 0) {
          earnCurrency = top[0];
          earnedYesterday = Math.round(top[1].earned);
          trackedSecYesterday = Math.round(top[1].sec);
        }
      } catch (e) {
        console.error("[yesterday-debrief] earnings query failed:", e instanceof Error ? e.message : String(e));
      }
      const effRate = trackedSecYesterday > 0 ? Math.round(earnedYesterday / (trackedSecYesterday / 3600)) : 0;

      const userPayload = {
        completed: `${doneCount}/${totalCount}`,
        first_block_started_at: firstStart,
        last_task_completed_at: lastCompletedLocal,
        deep_work: { completed: deepDone.length, total_underrun_min: deepUnderMin },
        biggest_overrun: biggestOverrun ? { title: biggestOverrun.title, over_min: biggestOverrun.variance } : null,
        skipped_titles: skipped.slice(0, 5),
        // Week trend (always available) — lets the model spot momentum/streaks.
        week: weekTotal > 0 ? { done: weekDone, total: weekTotal, pct: weekPct, streak: weekStreak } : null,
        // Earnings yesterday — the time→money angle the user asked for.
        earnings: earnedYesterday > 0 ? {
          amount: earnedYesterday,
          currency: earnCurrency,
          tracked: fmtHrMin(trackedSecYesterday),
          per_hour: effRate,
        } : null,
        // Learned patterns (only when personalization is on) — for sharper,
        // more personal observations across days, not just yesterday.
        patterns: debPattern ? {
          deep_work_overrun_pct: debPattern.deep_work_overrun_pct ?? 0,
          strongest_hours: strongestHours,
          tends_to_skip: debPattern.abandoned_types ?? [],
        } : null,
      };

      const recapSystem = `You are DayDraft's morning Insights writer. Tone: thoughtful colleague, observant, plain, never cheerful.${debPrefs}${debPersonal}

You get four layers of data: yesterday's planned-vs-actual, the week trend, learned multi-day patterns, and (when present) money earned from tracked focus. Use whichever yields the SHARPEST, most interesting observation — don't just restate yesterday.
- If earnings data is present, make ONE bullet a striking time→money fact: how tracked focus converted to money, e.g. "$1,060 from 1h 46m of focus — that's $600/hr." Make it feel concrete and valuable, never braggy.
- Otherwise prefer a real cross-day signal: a streak ("third day finishing everything"), week momentum, a strong hour ("you finish most around 9am"), or a recurring skip pattern.
- Never invent a number or a pattern the data doesn't support. If a layer is null or thin, ignore it.

Write three things:
- yesterday: 1–2 bullet observations. Each MUST include EITHER a task title (in single quotes) OR a specific number. ≤14 words each.
- today_tip: ONE concrete action for today. Name a real task title when possible. Tie it to a pattern if one fits (e.g. schedule deep work in a strong hour). ≤16 words.
- spark: ONE short line — quote, metaphor, or sharp observation about focus/craft/time. ≤14 words.

Banned: productive, great, well done, good job, awesome, amazing, fantastic, wonderful, congrats.
Output ONLY the structured tool call.`;

      const aiArgs = await callGeminiTool(
        GEMINI_API_KEY,
        recapSystem,
        `Yesterday's data:\n${JSON.stringify(userPayload, null, 2)}\n\nWrite the recap.`,
        "build_insights",
        {
          type: "object",
          properties: {
            yesterday: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
            today_tip: { type: "string" },
            spark: { type: "string" },
          },
          required: ["yesterday", "today_tip", "spark"],
          additionalProperties: false,
        },
        0.7,
      ) ?? {};

      let modelYesterday: string[] = Array.isArray(aiArgs.yesterday) ? aiArgs.yesterday : [];
      let modelTip = typeof aiArgs.today_tip === "string" ? aiArgs.today_tip : "";
      let modelSpark = typeof aiArgs.spark === "string" ? aiArgs.spark : "";

      const yesterdayClean = modelYesterday
        .map(cleanLine).filter(Boolean)
        .filter((b) => !BANNED.test(b))
        .filter((b) => HAS_NUMBER.test(b) || HAS_QUOTED_TITLE.test(b) || mentionsKnownTitle(b))
        .map((b) => trim(b)).slice(0, 2);

      let tipClean = cleanLine(modelTip);
      if (BANNED.test(tipClean)) tipClean = "";
      tipClean = trim(tipClean, 160);

      let sparkClean = cleanLine(modelSpark);
      if (BANNED.test(sparkClean)) sparkClean = "";
      sparkClean = trim(sparkClean, 140);

      if (!yesterdayClean.length) {
        if (earnedYesterday > 0) {
          yesterdayClean.push(`${fmtMoney(earnedYesterday, earnCurrency)} from ${fmtHrMin(trackedSecYesterday)} of focus — ${fmtMoney(effRate, earnCurrency)}/hr.`);
        }
        yesterdayClean.push(`Completed ${doneCount} of ${totalCount} tasks${lastCompletedLocal ? `, done by ${lastCompletedLocal}.` : "."}`);
        if (biggestOverrun) yesterdayClean.push(`'${biggestOverrun.title}' ran ${biggestOverrun.variance}m over estimate.`);
        else if (deepUnderMin > 0 && deepDone.length > 0) yesterdayClean.push(`Deep work finished ${deepUnderMin}m under estimate across ${deepDone.length} block${deepDone.length === 1 ? "" : "s"}.`);
        yesterdayClean.splice(2); // keep at most 2 bullets
      }
      if (!tipClean) {
        if (skipped.length) tipClean = `Restart '${skipped[0]}' as a 25-minute first block this morning.`;
        else if (biggestOverrun) tipClean = `Pad '${biggestOverrun.title}' by ${Math.min(30, Math.round(biggestOverrun.variance / 5) * 5)}m on today's plan.`;
        else if (firstStart) tipClean = `Start your first block by ${firstStart} to match yesterday's rhythm.`;
        else tipClean = `Pick the one task that earns the most momentum and start it first.`;
      }
      if (!sparkClean) {
        const SPARKS = [
          "A finished draft beats a perfect outline.", "Move the marble first; sharpen the chisel after.",
          "Slow is smooth; smooth is fast.", "Time will pass either way — pick your work.",
          "Start before you feel ready; momentum is the teacher.", "Decide once. Execute many.",
          "The cost of waiting is paid in pieces no one notices.", "Do the thing you can't outsource to your future self.",
          "Small block, real progress — then earn the next one.", "Don't tidy the desk. Open the file.",
          "Energy compounds; willpower spends. Bank what you can.", "Cross one thing off before you check the inbox.",
        ];
        const seed = yesterday.split("-").reduce((acc, p) => acc * 31 + parseInt(p, 10), 7) >>> 0;
        sparkClean = SPARKS[seed % SPARKS.length];
      }

      return new Response(JSON.stringify({
        show: true, date: yesterday, mode: "recap", title: "Insights",
        yesterday: yesterdayClean, today_tip: tipClean, spark: sparkClean, bullets: yesterdayClean,
        week_stat: weekStat,
        phrase_of_day: phraseOfDay,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Riddle ─────────────────────────────────────────────────────────────
    if (mode === "riddle") {
      const theme = RIDDLE_THEMES[themeSeed];
      const riddleSystem = `You write the daily riddle for an app. Voice: playful, quick, a little cheeky — the kind that makes someone smile and go "oh, nice." Clever pub-quiz banter, not a dusty riddle book.

Today's angle: ${theme}.

Rules:
- SHORT. One sentence. A second only if it's a tiny twist. No "I am…" preamble, no purple prose.
- Misdirect: the obvious answer is wrong; the real one makes them grin.
- Answer: a word or two.
- fun_fact: the punchline that makes it click — witty, light, one short line.
- NO productivity, planning, or motivational fluff. Just a fun brain-tickle.

Vibe to match (don't copy): "What gets wetter the more it dries?" → A towel.

Output ONLY the structured tool call.`;

      const aiArgs = await callGeminiTool(
        GEMINI_API_KEY,
        riddleSystem,
        `Write a riddle in the category: ${theme}.`,
        "build_riddle",
        {
          type: "object",
          properties: {
            riddle: { type: "string", description: "The riddle — ONE short sentence (two max, the second tiny). Punchy, playful, no preamble. Under 25 words." },
            riddle_answer: { type: "string", description: "The answer. ≤4 words." },
            fun_fact: { type: "string", description: "The witty payoff that makes it click — one light line, ≤16 words." },
          },
          required: ["riddle", "riddle_answer", "fun_fact"],
          additionalProperties: false,
        },
        0.95,
      ) ?? {};

      let riddleText = cleanLine(aiArgs.riddle || "");
      let riddleAnswer = cleanLine(aiArgs.riddle_answer || "");
      let funFact = cleanLine(aiArgs.fun_fact || "");

      if (!riddleText || !riddleAnswer) {
        const FALLBACKS = [
          { riddle: "What gets wetter the more it dries?", answer: "A towel", fact: "It dries you by soaking it all up — working itself soggy." },
          { riddle: "I'm always coming but never arrive. What am I?", answer: "Tomorrow", fact: "By the time it shows up it's today — forever one sleep away." },
          { riddle: "What has loads of keys but can't open a single door?", answer: "A piano", fact: "88 keys, zero locks — the only thing it unlocks is a tune." },
          { riddle: "What runs all day but never gets up and walks?", answer: "A fridge", fact: "Been running since you bought it and hasn't gone anywhere." },
          { riddle: "What can you catch but never throw?", answer: "A cold", fact: "Your immune system would love it if you could throw this one back." },
          { riddle: "The more you take, the more you leave behind. What am I?", answer: "Footsteps", fact: "Every step you 'take' is one you leave right where you stood." },
        ];
        const fb = FALLBACKS[(modeSeed + varSeed) % FALLBACKS.length];
        riddleText = fb.riddle; riddleAnswer = fb.answer; funFact = fb.fact;
      }

      return new Response(JSON.stringify({
        show: true, date: yesterday, mode: "riddle",
        riddle: trim(riddleText, 220),
        riddle_answer: trim(riddleAnswer, 50),
        fun_fact: funFact ? trim(funFact, 140) : undefined,
        phrase_of_day: phraseOfDay,
        week_stat: weekStat,
        yesterday: [], today_tip: "", spark: "", bullets: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Quiz ───────────────────────────────────────────────────────────────
    if (mode === "quiz") {
      const theme = QUIZ_THEMES[themeSeed];
      const quizSystem = `You are a quiz writer for a daily app. Style: British QI — questions where the obvious answer is wrong and the real answer is genuinely surprising.

Today's category: ${theme}.

Write 2 multiple-choice questions (3 options each):
- The "obvious" or "expected" answer should be one of the wrong options (to set up the QI surprise)
- The correct answer should make people say "really?!"
- The explanation is the payoff — make it genuinely interesting, not just "correct because..."
- NO productivity tips, NO planning, NO motivational content

Output ONLY the structured tool call.`;

      const aiArgs = await callGeminiTool(
        GEMINI_API_KEY,
        quizSystem,
        `Write 2 QI-style questions in the category: ${theme}.`,
        "build_quiz",
        {
          type: "object",
          properties: {
            quiz: {
              type: "array", minItems: 2, maxItems: 2,
              items: {
                type: "object",
                properties: {
                  q: { type: "string", description: "The question. ≤20 words." },
                  options: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
                  correct: { type: "integer", description: "0-based index of the correct option." },
                  explanation: { type: "string", description: "The surprising payoff. ≤25 words." },
                },
                required: ["q", "options", "correct", "explanation"],
                additionalProperties: false,
              },
            },
          },
          required: ["quiz"],
          additionalProperties: false,
        },
        0.95,
      ) ?? {};

      const rawQuiz = Array.isArray(aiArgs.quiz) ? aiArgs.quiz : [];
      const validQuiz = rawQuiz
        .filter((q: any) => typeof q?.q === "string" && Array.isArray(q?.options) && q.options.length >= 2 && typeof q?.correct === "number")
        .slice(0, 2);

      const finalQuiz = validQuiz.length >= 1 ? validQuiz.map((q: any) => ({
        q: trim(cleanLine(q.q), 120),
        options: (q.options as string[]).slice(0, 3).map((o: string) => trim(cleanLine(o), 80)),
        correct: Math.max(0, Math.min(q.correct, (q.options as string[]).length - 1)),
        explanation: q.explanation ? trim(cleanLine(q.explanation), 200) : undefined,
      })) : [
        // Curated QI fallbacks
        ...[
          [
            { q: "How many senses does a human actually have?", options: ["5", "9", "More than 20"], correct: 2, explanation: "Beyond the classic 5, humans have proprioception, thermoception, nociception, equilibrioception and more — scientists count 20+." },
            { q: "Which came first: the chicken or the egg?", options: ["The chicken", "The egg", "They emerged simultaneously"], correct: 1, explanation: "Eggs predate chickens by hundreds of millions of years — dinosaurs laid eggs long before any chicken evolved." },
          ],
          [
            { q: "What colour is a perfect mirror?", options: ["Silver", "White", "Very pale green"], correct: 2, explanation: "Real mirrors reflect green wavelengths slightly more than others, giving them a faint green tint — visible when two mirrors face each other." },
            { q: "How long can a cockroach survive without its head?", options: ["A few seconds", "About a day", "Several weeks"], correct: 2, explanation: "Cockroaches breathe through spiracles in their body segments, not their head — they only die because they can no longer drink water." },
          ],
        ][(Math.floor(modeSeed / 4) + varSeed) % 2],
      ];

      return new Response(JSON.stringify({
        show: true, date: yesterday, mode: "quiz",
        quiz: finalQuiz,
        phrase_of_day: phraseOfDay,
        week_stat: weekStat,
        yesterday: [], today_tip: "", spark: "", bullets: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Challenge ──────────────────────────────────────────────────────────
    if (mode === "challenge") {
      const theme = CHALLENGE_THEMES[themeSeed];
      const challengeSystem = `You are a daily challenge writer. Style: a short, fascinating micro-experiment the user can try right now in under 5 minutes.

Today's type: ${theme}.

Write ONE challenge that:
- Can be done immediately, where the user is sitting right now
- Reveals something genuinely surprising about perception, memory, physics, language, or the mind
- Is NOT about productivity, planning, tasks, or time management
- Has a satisfying "aha" payoff when completed

challenge_context: the surprising thing the challenge reveals (≤20 words — make it the payoff, not an instruction).

Output ONLY the structured tool call.`;

      const aiArgs = await callGeminiTool(
        GEMINI_API_KEY,
        challengeSystem,
        `Write a challenge of type: ${theme}.`,
        "build_challenge",
        {
          type: "object",
          properties: {
            challenge: { type: "string", description: "The challenge. Specific, doable right now. ≤30 words." },
            challenge_context: { type: "string", description: "The surprising reveal. ≤20 words." },
          },
          required: ["challenge", "challenge_context"],
          additionalProperties: false,
        },
        0.95,
      ) ?? {};

      let challengeText = cleanLine(aiArgs.challenge || "");
      let challengeContext = cleanLine(aiArgs.challenge_context || "");

      if (!challengeText) {
        const FALLBACKS = [
          { challenge: "Say the word 'shop' ten times fast, then answer instantly: what do you do at a green light?", context: "Most people say 'stop' — the Stroop-like repetition primes the wrong word and hijacks your automatic answer." },
          { challenge: "Without looking, write down the exact icons in the bottom row of your phone's home screen.", context: "We see these icons hundreds of times a day yet rarely consciously encode them — familiarity is not the same as memory." },
          { challenge: "Count how many F's appear in: 'FINISHED FILES ARE THE RESULT OF YEARS OF SCIENTIFIC STUDY.'", context: "Most people count 3. The real answer is 6 — the brain silently skips 'of' because it's processed as a function word." },
          { challenge: "Close your eyes and try to point to exactly where your nose is, without touching your face first.", context: "Your brain models your entire body in 3D space continuously — proprioception works even without touch or vision." },
          { challenge: "Rub your hands together fast for 10 seconds, then hold them 2 cm apart and slowly pull them away.", context: "You'll feel a subtle resistance — heat and static electricity create a detectable field between your palms." },
          { challenge: "Stare at the centre of a bright red object for 30 seconds, then look at a white wall.", context: "You'll see a cyan afterimage — your retinal cones for red fatigue, and the opponent colour takes over." },
        ];
        const fb = FALLBACKS[(modeSeed + varSeed) % FALLBACKS.length];
        challengeText = fb.challenge;
        challengeContext = fb.context;
      }

      return new Response(JSON.stringify({
        show: true, date: yesterday, mode: "challenge",
        challenge: trim(challengeText, 250),
        challenge_context: challengeContext ? trim(challengeContext, 160) : "",
        phrase_of_day: phraseOfDay,
        week_stat: weekStat,
        yesterday: [], today_tip: "", spark: "", bullets: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ show: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
