import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const FREE_PLAN_LIMIT = 5;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { raw_input: rawInputValue, energy_preference, name, mode, start_time, clarified_tasks, planning_context, plan_date, now_iso, timezone, hours_already_committed, active_hours_start, active_hours_end, ai_tone, ai_tone_custom, behavior_signals, ai_memory } = await req.json();
    let raw_input = rawInputValue;
    if (!raw_input || typeof raw_input !== "string") {
      return new Response(JSON.stringify({ error: "raw_input required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const splitTaskLines = (text: string) =>
      text
        .split(/\r?\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
        .filter(Boolean);
    const wordCount = (line: string) => (line.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
    const endsWithDanglingWord = (line: string) => {
      const dangling = new Set(["a", "an", "the", "to", "for", "with", "on", "at", "from", "of", "in", "by", "into", "onto", "about"]);
      const words = (line.toLowerCase().match(/[a-z0-9]+/g) || []);
      if (!words.length) return false;
      return dangling.has(words[words.length - 1]);
    };
    const isLikelyIncomplete = (line: string) => {
      if (wordCount(line) < 4) return true;
      if (endsWithDanglingWord(line)) return true;
      if (/[,:;/\-]\s*$/.test(line)) return true;
      return false;
    };
    const taskLines = splitTaskLines(raw_input);
    const completeLines = taskLines.filter((l) => !isLikelyIncomplete(l));
    const frequentContextWords = (() => {
      const stop = new Set(["work", "task", "plan", "today", "tomorrow", "and", "the", "for", "with", "from", "into", "on", "at", "to"]);
      const counts = new Map<string, number>();
      for (const line of completeLines) {
        const words = line.toLowerCase().match(/[a-z]{3,}/g) || [];
        for (const w of words) {
          if (stop.has(w)) continue;
          counts.set(w, (counts.get(w) || 0) + 1);
        }
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
    })();
    const autoCompleteTask = (line: string): string | null => {
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();
      if (!lower) return null;
      // If an existing complete line starts with this unfinished fragment, reuse it.
      const prefixMatch = completeLines.find((l) => l.toLowerCase().startsWith(lower));
      if (prefixMatch && prefixMatch.length > trimmed.length + 2) return prefixMatch;
      // If a complete line contains this fragment and is not too different, reuse.
      const containsMatch = completeLines.find((l) => l.toLowerCase().includes(lower) && l.length <= trimmed.length + 24);
      if (containsMatch && containsMatch.length > trimmed.length + 2) return containsMatch;
      // If it ends with a dangling preposition/article, append a context noun.
      if (endsWithDanglingWord(trimmed) && frequentContextWords.length) {
        return `${trimmed} ${frequentContextWords[0]}`.replace(/\s+/g, " ").trim();
      }
      return null;
    };
    const incomplete = taskLines
      .map((line) => ({
        line,
        incomplete: isLikelyIncomplete(line),
      }))
      .filter((x) => x.incomplete);
    if (incomplete.length) {
      const findings = incomplete.map(({ line }) => {
        const suggestion = autoCompleteTask(line);
        const reason = wordCount(line) < 4
          ? "too short"
          : endsWithDanglingWord(line)
            ? "ends with a dangling preposition/article"
            : "grammatically unfinished";
        return { line, reason, suggestion };
      });
      const unresolved = findings.filter((f) => !f.suggestion);
      if (unresolved.length) {
        const flaggedPreview = taskLines.map((line) => {
          const f = findings.find((x) => x.line === line);
          if (!f) return line;
          if (f.suggestion) return f.suggestion;
          return `${line} [clarify: finish this task so planning is accurate]`;
        }).join("\n");
        return new Response(
          JSON.stringify({
            error: `Please clarify ${unresolved.length} incomplete task${unresolved.length === 1 ? "" : "s"} before planning.`,
            code: "INCOMPLETE_TASKS_NEED_CLARIFICATION",
            flagged_tasks: findings,
            suggested_raw_input: flaggedPreview,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // All incomplete lines were confidently auto-completed from context clues.
      const rewrites = new Map(findings.map((f) => [f.line, f.suggestion || f.line]));
      const rewritten = taskLines.map((line) => rewrites.get(line) || line).join("\n");
      // Use rewritten input for planning; include a note in subtext via context.
      raw_input = rewritten;
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    // Optional: pull user_patterns + calendar events if authenticated
    let pattern: any = null;
    let calendarEvents: any[] = [];
    let authedUserId: string | null = null;
    let authedSupabase: ReturnType<typeof createClient> | null = null;
    let tier: "free" | "trial" | "pro" = "free";
    const auth = req.headers.get("Authorization");
    if (auth) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: auth } } }
        );
        authedSupabase = supabase;
        const { data: u } = await supabase.auth.getUser();
        if (u?.user) {
          authedUserId = u.user.id;
          const { data: p } = await supabase.from("user_patterns").select("*").eq("user_id", u.user.id).maybeSingle();
          pattern = p;
          // Pro: pull today's calendar events if connected
          const { data: sub } = await supabase.from("subscriptions").select("status").eq("user_id", u.user.id).maybeSingle();
          const isPro = sub?.status === "active" || sub?.status === "trialing";
          tier = sub?.status === "active" ? "pro" : sub?.status === "trialing" ? "trial" : "free";
          const { data: tok } = await supabase.from("calendar_tokens").select("user_id").eq("user_id", u.user.id).maybeSingle();
          if (isPro && tok) {
            const ev = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/fetch-calendar-events`, {
              headers: { Authorization: auth, "Content-Type": "application/json" },
            });
            if (ev.ok) {
              const j = await ev.json();
              calendarEvents = j.events || [];
            }
          }
        }
      } catch (_e) { /* non-fatal */ }
    }

    const peakMap: Record<string, string> = {
      morning: "8:00 to 12:00",
      midday: "11:00 to 15:00",
      night: "19:00 to 23:00",
    };
    const peak = peakMap[energy_preference] || peakMap.morning;
    const defaultStart = energy_preference === "night" ? 18 : 9;
    // Compute local "now" in the user's timezone if provided.
    const nowDate = now_iso ? new Date(now_iso) : new Date();
    const todayLocal = (() => {
      try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC" }).format(nowDate);
      } catch { return nowDate.toISOString().slice(0, 10); }
    })();
    const isPlanningToday = !plan_date || plan_date === todayLocal;
    const nowHHMM = (() => {
      try {
        return new Intl.DateTimeFormat("en-GB", { timeZone: timezone || "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(nowDate);
      } catch { return `${String(nowDate.getHours()).padStart(2,"0")}:${String(nowDate.getMinutes()).padStart(2,"0")}`; }
    })();
    // For today: never schedule before "now". Round up to the next 5-min mark.
    let earliestStart: string;
    if (isPlanningToday) {
      const [hh, mm] = nowHHMM.split(":").map(Number);
      const rounded = Math.ceil((mm + 1) / 5) * 5;
      const eh = rounded >= 60 ? hh + 1 : hh;
      const em = rounded >= 60 ? 0 : rounded;
      earliestStart = `${String(Math.min(23, eh)).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
    } else {
      earliestStart = start_time || `${String(defaultStart).padStart(2, "0")}:00`;
    }
    const startHour = earliestStart.split(":")[0];
    // Hours remaining today (until 23:59).
    const hoursLeftToday = isPlanningToday
      ? Math.max(0, 23 - parseInt(nowHHMM.split(":")[0], 10) + (parseInt(nowHHMM.split(":")[1], 10) < 30 ? 0.5 : 0))
      : 16;

    const isReplan = mode === "replan";
    const activeStart = (typeof active_hours_start === "string" && /^\d{2}:\d{2}$/.test(active_hours_start)) ? active_hours_start : "09:00";
    const activeEnd = (typeof active_hours_end === "string" && /^\d{2}:\d{2}$/.test(active_hours_end)) ? active_hours_end : "22:00";

    const overshootAvg = { work: 0, personal: 0, rest: 0 };
    const overshootByTaskType = { deep_work: 0, communication: 0, routine: 0 };
    let overshootSamples = 0;
    let learningActive = false;
    let learnedPeakWindow = "";
    let chronicTaskTitles: string[] = [];
    if (authedSupabase && authedUserId) {
      try {
        const since14 = new Date(nowDate);
        since14.setDate(since14.getDate() - 13);
        const { data: histBlocks } = await authedSupabase
          .from("blocks")
          .select("id,title,estimated_minutes,actual_minutes,block_type,kind,type,completed,created_at")
          .eq("user_id", authedUserId)
          .gte("created_at", since14.toISOString())
        const { data: histEntries } = await authedSupabase
          .from("time_entries")
          .select("started_at,ended_at,block_id")
          .eq("user_id", authedUserId)
          .gte("started_at", since14.toISOString())
          .not("block_id", "is", null)
          .not("ended_at", "is", null);
        const { data: histPlans } = await authedSupabase
          .from("plans")
          .select("date")
          .eq("user_id", authedUserId)
          .gte("date", since14.toISOString().slice(0, 10));
        const activeDays = new Set<string>();
        for (const p of (histPlans || []) as any[]) {
          if (typeof p?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) activeDays.add(p.date);
        }
        for (const e of (histEntries || []) as any[]) {
          if (!e?.started_at) continue;
          const d = new Date(e.started_at);
          if (Number.isNaN(d.getTime())) continue;
          activeDays.add(d.toISOString().slice(0, 10));
        }
        learningActive = tier === "pro" && activeDays.size >= 14;
        const buckets: Record<"work" | "personal" | "rest", number[]> = { work: [], personal: [], rest: [] };
        const typeBuckets: Record<"deep_work" | "communication" | "routine", number[]> = {
          deep_work: [],
          communication: [],
          routine: [],
        };
        const byId = new Map<string, any>();
        for (const b of (histBlocks || []) as any[]) {
          if (b?.id) byId.set(String(b.id), b);
          const est = Number(b?.estimated_minutes || 0);
          const act = Number(b?.actual_minutes || 0);
          if (!(est > 0) || !(act >= 0)) continue;
          const bt: "work" | "personal" | "rest" =
            b?.block_type === "work" || b?.block_type === "personal" || b?.block_type === "rest"
              ? b.block_type
              : (b?.kind === "break" || b?.kind === "lunch")
                ? "rest"
                : "work";
          const pct = Math.max(-1, Math.min(3, (act - est) / est));
          buckets[bt].push(pct);
          const tt: "deep_work" | "communication" | "routine" =
            b?.type === "deep_work" || b?.type === "communication" || b?.type === "routine"
              ? b.type
              : "routine";
          typeBuckets[tt].push(pct);
          overshootSamples += 1;
        }
        (["work", "personal", "rest"] as const).forEach((k) => {
          const arr = buckets[k];
          overshootAvg[k] = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
        });
        (["deep_work", "communication", "routine"] as const).forEach((k) => {
          const arr = typeBuckets[k];
          overshootByTaskType[k] = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
        });
        // Peak hours = hours where tracked task work tends to finish under estimate.
        const hourBuckets = new Map<number, number[]>();
        for (const e of (histEntries || []) as any[]) {
          const bid = e?.block_id ? String(e.block_id) : "";
          if (!bid || !byId.has(bid)) continue;
          const b = byId.get(bid);
          const est = Number(b?.estimated_minutes || 0);
          if (!(est > 0)) continue;
          const s = new Date(e.started_at).getTime();
          const t = new Date(e.ended_at).getTime();
          if (!Number.isFinite(s) || !Number.isFinite(t) || t <= s) continue;
          const actual = (t - s) / 60000;
          const ratio = Math.max(-1, Math.min(2, (actual - est) / est));
          const h = new Date(e.started_at).getHours();
          const arr = hourBuckets.get(h) || [];
          arr.push(ratio);
          hourBuckets.set(h, arr);
        }
        const rankedHours = [...hourBuckets.entries()]
          .map(([h, vals]) => ({
            h,
            n: vals.length,
            avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0,
          }))
          .filter((x) => x.n >= 2)
          .sort((a, b) => a.avg - b.avg || b.n - a.n);
        const best = rankedHours.filter((x) => x.avg <= -0.08).slice(0, 3).map((x) => x.h).sort((a, b) => a - b);
        if (best.length) {
          const start = Math.max(0, best[0]);
          const end = Math.min(23, best[best.length - 1] + 1);
          learnedPeakWindow = `${String(start).padStart(2, "0")}:00 to ${String(end).padStart(2, "0")}:00`;
        }
        // Chronic procrastination tasks: appears >=3 times, never completed in lookback.
        const chronicMap = new Map<string, { title: string; seen: number; done: number }>();
        for (const b of (histBlocks || []) as any[]) {
          if (b?.kind !== "task") continue;
          const title = String(b?.title || "").trim();
          if (!title) continue;
          const key = title.toLowerCase();
          const row = chronicMap.get(key) || { title, seen: 0, done: 0 };
          row.seen += 1;
          if (b?.completed) row.done += 1;
          chronicMap.set(key, row);
        }
        chronicTaskTitles = [...chronicMap.values()]
          .filter((r) => r.seen >= 3 && r.done === 0)
          .sort((a, b) => b.seen - a.seen)
          .map((r) => r.title)
          .slice(0, 3);
      } catch {
        // no-op: fallback to default buffer behavior
      }
    }
    const hasOvershootHistory = overshootSamples >= 8;
    const patternBufferEnabled = hasOvershootHistory && overshootAvg.work >= 0.18;
    const defaultBufferEnabled = overshootSamples === 0;
    const patternBufferMin = overshootAvg.work >= 0.3 ? 15 : 10;
    const defaultBufferMin = 10;

    // Server-side quota enforcement (free tier): prevents bypassing UI checks.
    // Re-planning an already-counted date is allowed.
    if (authedUserId && tier === "free") {
      const targetDate =
        typeof plan_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(plan_date)
          ? plan_date
          : todayLocal;

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: auth || "" } } }
      );
      const { data: plans } = await supabase
        .from("plans")
        .select("date, blocks(id)")
        .eq("user_id", authedUserId);
      const usedDates = new Set(
        (plans || [])
          .filter((p: { blocks?: { id: string }[] | null }) => Array.isArray(p.blocks) && p.blocks.length > 0)
          .map((p: { date: string }) => p.date)
      );
      const alreadyCounted = usedDates.has(targetDate);
      if (!alreadyCounted && usedDates.size >= FREE_PLAN_LIMIT) {
        return new Response(
          JSON.stringify({
            error: `Free trial limit reached — ${FREE_PLAN_LIMIT} planning days used. Upgrade to Pro for unlimited plans.`,
            code: "PLAN_QUOTA_REACHED",
            tier: "free",
            limit: FREE_PLAN_LIMIT,
            used: usedDates.size,
          }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const toneMap: Record<string, string> = {
      professional: `Tone profile: PROFESSIONAL
- Voice: concise, executive, practical.
- Style: clear verbs, concrete outcomes, no slang.
- Constraints: no emojis; avoid hype; avoid vague inspiration.`,
      coach: `Tone profile: COACH
- Voice: warm, supportive, action-oriented.
- Style: encouragement + specific next action in the same sentence.
- Constraints: no empty praise; keep advice operational.`,
      playful: `Tone profile: PLAYFUL
- Voice: light, friendly, confident.
- Style: keep language clear and useful with subtle personality.
- Constraints: max one emoji in subtext; never reduce clarity.`,
      motivational: `Tone profile: MOTIVATIONAL
- Voice: energetic, decisive, momentum-first.
- Style: strong verbs, confident framing, action bias.
- Constraints: keep it grounded in schedule reality (no overpromising).`,
      tough_love: `Tone profile: TOUGH_LOVE
- Voice: direct, disciplined, accountable.
- Style: short firm lines, prioritization pressure, explicit trade-offs.
- Constraints: no insults, no hostility, no emojis.`,
      philosophical: `Tone profile: PHILOSOPHICAL
- Voice: calm, reflective, perspective-driven.
- Style: concise insight framing + practical execution step.
- Constraints: max one brief quote-like phrase; avoid abstraction without action.`,
    };
    const toneOutputHint = ai_tone === "tough_love"
      ? `Output style: keep summary/subtext forceful and concise, with explicit priority trade-offs.`
      : ai_tone === "coach"
        ? `Output style: summary/subtext should feel supportive and confidence-building while staying concrete.`
        : ai_tone === "playful"
          ? `Output style: summary/subtext can be upbeat and friendly (max one emoji).`
          : ai_tone === "motivational"
            ? `Output style: summary/subtext should emphasize momentum and decisive action.`
            : ai_tone === "philosophical"
              ? `Output style: summary/subtext should be reflective but practical, with one clear action lens.`
              : `Output style: summary/subtext should be clear, pragmatic, and concise.`;
    const toneLine = ai_tone === "custom" && ai_tone_custom
      ? `Tone profile: CUSTOM
- Follow this user-defined style exactly where possible: ${String(ai_tone_custom).slice(0, 300)}
- Keep output concrete, structured, and useful.
- Never violate safety and scheduling constraints.`
      : `${toneMap[ai_tone] || toneMap.professional}
${toneOutputHint}`;
    // Hours already accounted for elsewhere on the same date (completed
    // blocks from earlier today, fixed calendar events, etc.). The AI must
    // subtract this from the available window so it never over-promises.
    const committed = Number(hours_already_committed) || 0;
    const trueHoursLeft = Math.max(0, hoursLeftToday - committed);
    const clarifiedHints = Array.isArray(clarified_tasks) && clarified_tasks.length ? `

USER-CLARIFIED TASKS (authoritative — DO NOT change titles, durations, or fixed times; use these instead of re-parsing raw_input):
${clarified_tasks.map((t: any, i: number) => {
  const fixed = t.fixed_time ? ` — FIXED at ${t.fixed_time} (must start exactly here)` : "";
  const prio = t.priority ? ` [${t.priority} priority]` : "";
  return `${i + 1}. "${t.title}" — ${t.estimate_min}m${prio}${fixed}`;
}).join("\n")}

Rules for clarified tasks:
- Use the EXACT title and duration_min the user provided.
- Schedule HIGH priority tasks in the peak window first.
- LOW priority tasks fill remaining time; drop them if the day overflows 8h.
- For tasks with FIXED times, set start_time to that exact value and arrange other tasks around them.` : "";

    const patternHints = pattern ? `
User patterns (use to compound intelligence):
- Deep work overrun: ${Number(pattern.deep_work_overrun_pct || 0).toFixed(0)}% (account for it; pad deep blocks if positive)
- Top abandoned types: ${JSON.stringify(pattern.abandoned_types || [])}
- Completion by hour: ${JSON.stringify(pattern.completion_by_hour || {})}` : "";
    const behaviorHints = behavior_signals ? `
Recent behavior signals:
- Completion rate (14d): ${Number(behavior_signals.completion_rate_14d || 0).toFixed(2)}
- Average completed task duration (14d): ${Math.round(Number(behavior_signals.avg_completed_task_min_14d || 0))}m
- Tracking coverage (7d): ${Number(behavior_signals.tracking_coverage_7d || 0).toFixed(2)}
Use this to keep plans realistic: if completion rate < 0.65, trim low-priority volume by default; if avg completed task duration is short, prefer smaller blocks.` : "";
    const overshootHints = `
14-day plan vs actual history:
- Samples: ${overshootSamples}
- Avg overshoot work: ${(overshootAvg.work * 100).toFixed(0)}%
- Avg overshoot personal: ${(overshootAvg.personal * 100).toFixed(0)}%
- Avg overshoot rest: ${(overshootAvg.rest * 100).toFixed(0)}%
Buffer policy:
- Pattern-based buffers active: ${patternBufferEnabled ? "yes" : "no"}${patternBufferEnabled ? ` (${patternBufferMin}m after deep-work blocks)` : ""}
- New-user default buffers active: ${defaultBufferEnabled ? "yes" : "no"}${defaultBufferEnabled ? ` (${defaultBufferMin}m after each 2h+ work sequence)` : ""}`;
    const memoryHints = ai_memory ? `
AI weekly memory:
- Best focus hours: ${String(ai_memory.best_focus_hours || "unknown")}
- Realistic block length: ${Math.round(Number(ai_memory.realistic_block_min || 45))}m
- Common slip pattern: ${String(ai_memory.common_slip || "none")}
- Recommendation: ${String(ai_memory.recommendation || "keep plans realistic")}
Use these as defaults unless they conflict with fixed commitments.` : "";
    const learningHints = learningActive ? `
Pattern learning is ACTIVE (14-day plans + time tracking):
- Detected peak hours: ${learnedPeakWindow || "not enough signal"}
- Overshoot by task type: deep_work ${(overshootByTaskType.deep_work * 100).toFixed(0)}%, communication ${(overshootByTaskType.communication * 100).toFixed(0)}%, routine ${(overshootByTaskType.routine * 100).toFixed(0)}%
- Chronic procrastination tasks (3+ appearances, no completion): ${chronicTaskTitles.length ? chronicTaskTitles.join(", ") : "none"}
How to apply:
- Schedule deep work inside detected peak hours when feasible.
- Auto-inflate duration for task types with consistent overshoot.
- If a chronic task is included, flag it with: "You've pushed this 3 times — want to break it into smaller steps?"` : "";
    const emotionalContext = typeof planning_context === "string" ? planning_context.trim() : "";
    const emotionalHints = emotionalContext ? `
Optional user context (light emotional/deadline signal):
- ${emotionalContext}
How to use it:
- Let this influence ordering and framing of the day.
- If there is a clear deadline/call time, schedule preparation before it and lighter work after.
- If there is dread/friction around a task, consider placing it earlier and mention a supportive framing in reasoning/subtext.
- Keep this supportive and practical; never block planning on missing context.` : "";

    const calHints = calendarEvents.length ? `
FIXED calendar events you must schedule around (do not move, do not duplicate; emit them as kind="task" with type="communication" and a reasoning that mentions "from your calendar"):
${calendarEvents.map((e: any) => `- ${e.start_time} (${e.duration_min}m) ${e.title}`).join("\n")}` : "";

    const system = `You are DayDraft, an expert productivity planner. Build a realistic, energy-aware schedule from a raw task list.
${toneLine}
Context:
- Current local time: ${nowHHMM} (${timezone || "UTC"}).
- Planning date: ${plan_date || todayLocal} ${isPlanningToday ? "(TODAY)" : "(future date)"}.
- Raw hours remaining in the day: ~${hoursLeftToday.toFixed(1)}h.
- Hours already committed (completed work / fixed events): ~${committed.toFixed(1)}h.
- Realistic hours you can plan into: ~${trueHoursLeft.toFixed(1)}h.
- User active hours: ${activeStart}–${activeEnd}. NEVER schedule any block outside this window.
Rules:
- Front-load deep work in the user's peak window (${learnedPeakWindow || peak}) ONLY if it's still ahead.
- Batch communication into 1-2 blocks, ideally after the peak.
- Insert one 15-min break after ~2h of deep work, and a 60-min lunch around 12:00 (or 18:00 for night owls) ONLY if it's still ahead.
- Each task block: 25-90 min. Keep total day under 8 working hours.
- ${isPlanningToday ? `THIS IS TODAY. The first block MUST start at or after ${earliestStart}. NEVER schedule any block in the past. If the peak window has already passed, do deep work now anyway.` : `Day starts around ${startHour}:00.`}${isReplan ? " This is a MID-DAY RE-PLAN — start now and only schedule what's left." : ""}
- HARD BUDGET: the sum of duration_min of all task blocks MUST NOT exceed ${Math.round(trueHoursLeft * 60)} minutes. If the user's input would exceed this, drop the lowest-priority items and START the subtext with "⚠️ Heads up: " followed by exactly which items got dropped and why (e.g. "⚠️ Heads up: dropped 'finish slides' — only ${trueHoursLeft.toFixed(1)}h left today.").
- Classify each task as deep_work, communication, or routine.
- Use kind="task" for actual tasks, "break" for breaks, "lunch" for lunch.
- Also set block_type for every block:
  - "rest" for breaks/lunch and transition/recovery blocks,
  - "personal" for errands/personal logistics (visits, groceries, appointments, family logistics),
  - "work" for everything else.
- Extract location hints from raw text (e.g. "gym at 2pm", "lunch at Blue Bottle Mission") and include a short location string.
- For EVERY task, include a one-sentence "reasoning" explaining placement (e.g. "Deep work first — your peak").
- Never return a task block longer than 90 minutes. Split longer work into sequential sub-blocks.
- TASK TITLE SOURCE OF TRUTH: task titles MUST reuse the user's original wording from raw_input (or clarified_tasks when provided). Preserve key nouns/verbs from the user's phrasing and only normalize capitalization/punctuation.
- FORBIDDEN TITLES: never invent generic labels like "Deep focus work session 1", "Focus block 2", "Work session", "Task block", or similar template names.
- WHEN SPLITTING ONE TASK: keep the same base title from user wording and append a natural qualifier in parentheses, e.g. "Work on landing page (part 1)", "Work on landing page (part 2)". Do not use "session 1/2" wording.
- Buffers: when pattern-based buffers are active, insert a short 10-15m "Buffer" or "Transition" block (kind="break", type="routine", block_type="rest") between deep-work tasks. If no history and default buffers are active, insert a 10m buffer after each 2h+ work sequence.
- Buffer note in subtext: if buffers are inserted, include exactly one note — "Buffers added based on your patterns" or "Buffers added as default" (for new users).
- LIGHT-DAY DETECTION: if the user only listed a tiny amount of work (≤ 60 min total) AND there is plenty of time left in the day (trueHoursLeft ≥ 4h), do NOT pad with invented tasks. Instead, schedule ONLY what the user gave you and START the subtext with "✨ Light day — " followed by a warm one-liner suggesting a self-care or restorative activity (walk, stretch, read, call a friend). Do not add those activities as blocks unless the user mentions them.
- SELF-CARE NUDGE: if the day is heavy (≥ 6h of deep_work) consider inserting one short "Recharge" break (kind="break", 10-15 min, type="routine") between deep blocks, with a reasoning like "Quick reset to keep your focus sharp."
- Summary: short, e.g. "5 tasks · 3 focus blocks · Done by 5pm".
- Subtext: one short sentence.${clarifiedHints}${patternHints}${behaviorHints}${overshootHints}${memoryHints}${learningHints}${emotionalHints}${calHints}`;

    const tools = [{
      type: "function",
      function: {
        name: "build_schedule",
        description: "Return a structured day schedule.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string" },
            subtext: { type: "string" },
            blocks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  start_time: { type: "string", description: "HH:MM 24h" },
                  duration_min: { type: "integer" },
                  title: { type: "string" },
                  type: { type: "string", enum: ["deep_work", "communication", "routine"] },
                  kind: { type: "string", enum: ["task", "break", "lunch"] },
                  block_type: { type: "string", enum: ["work", "rest", "personal"] },
                  reasoning: { type: "string" },
                  location: { type: "string" },
                },
                required: ["start_time", "duration_min", "title", "type", "kind"],
                additionalProperties: false,
              },
            },
          },
          required: ["summary", "subtext", "blocks"],
          additionalProperties: false,
        },
      },
    }];

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Name: ${name || "User"}\nRaw tasks:\n${raw_input}${emotionalContext ? `\nOptional context:\n${emotionalContext}` : ""}` },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "build_schedule" } },
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
    const withPartQualifier = (title: string, part: number) => {
      const clean = String(title || "").trim();
      if (!clean) return `Task (part ${part})`;
      if (/\(part\s+\d+\)$/i.test(clean)) return clean;
      return `${clean} (part ${part})`;
    };

    const splitLongTask = (b: any) => {
      const total = Number(b.duration_min) || 0;
      const pieces: any[] = [];
      let left = total;
      let cursor = b.start_time;
      let part = 1;
      while (left > 0) {
        const pieceMin = Math.max(20, Math.min(90, left));
        pieces.push({
          ...b,
          title: withPartQualifier(b.title, part),
          duration_min: pieceMin,
          start_time: cursor,
        });
        const [h, m] = String(cursor).split(":").map(Number);
        const next = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0) + pieceMin;
        cursor = `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
        left -= pieceMin;
        part += 1;
      }
      return pieces;
    };
    const inferBlockType = (b: any): "work" | "rest" | "personal" => {
      if (b?.block_type === "work" || b?.block_type === "rest" || b?.block_type === "personal") return b.block_type;
      if (b?.kind === "break" || b?.kind === "lunch") return "rest";
      const title = String(b?.title || "");
      if (/\b(grocery|groceries|shopping|errand|pickup|drop[\s-]?off|pharmacy|doctor|dentist|bank|post office|visit|appointment|kids?|school run|laundry)\b/i.test(title)) {
        return "personal";
      }
      return "work";
    };
    const normalizedBlocks = Array.isArray(args.blocks)
      ? args.blocks
        .flatMap((b: any) => (b?.kind === "task" && Number(b?.duration_min || 0) > 90 ? splitLongTask(b) : [b]))
        .map((b: any) => ({ ...b, block_type: inferBlockType(b) }))
      : [];
    const timeToMin = (hhmm: string) => {
      const [h, m] = String(hhmm || "").split(":").map(Number);
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    const minToTime = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.max(0, mins % 60)).padStart(2, "0")}`;
    const addBuffers = (blocks: any[]) => {
      const out: any[] = [];
      let inserted = 0;
      const buildBuffer = (atMin: number, minutes: number, idx: number) => ({
        start_time: minToTime(atMin),
        duration_min: minutes,
        title: idx % 2 === 0 ? "Buffer" : "Transition",
        type: "routine",
        kind: "break",
        block_type: "rest",
        reasoning: "Transition buffer to keep schedule realistic.",
      });
      for (let i = 0; i < blocks.length; i++) {
        const cur = blocks[i];
        const next = blocks[i + 1];
        out.push(cur);
        if (!next) continue;
        const curStart = timeToMin(cur.start_time);
        const nextStart = timeToMin(next.start_time);
        const curEnd = curStart + Number(cur.duration_min || 0);
        const gap = nextStart - curEnd;
        if (gap <= 0) continue;
        if (patternBufferEnabled) {
          const eligible = cur.kind === "task" && cur.block_type === "work" && cur.type === "deep_work";
          if (eligible && gap >= patternBufferMin) {
            out.push(buildBuffer(curEnd, patternBufferMin, inserted));
            inserted += 1;
          }
          continue;
        }
        if (defaultBufferEnabled) {
          // New-user fallback: after each contiguous 2h+ work sequence.
          let seqMin = 0;
          for (let j = i; j >= 0; j--) {
            const b = blocks[j];
            if (!(b?.kind === "task" && b?.block_type === "work")) break;
            seqMin += Number(b.duration_min || 0);
            const prev = blocks[j - 1];
            if (!prev || !(prev?.kind === "task" && prev?.block_type === "work")) break;
          }
          const seqEndsHere = !(next?.kind === "task" && next?.block_type === "work");
          if (seqEndsHere && seqMin >= 120 && gap >= defaultBufferMin) {
            out.push(buildBuffer(curEnd, defaultBufferMin, inserted));
            inserted += 1;
          }
        }
      }
      return { blocks: out, inserted };
    };
    const withBuffers = addBuffers(normalizedBlocks);
    const bufferNote = withBuffers.inserted > 0
      ? (patternBufferEnabled ? "Buffers added based on your patterns" : "Buffers added as default")
      : null;
    const chronicNote = (() => {
      if (!learningActive || !chronicTaskTitles.length) return null;
      const rawLower = String(raw_input || "").toLowerCase();
      const hit = chronicTaskTitles.find((t) => rawLower.includes(t.toLowerCase()));
      return hit ? "You've pushed this 3 times — want to break it into smaller steps?" : null;
    })();
    const learningNote = learningActive ? "Plan tuned to your patterns" : null;
    const finalSubtext = (() => {
      const base = String(args.subtext || "").trim();
      const notes = [base, bufferNote, learningNote, chronicNote].filter(Boolean) as string[];
      return notes.join(" ").trim();
    })();
    return new Response(
      JSON.stringify({ ...args, subtext: finalSubtext, blocks: withBuffers.blocks }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
