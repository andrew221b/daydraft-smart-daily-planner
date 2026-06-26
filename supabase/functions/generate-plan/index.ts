import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { extractTaskTimeAnchors } from "../_shared/taskTimeAnchors.ts";
import { DAYDRAFT_PERSONA } from "../_shared/persona.ts";
import { ACTIVITY_DURATIONS } from "../_shared/activityDurations.ts";
import { callGeminiWithRetry } from "../_shared/geminiRetry.ts";
import { resolveLocalDuration } from "../_shared/durationLookup.ts";

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
      personalization,
    } = await req.json();
    // Behavioural-learning opt-out (Settings → Personalization). When false we
    // ignore every LEARNED signal for this user — server-computed plan-vs-actual
    // overshoot + chronic procrastination, plus any pattern / behavior / memory
    // hints — and plan purely from the typed tasks + explicit settings. The
    // user's own "About you" context still applies (they wrote it on purpose).
    const personalizationEnabled = personalization !== false;
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

    // Resolve durations locally (real-world dataset) before ever asking Gemini to guess.
    // Only fills in tasks left blank; never overrides a given estimate. Kept for when
    // clarified_tasks is populated (no current client sends it, but it's a free win if one does).
    let localResolvedCount = 0;
    for (const t of mergedClarified) {
      if (t.estimate_min != null) continue;
      const local = resolveLocalDuration(String(t?.title || ""));
      if (local) {
        t.estimate_min = local.min;
        t._localMatch = true;
        localResolvedCount++;
      }
    }

    // The actual live path: every client sends plain `raw_input` text lines, not
    // `clarified_tasks`. Resolve durations locally per line and inject the same
    // `[Xmin]` annotation the client already uses for explicit durations — the
    // prompt already treats that as authoritative (see "[Xmin]" rules below), so
    // a locally-resolved task needs no new prompt instructions to be respected.
    // Skip lines that already carry an explicit duration; never override those.
    const explicitDurationRe = /[(\[]\s*\d+(?:\.\d+)?\s*(?:min|m)\.?\s*[)\]]/i;
    raw_input = splitTaskLines(raw_input)
      .map((line) => {
        if (explicitDurationRe.test(line)) return line;
        const { cleanedTitle } = extractTaskTimeAnchors(line);
        const local = resolveLocalDuration(cleanedTitle || line);
        if (!local) return line;
        localResolvedCount++;
        return `${line} [${local.min}min]`;
      })
      .join("\n");

    if (localResolvedCount > 0) {
      console.log(`[generate-plan] resolved ${localResolvedCount} task duration(s) locally (no AI guess needed)`);
    }

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
          tier = (sub?.status === "active")
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
    let personalDurationsHints = "";
    if (personalizationEnabled && authedSupabase && authedUserId) {
      try {
        // Lookback window is 30 days (matches update-user-patterns' own convention),
        // but the "is this user established enough to trust learned signals" bar
        // stays at 14 ACTIVE days. Deliberately NOT a 14-day window: a 14-day
        // window made activeDays.size >= 14 mean "active literally every single
        // day for two straight weeks" (one skipped day permanently reset it) —
        // 14-of-30 keeps the same ~2-week bar while tolerating normal gaps
        // (weekends, a sick day, a slow week).
        const lookbackStart = new Date(nowDate);
        lookbackStart.setDate(lookbackStart.getDate() - 29);
        const { data: histBlocks } = await authedSupabase
          .from("blocks")
          .select("id,title,estimated_minutes,actual_minutes,block_type,kind,type,completed,created_at")
          .eq("user_id", authedUserId)
          .gte("created_at", lookbackStart.toISOString())
        const { data: histEntries } = await authedSupabase
          .from("time_entries")
          .select("started_at,ended_at,block_id")
          .eq("user_id", authedUserId)
          .gte("started_at", lookbackStart.toISOString())
          .not("block_id", "is", null)
          .not("ended_at", "is", null);
        const { data: histPlans } = await authedSupabase
          .from("plans")
          .select("date")
          .eq("user_id", authedUserId)
          .gte("date", lookbackStart.toISOString().slice(0, 10));
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

        // Personal duration calibration — the single most accurate signal for
        // THIS user: their OWN tracked task times (actual_minutes is only ever
        // set from real tracking, never invented). Group by title, take the
        // median (robust to a stray left-running timer) + sample count, and
        // feed it so the planner PREFERS it over the population/profession ref.
        // Mirrors parse-tasks; fetched broader than the 14d overshoot window.
        const { data: durBlocks } = await authedSupabase
          .from("blocks")
          .select("title, actual_minutes")
          .eq("user_id", authedUserId)
          .not("actual_minutes", "is", null)
          .order("created_at", { ascending: false })
          .limit(400);
        if (Array.isArray(durBlocks) && durBlocks.length) {
          const groups = new Map<string, { label: string; vals: number[] }>();
          for (const b of durBlocks as any[]) {
            const title = String(b?.title || "").trim();
            const mins = Number(b?.actual_minutes || 0);
            if (!title || !(mins > 0)) continue;
            const key = title.toLowerCase().replace(/\s+/g, " ");
            const g = groups.get(key) || { label: title, vals: [] };
            g.vals.push(mins);
            groups.set(key, g);
          }
          const med = (a: number[]): number => {
            const s = [...a].sort((x, y) => x - y);
            const mid = Math.floor(s.length / 2);
            return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
          };
          const rows = [...groups.values()]
            .sort((a, b) => b.vals.length - a.vals.length)
            .slice(0, 20)
            .map((g) => `- "${g.label}" → ~${med(g.vals)}m${g.vals.length > 1 ? ` (their avg across ${g.vals.length})` : ""}`);
          if (rows.length) {
            personalDurationsHints = `\n\nYOUR OWN MEASURED DURATIONS (this user's REAL tracked time on past tasks — the single most accurate signal for THIS person). When a task matches one of these (even with different wording or in another language), PREFER the user's own time here over the ACTIVITY DURATION REFERENCE and over any [Xmin] estimate in the task list. More samples = more reliable:\n${rows.join("\n")}`;
          }
        }
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
  const dur = typeof t.estimate_min === "number" ? `${t.estimate_min}m` : "duration unknown — estimate from reference data below";
  return `${i + 1}. "${t.title}" — ${dur}${prio}${fixed}${n}`;
}).join("\n")}
${rawParsedAnchorSection}
Rules for clarified tasks:
- Use the EXACT title and duration_min the user provided (unless clarified explicitly asks AI to reshape).
- Schedule HIGH priority tasks in the peak window first.
- LOW priority tasks fill remaining time; drop them if the day overflows 8h.
- For FIXED times / parsed anchors / finish-by hints, obey them unless physically impossible vs ${earliestStart} or overlaps a calendar hold.` : rawParsedAnchorSection;


    const patternHints = (personalizationEnabled && pattern) ? `
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
    const behaviorHints = (personalizationEnabled && behavior_signals) ? `
Recent behavior signals:
- Completion rate (14d): ${Number(behavior_signals.completion_rate_14d || 0).toFixed(2)}
- Average completed task duration (14d): ${Math.round(Number(behavior_signals.avg_completed_task_min_14d || 0))}m
- Tracking coverage (7d): ${Number(behavior_signals.tracking_coverage_7d || 0).toFixed(2)}${punctLine}${skipLine}
Use this to keep plans realistic: if completion rate < 0.65, trim low-priority volume by default; if avg completed task duration is short, prefer smaller blocks.
If skip/miss rate is high (>0.25), suggest fewer parallel commitments and smaller first wins; mention gently without shaming.
If closure punctuality is high (>0.75), acknowledge they usually wrap on time — keep plans ambitious but humane; if low (<0.45), add lighter buffers and fewer back-to-back deep blocks.` : "";
    const overshootHints = personalizationEnabled ? `
14-day plan vs actual history:
- Samples: ${overshootSamples}
- Avg overshoot work: ${(overshootAvg.work * 100).toFixed(0)}%
- Avg overshoot personal: ${(overshootAvg.personal * 100).toFixed(0)}%
- Avg overshoot rest: ${(overshootAvg.rest * 100).toFixed(0)}%
Buffer policy:
- Pattern-based buffers active: ${patternBufferEnabled ? "yes" : "no"}${patternBufferEnabled ? ` (${patternBufferMin}m after deep-work blocks)` : ""}
- New-user default buffers active: ${defaultBufferEnabled ? "yes" : "no"}${defaultBufferEnabled ? ` (${defaultBufferMin}m after each 2h+ work sequence)` : ""}` : "";
    const memoryHints = (personalizationEnabled && ai_memory) ? `
AI weekly memory:
- Best focus hours: ${String(ai_memory.best_focus_hours || "unknown")}
- Realistic block length: ${Math.round(Number(ai_memory.realistic_block_min || 45))}m
- Common slip pattern: ${String(ai_memory.common_slip || "none")}
- Recommendation: ${String(ai_memory.recommendation || "keep plans realistic")}
Use these as defaults unless they conflict with fixed commitments.` : "";
    // Proactive nudge — revives the (previously computed-but-unused) chronic
    // procrastination signal: tasks planned 3+ times and never finished. When
    // one shows up today, lower its activation energy with a tiny first step
    // instead of letting it get dodged a fourth time. This operationalises the
    // persona's self-efficacy principle ("make the next step small and winnable").
    const chronicHints = chronicTaskTitles.length ? `

PROACTIVE NUDGE — these tasks were planned 3+ times and never finished: ${JSON.stringify(chronicTaskTitles)}.
If any appears in today's input, lower its activation energy: schedule it EARLY and shrink that one block to a tiny 10–15 min FIRST STEP (keep the user's title on ONE line, no line break; you may append a single space then "— just the first step" on that same line). Put the smallest possible start on the calendar so momentum can take over. Carry the gentle intent in that block's reasoning — never shame, never say "you keep skipping this".` : "";
    const emotionalContext = typeof planning_context === "string" ? planning_context.trim() : "";
    // Detect whether planning_context contains structured clarification answers
    // (added by the client as "User Clarifications:\n- Q: ...\n  A: ...").
    // If so, treat them as HARD scheduling constraints, not optional hints.
    const isClarificationAnswers = emotionalContext.startsWith("User Clarifications:");
    const emotionalHints = emotionalContext ? (isClarificationAnswers ? `

USER SCHEDULING CONSTRAINTS (the user just answered these about their OWN day — each answer is their correction and OVERRIDES everything else: your estimates, the bracketed [Xmin] durations in the list, the written order, and every default heuristic. This is the single most trustworthy signal you have. Apply each answer to the SPECIFIC task it names):
${emotionalContext
  .replace("User Clarifications:\n", "")
  .replace(/- Q: /g, "Constraint: ")
  .replace(/\n  A: /g, " → ")}
Rules:
- DURATION AND TIME answers are ABSOLUTE. If the user answered with a specific duration (e.g. "2 hours") or time (e.g. "14:30"), you MUST use EXACTLY that \`duration_min\` and \`start_time\` for the block. NEVER ignore their explicit answer.
- DURATION answers win absolutely: if an answer gives a length ("2.5 hours", "два часа", "90 min", "an hour and a half"), set that task's duration to EXACTLY that and IGNORE any [Xmin] estimate in the list for it. A "2.5 hours" answer for a movie means a 150-minute block, not 53.
- EXCEPTION — TRAVEL TIME is not duration: an answer tagged "[TRAVEL TIME — ONE-WAY...]" names the task only to identify its location, NOT to set its duration. NEVER write that number into the named task's own duration_min. Instead use it for that task's "Travel to [place]" and "Return from [place]" blocks (see TRAVEL — ROUND TRIP rule) — same number, both directions.
- TIME-OF-DAY answers win, in ANY language — map the MEANING, not the literal word: morning / утром → before 12:00; midday / noon / "середина дня" / "в обед" → 12:00–14:00; afternoon / днём / "после обеда" → STRICTLY after 13:00 (NEVER in the morning); evening / вечером / tonight / "после работы" → after 17:00 (or after the day's work and calls end). If a task says "after lunch" or "после обеда", YOU MUST schedule a Lunch break first if one isn't scheduled, and place the task AFTER it. A "midday" or "после обеда" answer must NOT land at 10:00 AM.
- A deadline answer → that task is FIXED, with preparation before it.
- "Hardest first" → highest-effort deep_work first; "easiest first" → lowest-effort first.
- These answers OUTRANK the peak-window heuristic and the user's written order. If a placement would contradict an answer, the answer wins. Never silently drop one.` : `

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

IMPLICIT COMMON SENSE (apply automatically without asking — this is where you act less like a parser and more like someone who actually understands a day):
- BE A REAL PREDICTOR, NOT A PACKER. Spread tasks out organically. Do not just cram all tasks back-to-back starting at 9 AM without breaks. If shifting a task by 15-30 minutes creates a more realistic flow, do it.
- MANDATORY LUNCH: If the plan spans past 13:00 and no lunch/meal block exists, YOU MUST insert a 45-60m "Lunch" block (kind="lunch", block_type="rest") between 12:00 and 14:00. No exceptions — real humans eat.
- LEISURE vs WORK is the big one. Entertainment and downtime (a movie / film, a show, a game, hanging out, relaxing, a hobby) on a day that ALSO has work, calls, or errands belongs in FREE time — normally the evening — and NEVER before the day's work and fixed commitments. Productive daytime goes to work and calls; rest wraps around them. A 2.5-hour movie does not go at 11:00 before a workday; it goes after the work is done.
- REALISTIC DURATIONS: estimate task lengths when the user doesn't specify a duration. Order of preference: (1) if a "YOUR OWN MEASURED DURATIONS" section is present and the task matches a row, use THAT — it's this user's real measured time and beats every average; (2) otherwise use the ACTIVITY DURATION REFERENCE table below, anchoring each task to the closest matching row. If the user's context indicates a profession listed in the reference, PREFER that profession's per-task durations (a developer's "review" ≈ 45m, a lawyer's ≈ 120m). For example, "gym" = 60 min + travel, "cook dinner" = 60-90 min, "watch a movie" = 120-150 min. NEVER assign a 15-min block to something that takes an hour in real life.
- Match energy to the clock: deep focus in the productive peak, light/admin in the dips, leisure once the work is behind them.
- TRAVEL — ROUND TRIP: Any task that involves leaving home (gym, store, pharmacy, doctor, school, office, meeting, appointment) MUST get TWO travel blocks — NEVER just one, and NEVER folded into the activity's own duration or left as a silent unlabeled gap:
  1. "Travel to [place]" BEFORE the activity (kind="break", block_type="rest", 15-25 min default)
  2. "Return from [place]" AFTER the activity (kind="break", block_type="rest", 15-25 min default)
  Write "Travel to"/"Return from" and "[place]" in the SAME language as the user's own input for that task — never mix languages within one title.
  If the user mentioned a travel time (clarification answer or in the text), it is ONE-WAY — use that SAME number for BOTH blocks, not just the outbound one. That number is travel time only; it is NEVER the activity's own duration_min. Before finishing, check every out-of-home task has both legs — a "Travel to" with no matching "Return from" is an incomplete plan. If two consecutive out-of-home tasks are at the SAME location, skip the return+departure pair and add a single transition. The activity duration does NOT include travel — it's separate, explicitly titled blocks so the user can see exactly where the time went.
- ROUTINES & PREP (THE "NOSTRADAMUS" RULE) — AT-HOME tasks only: When scheduling tasks that require setup, prep, or cleanup WITHOUT leaving the house (cooking, morning start, packing, cleaning), use the ROUTINES & PREP durations from the reference table. Do NOT create explicitly named blocks for these. Instead, either expand the task's duration to absorb it, or leave a natural, empty gap (15-30m) before/after the task so the user has realistic time to transition. This rule does NOT apply to anything that leaves the house — those are owned entirely by the TRAVEL — ROUND TRIP rule above (explicit, titled travel blocks, never absorbed into duration and never a silent gap). Act like you truly know how human days work.
- Important meeting, call, or presentation → add 10–15 min "Prep for [meeting]" block just before it.
- Two locations in different parts of the city back-to-back → add a 20–30 min travel buffer between them (kind="break", block_type="rest", titled "Travel to [next place]" — same language-matching rule as above).
- Task clearly implying cooking or food prep → budget realistic time (dinner ≠ 10 min, use the reference table).
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
- For EVERY block include one-sentence reasoning explaining the placement. When the personalization sections below (user patterns / recent behavior signals / 14-day history / AI weekly memory) are present and actually relevant to THIS block, prefer reasoning that names the specific signal (e.g. "Placed early — you usually stall on this one" or "Kept short, matching your real average for this task") over a generic restatement of the time of day. If none of those sections are present for this user, give straightforward placement reasoning — never invent a pattern that wasn't given to you.
- Splits for long tasks: ONLY when duration clearly exceeds 90 min. Don't split medium tasks to fill time.

BREAKS & MEALS:
- Insert a 10–15 min break after 2+ hours of continuous focused work — only if time allows.
- Suggest a meal break (lunch ~60 min, or dinner if evening plan) ONLY if it falls naturally in the window and user hasn't mentioned eating.
- Light day (≤60 min total tasks, ≥4h remaining): schedule what's given, start subtext with "✨ Light day — " + one warm suggestion.

GIBBERISH GUARD: if input is completely unintelligible (random keys, "test", no real intent) → return ONE 15-min task: title "Clarify today's goals", type="routine", kind="task", reasoning "Couldn't parse the input.", summary "Awaiting clear tasks", subtext "Try writing out your actual goals."

OUTPUT FORMAT:
- Summary: short, e.g. "4 tasks · done by 6pm".
- Subtext: one short sentence.

${ACTIVITY_DURATIONS}${personalDurationsHints}${planningPrefsHints}${clarifiedHints}${patternHints}${behaviorHints}${overshootHints}${memoryHints}${emotionalHints}${calHints}${personalContextHints}${chronicHints}`;

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
            },
            required: ["start_time", "duration_min", "title", "type", "kind"],
          },
        },
      },
      required: ["summary", "subtext", "blocks"],
    };

    const planSystem = system;
    const planUser = `Name: ${name || "User"}\nRaw tasks:\n${raw_input}${emotionalContext ? `\nOptional context:\n${emotionalContext}` : ""}`;

    // Adaptive "thinking" budget. Gemini 2.5 thinking tokens add real latency,
    // and a short to-do list barely needs them. Reserve the deep budget for
    // genuinely complex days (a calendar to schedule around, a mid-day re-plan,
    // many tasks, or custom planning rules); simple lists get a small budget and
    // come back noticeably faster.
    const taskLineCount = String(raw_input || "").split(/\n+/).filter((l) => l.trim()).length;
    const planComplexity =
      (calendarEvents.length > 0 ? 2 : 0) +
      (isReplan ? 1 : 0) +
      // Clarification answers mean the user is correcting the plan — give the
      // model real room to reason so it actually honours every answer and the
      // leisure-vs-work ordering, instead of reverting to a flat heuristic.
      (mergedClarified.length > 0 ? 2 : 0) +
      (emotionalContext && isClarificationAnswers ? 2 : 0) +
      (userPlanningRules ? 1 : 0) +
      (taskLineCount > 6 ? 2 : taskLineCount > 3 ? 1 : 0);
    const thinkingBudget = planComplexity >= 4 ? 4096 : planComplexity >= 2 ? 2048 : 1024;

    // Each upstream call is bounded by its own timeout, and the whole chain by
    // an overall budget kept well under the client's request timeout. Without
    // this a slow / overloaded model (esp. gemini-2.5-pro) could hang until the
    // CLIENT aborted — which it mis-reports as "couldn't reach the AI". Now we
    // always fall back to a faster model and, worst case, return a structured
    // error the client can show verbatim.
    const DEADLINE = Date.now() + 55_000;
    const PER_ATTEMPT_MS = 45_000;

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
              thinkingConfig: { thinkingBudget },
            },
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
    };

    // Shared model-chain + transient-retry (incl 404/429), bounded by DEADLINE.
    // Each attempt is capped at PER_ATTEMPT_MS or the remaining budget, whichever
    // is smaller. See _shared/geminiRetry.ts.
    const { response: resp, lastStatus, lastBody } = await callGeminiWithRetry(
      (model, budgetMs) => callModel(model, Math.min(PER_ATTEMPT_MS, budgetMs)),
      {
        deadlineMs: DEADLINE,
        onError: ({ model, attempt, status, body }) =>
          console.error("[generate-plan] upstream error", { model, attempt, status, body }),
      },
    );

    if (!resp) {
      // NOTE: returned as HTTP 200 with an `error` field. supabase-js surfaces
      // a non-2xx as an opaque "Edge Function returned a non-2xx status code"
      // (body unreadable by our client), which would swallow these friendly
      // messages. 200 + { error } lets the client show them verbatim.
      let msg = "AI is having a moment — please try again.";
      if (lastStatus === 429) msg = "Too many requests — give it a moment and try again.";
      else if (lastStatus === 401 || lastStatus === 403) msg = "AI is misconfigured on the server.";
      else if (lastStatus === 400 && /safety|blocked|harm/i.test(lastBody)) msg = "Your tasks hit a safety filter — try rephrasing.";
      else if (lastStatus === 400) {
        const detail = typeof lastBody === "string" ? lastBody.trim().slice(0, 150) : "";
        msg = `AI rejected the request: ${detail || "Bad request"}.`;
      }
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
    const minToTime = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.max(0, mins % 60)).padStart(2, "0")}`;
    const normalizePlannerTitleKey = (t: string) =>
      String(t || "").replace(/\s*\(part\s+\d+\)$/i, "").trim().toLowerCase();

    // Deterministic guarantee against a missing start_time — the schema marks it
    // REQUIRED but the model can still omit/null it, and timeToMin() would silently
    // read that as "00:00", a real-looking time nothing downstream ever questions.
    // Runs BEFORE splitLongTask so a >90min untimed task's pieces all chain from one
    // correct anchor instead of each computing their own (wrong) cursor. Forward-fill
    // only — never invents a time earlier than the previous real block's end, or
    // earlier than the day's own earliestStart.
    let repairCursorEnd = 0;
    args.blocks = (Array.isArray(args.blocks) ? args.blocks : []).map((b: any) => {
      const dur = Number(b?.duration_min) || 0;
      if (/^\d{2}:\d{2}$/.test(String(b?.start_time || ""))) {
        repairCursorEnd = Math.max(repairCursorEnd, timeToMin(b.start_time) + dur);
        return b;
      }
      const fallback = repairCursorEnd || timeToMin(earliestStart);
      console.warn("[generate-plan] repaired missing start_time", { title: b?.title, fallback: minToTime(fallback) });
      repairCursorEnd = fallback + dur;
      return { ...b, start_time: minToTime(fallback) };
    });

    let normalizedBlocks = Array.isArray(args.blocks)
      ? args.blocks
        .flatMap((b: any) => (b?.kind === "task" && Number(b?.duration_min || 0) > 90 ? splitLongTask(b) : [b]))
        .map((b: any) => ({
          ...b,
          block_type: inferBlockType(b),
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

    // Deterministic guarantee — the prompt ASKS the model to avoid double-booking
    // and to schedule around calendar holds, but asking isn't enforcing. Single
    // forward pass over already-sorted blocks; only ever pushes a block LATER
    // (never earlier), so it can't violate the "no past slots" constraint
    // enforced elsewhere in the prompt — and one linear pass is provably
    // sufficient because the occupied-until cursor is monotonic and earlier
    // blocks are never revisited once finalized.
    const resolveConflicts = (blocks: any[], events: any[]) => {
      const locked = events
        .map((e: any) => ({
          start: timeToMin(e.start_time),
          end: timeToMin(e.start_time) + Number(e.duration_min || 0),
          consumed: false,
        }))
        .sort((a, b) => a.start - b.start);
      let cursor = 0;
      let shiftedCount = 0;
      const out = blocks.map((b: any) => {
        const origStart = timeToMin(b.start_time);
        const dur = Number(b.duration_min || 0);
        // The model's own faithful echo of a calendar event (start+duration
        // within rounding tolerance) is a hold, not something to push around —
        // trust it as-is and consume that interval so nothing else compares
        // against it again.
        const echoed = locked.find(
          (L) => !L.consumed && Math.abs(L.start - origStart) <= 2 && Math.abs((L.end - L.start) - dur) <= 2
        );
        if (echoed) {
          echoed.consumed = true;
          cursor = Math.max(cursor, echoed.end);
          return b;
        }
        let start = Math.max(origStart, cursor);
        // Locked list is sorted ascending; once `start` jumps past lock i it can
        // never re-conflict with an earlier lock, so a single ordered scan
        // (no nested loop) correctly cascades through back-to-back holds.
        for (const L of locked) {
          if (!L.consumed && start < L.end && start + dur > L.start) start = L.end;
        }
        cursor = start + dur;
        if (start === origStart) return b;
        shiftedCount += 1;
        return { ...b, start_time: minToTime(start) };
      });
      return {
        blocks: out.map((b: any) => ({
          ...b,
          slot_end_time: minToTime(timeToMin(b.start_time) + Number(b.duration_min || 0)),
        })),
        shiftedCount,
      };
    };
    const conflictResolved = resolveConflicts(normalizedBlocks, calendarEvents);
    normalizedBlocks = conflictResolved.blocks;

    // The prompt also says "MANDATORY LUNCH: insert a 45-60m Lunch block if the
    // plan spans past 13:00" — same problem, a request rather than an
    // enforcement. Backstop it for when the model simply forgets. Inserted
    // strictly inside a real gap (computed AFTER conflict-resolution, so it can
    // never overlap anything), and skipped silently if there's truly no slack
    // near midday rather than forcing a cascading shift of every later block.
    const ensureLunch = (blocks: any[]) => {
      const hasLunch = blocks.some(
        (b: any) => b?.kind === "lunch" || /\b(lunch|meal)\b/i.test(String(b?.title || ""))
      );
      if (hasLunch || !blocks.length) return { blocks, inserted: false };
      const dayStart = timeToMin(blocks[0].start_time);
      const dayEnd = Math.max(...blocks.map((b: any) => timeToMin(b.start_time) + Number(b.duration_min || 0)));
      if (dayEnd <= 13 * 60 || dayStart >= 14 * 60) return { blocks, inserted: false };
      let bestGapStart = -1;
      let bestGapEnd = -1;
      let bestOverlap = 0;
      for (let i = 0; i < blocks.length - 1; i++) {
        const curEnd = timeToMin(blocks[i].start_time) + Number(blocks[i].duration_min || 0);
        const nextStart = timeToMin(blocks[i + 1].start_time);
        if (nextStart - curEnd < 30) continue;
        const overlap = Math.min(nextStart, 14 * 60 + 30) - Math.max(curEnd, 12 * 60);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestGapStart = curEnd;
          bestGapEnd = nextStart;
        }
      }
      if (bestGapStart < 0) return { blocks, inserted: false };
      const lunchStart = Math.max(bestGapStart, 12 * 60);
      const lunchDur = Math.min(60, bestGapEnd - lunchStart);
      if (lunchDur < 30) return { blocks, inserted: false };
      const lunchBlock = {
        start_time: minToTime(lunchStart),
        duration_min: lunchDur,
        slot_end_time: minToTime(lunchStart + lunchDur),
        title: "Lunch",
        kind: "lunch",
        type: "routine",
        block_type: "rest",
        reasoning: "Added so your day doesn't skip lunch.",
      };
      const out = [...blocks, lunchBlock].sort((a: any, b: any) => timeToMin(a.start_time) - timeToMin(b.start_time));
      return { blocks: out, inserted: true };
    };
    const withLunch = ensureLunch(normalizedBlocks);
    normalizedBlocks = withLunch.blocks;

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
    const conflictNote = conflictResolved.shiftedCount > 0
      ? `Adjusted ${conflictResolved.shiftedCount} task(s) to avoid a clash`
      : null;
    const lunchNote = withLunch.inserted ? "Added a lunch block so your day doesn't skip it" : null;
    const chronicNote = (() => {
      if (!learningActive || !chronicTaskTitles.length) return null;
      const rawLower = String(raw_input || "").toLowerCase();
      const hit = chronicTaskTitles.find((t) => rawLower.includes(t.toLowerCase()));
      return hit ? "You've pushed this 3 times — want to break it into smaller steps?" : null;
    })();
    const learningNote = learningActive ? "Plan tuned to your patterns" : null;
    const finalSubtext = (() => {
      const base = String(args.subtext || "").trim();
      const notes = [base, conflictNote, lunchNote, bufferNote, learningNote, chronicNote].filter(Boolean) as string[];
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
