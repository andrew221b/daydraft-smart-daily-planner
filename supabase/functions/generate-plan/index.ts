import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { extractTaskTimeAnchors } from "../_shared/taskTimeAnchors.ts";
import { DAYDRAFT_PERSONA } from "../_shared/persona.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const FREE_PLAN_LIMIT = 5;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const {
      raw_input: rawInputValue,
      energy_preference,
      name,
      mode,
      start_time,
      clarified_tasks,
      planning_context,
      plan_date,
      now_iso,
      timezone,
      hours_already_committed,
      active_hours_start,
      active_hours_end,
      ai_tone,
      ai_tone_custom,
      ai_context_custom: aiContextFromBody,
      behavior_signals,
      ai_memory,
      ai_planning_rules,
    } = await req.json();
    let aiContextCustom: string = typeof aiContextFromBody === "string" ? aiContextFromBody : "";
    let raw_input = rawInputValue;
    const clarifiedList = Array.isArray(clarified_tasks) ? clarified_tasks : [];
    const reviewedTasksInSheet = clarifiedList.length > 0;
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
    // Only flag clearly broken fragments — short titles like "Gym" or "Email Sarah"
    // are valid; the old "< 4 words" rule blocked normal plans constantly.
    // Note: `wordCount < 1` (i.e. empty line) is the only word-count rule;
    // the previous `< 2` incorrectly flagged single-word titles like "gym"
    // even though the comment above explicitly allowed them.
    const isLikelyIncomplete = (line: string) => {
      if (wordCount(line) < 1) return true;
      if (endsWithDanglingWord(line)) return true;
      if (/[,:;/-]\s*$/.test(line)) return true;
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
    const incomplete = reviewedTasksInSheet
      ? []
      : taskLines
          .map((line) => ({
            line,
            incomplete: isLikelyIncomplete(line),
          }))
          .filter((x) => x.incomplete);
    if (incomplete.length) {
      const findings = incomplete.map(({ line }) => {
        const suggestion = autoCompleteTask(line);
        const reason = wordCount(line) < 2
          ? "too short"
          : endsWithDanglingWord(line)
            ? "ends with a dangling preposition/article"
            : "grammatically unfinished";
        return { line, reason, suggestion };
      });
        // Apply available auto-completions; leave unresolvable lines as-is.
      const rewrites = new Map(findings.map((f) => [f.line, f.suggestion || f.line]));
      const rewritten = taskLines.map((line) => rewrites.get(line) || line).join("\n");
      raw_input = rewritten;
    }

    const mergedClarified = clarifiedList.map((t: any) => ({ ...t }));
    const anchorSplitLines = splitTaskLines(raw_input);
    for (let i = 0; i < mergedClarified.length; i++) {
      const lineSource = anchorSplitLines[i] || String(mergedClarified[i]?.title || "");
      const anchors = extractTaskTimeAnchors(lineSource);
      if (!mergedClarified[i].fixed_time && anchors.fixedStart) mergedClarified[i].fixed_time = anchors.fixedStart;
      const note = anchors.deadlineNote?.trim();
      if (note) {
        mergedClarified[i].notes = mergedClarified[i].notes ? `${mergedClarified[i].notes}\n${note}` : note;
      }
    }
    const rawOnlyAnchorHints =
      mergedClarified.length === 0
        ? anchorSplitLines.map((ln) => {
          const a = extractTaskTimeAnchors(ln);
          if (!(a.fixedStart || a.deadlineNote)) return "";
          const parts: string[] = [];
          parts.push(`"${a.cleanedTitle || ln.trim()}"`);
          if (a.fixedStart) parts.push(`starts ${a.fixedStart}`);
          if (a.deadlineNote) parts.push(a.deadlineNote);
          return `- ${parts.join(" · ")}`;
        }).filter(Boolean).join("\n")
        : "";

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

    // Optional: pull user_patterns + calendar events if authenticated
    let pattern: any = null;
    let calendarEvents: any[] = [];
    let authedUserId: string | null = null;
    let authedSupabase: ReturnType<typeof createClient> | null = null;
    let tier: "free" | "trial" | "pro" = "free";
    let profilePlanningRules = "";
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
          const { data: profRow } = await supabase
            .from("profiles")
            .select("ai_planning_rules, ai_context_custom")
            .eq("id", u.user.id)
            .maybeSingle();
          if (profRow?.ai_planning_rules) profilePlanningRules = String(profRow.ai_planning_rules).trim();
          if (!aiContextCustom && profRow && typeof (profRow as { ai_context_custom?: string }).ai_context_custom === "string") {
            aiContextCustom = (profRow as { ai_context_custom: string }).ai_context_custom || "";
          }
          const { data: p } = await supabase.from("user_patterns").select("*").eq("user_id", u.user.id).maybeSingle();
          pattern = p;
          // Pro: pull today's calendar events if connected
          const { data: sub } = await supabase.from("subscriptions").select("status").eq("user_id", u.user.id).maybeSingle();
          const isPro = sub?.status === "active" || sub?.status === "trialing";
          tier = sub?.status === "active"
            ? "pro"
            : sub?.status === "trialing"
              ? "trial"
              : "free";
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

    const userPlanningRules = (
      typeof ai_planning_rules === "string" && ai_planning_rules.trim()
        ? ai_planning_rules.trim()
        : profilePlanningRules
    ).slice(0, 1200);

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
    const isReplan = mode === "replan";
    // Use user's configured active hours if set; otherwise no hard window.
    const activeStart = (typeof active_hours_start === "string" && /^\d{2}:\d{2}$/.test(active_hours_start))
      ? active_hours_start
      : "00:00";
    const activeEnd = (typeof active_hours_end === "string" && /^\d{2}:\d{2}$/.test(active_hours_end))
      ? active_hours_end
      : "23:59";
    // Hours available: for today = time remaining until midnight; for future = full active window.
    const hoursLeftToday = isPlanningToday
      ? Math.max(0, 23 - parseInt(nowHHMM.split(":")[0], 10) + (parseInt(nowHHMM.split(":")[1], 10) < 30 ? 0.5 : 0))
      : (() => {
        const [as_h, as_m] = activeStart.split(":").map(Number);
        const [ae_h, ae_m] = activeEnd.split(":").map(Number);
        return Math.max(1, (ae_h * 60 + ae_m - as_h * 60 - as_m) / 60);
      })();

    const overshootAvg = { work: 0, personal: 0, rest: 0 };
    const overshootByTaskType = { deep_work: 0, communication: 0, routine: 0 };
    let overshootSamples = 0;
    let learningActive = false;
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
        // Peak-window detection removed — scheduling is now context-driven
        // (clarification answers + user's written order take precedence).
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

    // Voice is now a single natural persona (see _shared/persona.ts) — no more
    // per-user tone profiles. summary/subtext just inherit that voice.
    // Hours already accounted for elsewhere on the same date (completed
    // blocks from earlier today, fixed calendar events, etc.). The AI must
    // subtract this from the available window so it never over-promises.
    const committed = Number(hours_already_committed) || 0;
    const trueHoursLeft = Math.max(0, hoursLeftToday - committed);
    const planningPrefsHints = userPlanningRules ? `

USER PLANNING PREFERENCES — follow wherever consistent with hard budget (${Math.round(trueHoursLeft * 60)}m), active hours (${activeStart}–${activeEnd}), calendar holds, and "no past slots" (${earliestStart} onward today):
${userPlanningRules}` : "";

    const rawParsedAnchorSection = rawOnlyAnchorHints ? `

AUTO-PARSED TIME CONSTRAINTS from raw_input (respect even without the clarify sheet):
${rawOnlyAnchorHints}
` : "";

    const clarifiedHints = mergedClarified.length ? `

USER-CLARIFIED TASKS (authoritative — DO NOT change titles, durations, fixed times, or notes; merge with parsed anchors below):
${mergedClarified.map((t: any, i: number) => {
  const fixed = t.fixed_time ? ` — FIXED at ${t.fixed_time} (must start exactly here)` : "";
  const prio = t.priority ? ` [${t.priority} priority]` : "";
  const n = t.notes ? ` — Note: ${String(t.notes).slice(0, 280)}` : "";
  return `${i + 1}. "${t.title}" — ${t.estimate_min}m${prio}${fixed}${n}`;
}).join("\n")}
${rawParsedAnchorSection}
Rules for clarified tasks:
- Use the EXACT title and duration_min the user provided (unless clarified explicitly asks AI to reshape).
- Schedule HIGH priority tasks in the peak window first.
- LOW priority tasks fill remaining time; drop them if the day overflows 8h.
- For FIXED times / parsed anchors / finish-by hints, obey them unless physically impossible vs ${earliestStart} or overlaps a calendar hold.` : rawParsedAnchorSection;


    const patternHints = pattern ? `
User patterns (use to compound intelligence):
- Deep work overrun: ${Number(pattern.deep_work_overrun_pct || 0).toFixed(0)}% (account for it; pad deep blocks if positive)
- Top abandoned types: ${JSON.stringify(pattern.abandoned_types || [])}
- Completion by hour: ${JSON.stringify(pattern.completion_by_hour || {})}` : "";
    const punct = behavior_signals?.closure_punctuality_7d;
    const skipM = behavior_signals?.skip_or_miss_rate_7d;
    const punctLine =
      typeof punct === "number" && Number.isFinite(punct)
        ? `\n- Task closures on/before planned window end (7d): ${(punct * 100).toFixed(0)}% of completed tasks`
        : "";
    const skipLine =
      typeof skipM === "number" && Number.isFinite(skipM)
        ? `\n- Skip/miss rate on tasks (7d): ${(skipM * 100).toFixed(0)}%`
        : "";
    const behaviorHints = behavior_signals ? `
Recent behavior signals:
- Completion rate (14d): ${Number(behavior_signals.completion_rate_14d || 0).toFixed(2)}
- Average completed task duration (14d): ${Math.round(Number(behavior_signals.avg_completed_task_min_14d || 0))}m
- Tracking coverage (7d): ${Number(behavior_signals.tracking_coverage_7d || 0).toFixed(2)}${punctLine}${skipLine}
Use this to keep plans realistic: if completion rate < 0.65, trim low-priority volume by default; if avg completed task duration is short, prefer smaller blocks.
If skip/miss rate is high (>0.25), suggest fewer parallel commitments and smaller first wins; mention gently without shaming.
If closure punctuality is high (>0.75), acknowledge they usually wrap on time — keep plans ambitious but humane; if low (<0.45), add lighter buffers and fewer back-to-back deep blocks.` : "";
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
    // learningHints removed — chronic/peak signals now surfaced through
    // overshootHints + patternHints; the new prompt is context-driven.
    const emotionalContext = typeof planning_context === "string" ? planning_context.trim() : "";
    // Detect whether planning_context contains structured clarification answers
    // (added by the client as "User Clarifications:\n- Q: ...\n  A: ...").
    // If so, treat them as HARD scheduling constraints, not optional hints.
    const isClarificationAnswers = emotionalContext.startsWith("User Clarifications:");
    const emotionalHints = emotionalContext ? (isClarificationAnswers ? `

USER SCHEDULING CONSTRAINTS (collected from a pre-planning questionnaire — treat each answer as a HARD rule that overrides defaults):
${emotionalContext
  .replace("User Clarifications:\n", "")
  .replace(/- Q: /g, "Constraint: ")
  .replace(/\n  A: /g, " → ")}
Rules:
- If the answer mentions "morning" for any task type → schedule ALL tasks of that type before 12:00.
- If the answer mentions "afternoon" → schedule them 12:00–17:00.
- If the answer mentions "evening" → schedule them after 17:00.
- If the answer mentions a hard deadline → treat the referenced task as FIXED with preparation before it.
- If the answer says "hardest first" → place the highest-effort deep_work task first in the schedule.
- If the answer says "easiest first" → place the lowest-effort task first.
- Do NOT let the peak-window heuristic override these explicit user preferences.` : `

Optional context (emotional / deadline signal):
- ${emotionalContext}
How to use it:
- Let this influence ordering and framing of the day.
- If there is a clear deadline/call time, schedule preparation before it and lighter work after.
- If there is dread/friction around a task, consider placing it earlier and mention a supportive framing in reasoning/subtext.`) : "";

    const calHints = calendarEvents.length ? `
FIXED calendar events you must schedule around (do not move, do not duplicate; emit them as kind="task" with type="communication" and a reasoning that mentions "from your calendar"):
${calendarEvents.map((e: any) => `- ${e.start_time} (${e.duration_min}m) ${e.title}`).join("\n")}` : "";

    const personalContextHints = aiContextCustom && aiContextCustom.trim()
      ? `\nPersonal context about this user (treat as authoritative background, never repeat verbatim):\n- ${aiContextCustom.trim().slice(0, 500)}`
      : "";

    const system = `${DAYDRAFT_PERSONA}

YOUR JOB: turn the user's task list into a realistic schedule for their day. Build a plan they can actually finish — not an idealized one that sets them up to feel behind.

WHEN (hard constraints — no exceptions):
- Current local time: ${nowHHMM} (${timezone || "UTC"}).
- Planning date: ${plan_date || todayLocal}${isPlanningToday ? " (TODAY)" : " (future date)"}.
- Available window: ${earliestStart} → ${activeEnd}${activeEnd !== "23:59" ? " (user's preferred hours — respect unless a task explicitly requires another time)" : ""}.${isReplan ? "\n- MID-DAY RE-PLAN: schedule only what's left, starting from now." : ""}
- Realistic time to plan into: ~${trueHoursLeft.toFixed(1)}h (after ${committed.toFixed(1)}h already committed).
- HARD BUDGET: total task duration MUST NOT exceed ${Math.round(trueHoursLeft * 60)} minutes. If tasks overflow, drop lowest-priority ones and start subtext with "⚠️ Heads up: dropped '[task]' — only ${trueHoursLeft.toFixed(1)}h left."

WHAT ORDER (follow exactly, highest priority first):
1. EXPLICIT TIMES — any task with "at 3pm / 15:00 / в 14:30 / к 9 утра" is FIXED. Never shift it. Schedule everything else around it.
2. USER CLARIFICATION ANSWERS — if the user answered questions before planning, those answers are HARD scheduling rules (see section below if present).
3. SEQUENCING CUES — "after / потом / then / once I finish / по возвращении" → that task comes AFTER; "before / перед / до / by" → BEFORE. Honor these even if it conflicts with what seems "optimal".
4. PART-OF-DAY HINTS — "утром / morning / вечером / evening / first thing / tonight" → schedule in that window.
5. USER'S WRITTEN ORDER — treat the list roughly as the user's intended day order. Only re-order to honor rules 1–4 above or to fit a clearly mentioned meal/break.

IMPLICIT COMMON SENSE (apply automatically without asking):
- Physical activity away from home (gym, pool, run outside, store, pharmacy, appointment) → add a travel block before AND after (15–30 min each depending on context). Title it "Travel to [place]" / "Return from [place]", kind="break", block_type="rest".
- Important meeting, call, or presentation → add 10–15 min "Prep for [meeting]" block just before it.
- Two locations in different parts of the city back-to-back → add a 20–30 min travel buffer between them.
- Task clearly implying cooking or food prep → budget realistic time (dinner ≠ 10 min).
- If user mentions they're tired, low energy, sick, or it's late → prefer shorter blocks, lighter tasks first, don't pack the day.

TASK RULES:
- One task in = one block out (unless >90 min forces a split into parts).
- Splits: keep base title, add "(part 1)", "(part 2)". Never use "Work session 1" style.
- NEVER invent tasks not in the input. NEVER merge two tasks into one.
- Titles: reuse the user's exact wording. Only fix capitalization/punctuation.
- FORBIDDEN: "Deep focus session", "Focus block", "Work session", "Task block" — generic labels are banned.
- Classify type: deep_work (focused solo work), communication (calls/meetings/messages), or routine (errands, admin, chores).
- block_type: "rest" for breaks/travel/transitions, "personal" for errands/family/appointments, "work" for everything else.
- If location mentioned in raw text, extract a short location string.
- For EVERY block include one-sentence reasoning explaining the placement.
- Parallel tasks: only when user clearly implies doing two things simultaneously (e.g. "walking + call") → overlap_ok=true, same parallel_group_id, same start_time.
- Splits for long tasks: ONLY when duration clearly exceeds 90 min. Don't split medium tasks to fill time.

BREAKS & MEALS:
- Insert a 10–15 min break after 2+ hours of continuous focused work — only if time allows.
- Suggest a meal break (lunch ~60 min, or dinner if evening plan) ONLY if it falls naturally in the window and user hasn't mentioned eating.
- Light day (≤60 min total tasks, ≥4h remaining): schedule what's given, start subtext with "✨ Light day — " + one warm suggestion.

GIBBERISH GUARD: if input is completely unintelligible (random keys, "test", no real intent) → return ONE 15-min task: title "Clarify today's goals", type="routine", kind="task", reasoning "Couldn't parse the input.", summary "Awaiting clear tasks", subtext "Try writing out your actual goals."

OUTPUT FORMAT:
- Summary: short, e.g. "4 tasks · done by 6pm".
- Subtext: one short sentence.${planningPrefsHints}${clarifiedHints}${patternHints}${behaviorHints}${overshootHints}${memoryHints}${emotionalHints}${calHints}${personalContextHints}`;

    const schema = {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        subtext: { type: "STRING" },
        blocks: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              start_time: { type: "STRING", description: "HH:MM 24h" },
              duration_min: { type: "INTEGER" },
              title: { type: "STRING" },
              type: { type: "STRING", enum: ["deep_work", "communication", "routine"] },
              kind: { type: "STRING", enum: ["task", "break", "lunch"] },
              block_type: { type: "STRING", enum: ["work", "rest", "personal"] },
              reasoning: { type: "STRING" },
              location: { type: "STRING" },
              parallel_with_index: { type: "INTEGER", description: "Zero-based index of another block this one happens IN PARALLEL with (overlapping times intended to be done together). Omit if not parallel." },
              overlap_ok: { type: "BOOLEAN", description: "True only for intentional concurrent background tasks paired with anchored work." },
              parallel_group_id: { type: "STRING", description: "Shared id for concurrently overlapping companions." },
            },
            required: ["start_time", "duration_min", "title", "type", "kind"],
          },
        },
      },
      required: ["summary", "subtext", "blocks"],
    };

    // Model fallback chain: pro for quality, flash as a faster fallback when
    // pro is rate-limited or overloaded.
    const MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.0-flash"];
    const isTransient = (s: number) => s === 500 || s === 502 || s === 503 || s === 504;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const planSystem = system;
    const planUser = `Name: ${name || "User"}\nRaw tasks:\n${raw_input}${emotionalContext ? `\nOptional context:\n${emotionalContext}` : ""}`;

    let resp: Response | null = null;
    let lastStatus = 0;
    let lastBody = "";

    // Each upstream call is bounded by its own timeout, and the whole chain by
    // an overall budget kept well under the client's request timeout. Without
    // this a slow / overloaded model (esp. gemini-2.5-pro) could hang until the
    // CLIENT aborted — which it mis-reports as "couldn't reach the AI". Now we
    // always fall back to a faster model and, worst case, return a structured
    // error the client can show verbatim.
    const DEADLINE = Date.now() + 48_000;
    const PER_ATTEMPT_MS = 20_000;

    const callModel = async (model: string, budgetMs: number): Promise<Response> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), Math.max(3_000, budgetMs));
      try {
        return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: planSystem }] },
            contents: [{ role: "user", parts: [{ text: planUser }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: schema,
              thinkingConfig: { thinkingBudget: 6144 },
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
        const remaining = DEADLINE - Date.now();
        if (remaining < 4_000) break outer; // out of budget — return structured error below
        let r: Response;
        try {
          r = await callModel(model, Math.min(PER_ATTEMPT_MS, remaining - 1_000));
        } catch (err) {
          // Our timeout (abort) or a transient network blip to Gemini — don't
          // retry the same (slow) model, jump straight to the faster fallback.
          lastStatus = 504;
          console.error("[generate-plan] upstream timeout/abort", { model, attempt, err: String(err) });
          break;
        }
        if (r.ok) { resp = r; break outer; }
        lastStatus = r.status;
        try { lastBody = (await r.text()).slice(0, 1024); } catch { lastBody = ""; }
        console.error("[generate-plan] upstream error", { model, attempt, status: r.status, body: lastBody });
        if (r.status === 429 || (r.status >= 400 && r.status < 500)) break; // try next model
        if (isTransient(r.status) && attempt === 0) { await sleep(300 + Math.floor(Math.random() * 200)); continue; }
        break;
      }
    }

    if (!resp) {
      // NOTE: returned as HTTP 200 with an `error` field. supabase-js surfaces
      // a non-2xx as an opaque "Edge Function returned a non-2xx status code"
      // (body unreadable by our client), which would swallow these friendly
      // messages. 200 + { error } lets the client show them verbatim.
      const msg =
        lastStatus === 429 ? "Too many requests — give it a moment and try again." :
        (lastStatus === 401 || lastStatus === 403) ? "AI is misconfigured on the server." :
        (lastStatus === 400 && /safety|blocked|harm/i.test(lastBody)) ? "Your tasks hit a safety filter — try rephrasing." :
        "AI is having a moment — please try again.";
      return new Response(JSON.stringify({ error: msg }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await resp.json();
    const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOut) throw new Error("No content returned");
    const args = JSON.parse(textOut);
    const withPartQualifier = (title: string, part: number) => {
      const clean = String(title || "").trim();
      if (!clean) return `Task (part ${part})`;
      if (/\(part\s+\d+\)$/i.test(clean)) return clean;
      return `${clean} (part ${part})`;
    };

    const splitLongTask = (b: any) => {
      const total = Number(b.duration_min) || 0;
      if (total <= 0) return [b];
      // Split into the fewest 90-min-max pieces, evenly, so the TOTAL duration is
      // preserved exactly. The old greedy "take 90, floor the rest to 20" inflated
      // short remainders (e.g. 100m → 90+20 = 110m, 95m → 90+20 = 115m), which
      // silently pushed every later task forward. Even split keeps pieces in a
      // tidy 45–90 min band and never adds phantom minutes.
      const n = Math.max(1, Math.ceil(total / 90));
      const base = Math.floor(total / n);
      let remainder = total - base * n; // spread 1 extra min across the first `remainder` pieces
      const pieces: any[] = [];
      let cursor = b.start_time;
      for (let part = 1; part <= n; part++) {
        const pieceMin = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        pieces.push({
          ...b,
          title: withPartQualifier(b.title, part),
          duration_min: pieceMin,
          start_time: cursor,
        });
        const [h, m] = String(cursor).split(":").map(Number);
        const next = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0) + pieceMin;
        cursor = `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
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
    const timeToMin = (hhmm: string) => {
      const [h, m] = String(hhmm || "").split(":").map(Number);
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    const normalizePlannerTitleKey = (t: string) =>
      String(t || "").replace(/\s*\(part\s+\d+\)$/i, "").trim().toLowerCase();
    let normalizedBlocks = Array.isArray(args.blocks)
      ? args.blocks
        .flatMap((b: any) => (b?.kind === "task" && Number(b?.duration_min || 0) > 90 ? splitLongTask(b) : [b]))
        .map((b: any) => ({
          ...b,
          block_type: inferBlockType(b),
          overlap_ok: Boolean(b?.overlap_ok),
          parallel_group_id:
            typeof b?.parallel_group_id === "string" && b.parallel_group_id.trim().length
              ? String(b.parallel_group_id).trim().slice(0, 120)
              : null,
        }))
      : [];
    const anchorMap = new Map<string, string>();
    for (const t of mergedClarified) {
      const ft = typeof t.fixed_time === "string" ? t.fixed_time.trim() : "";
      if (/^\d{2}:\d{2}$/.test(ft)) anchorMap.set(normalizePlannerTitleKey(String(t.title || "")), ft);
    }
    normalizedBlocks = normalizedBlocks.map((b: any) => {
      if (b.kind !== "task" || !anchorMap.size) return b;
      const key = normalizePlannerTitleKey(String(b.title || ""));
      if (!anchorMap.has(key)) return b;
      return { ...b, start_time: anchorMap.get(key) };
    });
    normalizedBlocks = [...normalizedBlocks].sort((a: any, b: any) => timeToMin(a.start_time) - timeToMin(b.start_time));
    const minToTime = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.max(0, mins % 60)).padStart(2, "0")}`;
    normalizedBlocks = normalizedBlocks.map((b: any) => ({
      ...b,
      slot_end_time: minToTime(timeToMin(b.start_time) + Number(b.duration_min || 0)),
    }));
    const addBuffers = (blocks: any[]) => {
      const out: any[] = [];
      let inserted = 0;
      const buildBuffer = (atMin: number, minutes: number, idx: number) => ({
        start_time: minToTime(atMin),
        duration_min: minutes,
        slot_end_time: minToTime(atMin + minutes),
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
    // 200 + { error } so the client can read and show the message (see note above).
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Something went wrong generating your plan." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
