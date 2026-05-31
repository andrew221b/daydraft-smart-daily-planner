import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { dispatchNudge } from "../_shared/pushDispatch.ts";
import {
  type BlockRow,
  type CategoryRow,
  type EnergyZones,
  type TimeEntryRow,
  buildEveningDebrief,
  buildMorningBrief,
  energyPeakInMin,
  nextEvent,
  parseHm,
  summarizeDay,
  trackedAndEarnings,
  ymdInTz,
} from "../_shared/briefData.ts";
import {
  type HistoryRow,
  type TrackedCategory,
  addDays,
  buildDayStats,
  buildTrackerEvening,
  buildTrackerMotivationMorning,
  buildWeeklyRecap,
  categoryBreakdown,
  closingLine,
  daysBetween,
  dowOf,
  selectEveningFeature,
  selectEveningSlot,
  selectMorningFeature,
  selectMorningSlot,
} from "../_shared/insights.ts";

/**
 * Cron-driven nudge dispatcher. Run every 15 minutes.
 *
 * For each user whose local clock matches a nudge slot, this builds a
 * data-driven push and fans it out to BOTH native (APNs/FCM) and Web Push via
 * the shared dispatcher. Two slots carry real value:
 *
 *   • morning  → yesterday's unfinished tasks + today's first event + energy
 *                peak + streak momentum. Deep-links to /today to plan.
 *   • evening  → today's score (X/Y tasks, hours tracked, earnings) + an offer
 *                to carry unfinished work forward. Deep-links to /reports.
 *
 * A Sunday-evening weekly pointer is preserved as a light touch.
 *
 * Dedup is handled inside dispatchNudge via notification_log, so overlapping
 * cron windows can't double-send. Web Push runs in dry-run automatically when
 * VAPID_* env vars are absent; native runs whenever APNs/FCM creds exist.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, timezone, morning_nudge_local_time, evening_nudge_local_time, notifications_enabled, energy_zones");

    const nowUtc = new Date();
    const nowMs = nowUtc.getTime();

    let usersMatched = 0;
    let fired = 0;
    let nativeSent = 0;
    let webSent = 0;

    /** Plan id for a user on a local date, or null. */
    const planId = async (userId: string, date: string): Promise<string | null> => {
      const { data } = await admin
        .from("plans").select("id").eq("user_id", userId).eq("date", date).maybeSingle();
      return (data?.id as string) ?? null;
    };

    /** All blocks for a plan, ordered. */
    const blocksFor = async (pid: string): Promise<BlockRow[]> => {
      const { data } = await admin
        .from("blocks")
        .select("id,title,type,kind,start_time,duration_min,slot_end_time,completed,resolution,estimated_minutes,actual_minutes,is_calendar_event")
        .eq("plan_id", pid)
        .order("position");
      return (data as BlockRow[]) ?? [];
    };

    /** Plans (with blocks) for the `days` before `endExclusive` (a YYYY-MM-DD),
     *  newest last. Two queries total — used to compute pattern insights and
     *  the weekly recap. */
    const historyRows = async (userId: string, endExclusive: string, days: number): Promise<HistoryRow[]> => {
      const { data: plans } = await admin
        .from("plans").select("id,date")
        .eq("user_id", userId)
        .gte("date", addDays(endExclusive, -days))
        .lt("date", endExclusive)
        .order("date");
      const list = (plans ?? []) as { id: string; date: string }[];
      if (!list.length) return [];
      const ids = list.map((p) => p.id);
      const { data: blocks } = await admin
        .from("blocks")
        .select("id,title,type,kind,start_time,duration_min,slot_end_time,completed,resolution,estimated_minutes,actual_minutes,is_calendar_event,plan_id")
        .in("plan_id", ids);
      const byPlan = new Map<string, BlockRow[]>();
      for (const b of (blocks ?? []) as (BlockRow & { plan_id: string })[]) {
        const arr = byPlan.get(b.plan_id) ?? [];
        arr.push(b);
        byPlan.set(b.plan_id, arr);
      }
      return list.map((p) => ({ date: p.date, blocks: byPlan.get(p.id) ?? [] }));
    };

    for (const p of profiles || []) {
      if (!p.notifications_enabled) continue;
      const userId = p.id as string;
      const tz = (p.timezone as string) || "UTC";

      const localStr = (() => {
        try {
          return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz, weekday: "short" }).format(nowUtc);
        } catch {
          return "Mon, 00:00";
        }
      })();
      // "Sun, 21:00"
      const [dow, hm] = localStr.split(", ");
      const todayLocal = ymdInTz(nowUtc, tz);
      const morning = String(p.morning_nudge_local_time || "07:00").slice(0, 5);
      const evening = String(p.evening_nudge_local_time || "21:00").slice(0, 5);

      // ── Morning brief ──────────────────────────────────────────────────
      if (hm === morning) {
        usersMatched += 1;

        const y = new Date(`${todayLocal}T12:00:00Z`);
        y.setUTCDate(y.getUTCDate() - 1);
        const yesterday = y.toISOString().slice(0, 10);

        const [yPid, tPid, streakRow, history] = await Promise.all([
          planId(userId, yesterday),
          planId(userId, todayLocal),
          admin.from("streaks").select("current_streak, longest_streak").eq("user_id", userId).maybeSingle(),
          historyRows(userId, todayLocal, 28),
        ]);
        const [yBlocks, tBlocks] = await Promise.all([
          yPid ? blocksFor(yPid) : Promise.resolve([] as BlockRow[]),
          tPid ? blocksFor(tPid) : Promise.resolve([] as BlockRow[]),
        ]);

        const streak = Number(streakRow.data?.current_streak || 0);
        // Days since the most recent prior plan (0 when there's no history) —
        // powers the "back at it" comeback moment.
        const lastPlanned = history.length ? history[history.length - 1].date : null;
        const gapDays = lastPlanned ? daysBetween(lastPlanned, todayLocal) : 0;

        const feature = selectMorningFeature({
          history,
          todayDow: dowOf(todayLocal),
          streak,
          longestStreak: Number(streakRow.data?.longest_streak || 0),
          localDate: todayLocal,
          gapDays,
        });

        const morningStats = buildDayStats(history);
        const morningSlot = selectMorningSlot(morningStats);
        const todayTasks = tBlocks.filter((b: BlockRow) => b.kind === "task" && !b.is_calendar_event);

        let nudge;
        if (morningSlot === "tracker-motivate" && todayTasks.length > 0) {
          nudge = buildTrackerMotivationMorning({ next: nextEvent(tBlocks, parseHm(hm)), taskCount: todayTasks.length, localDate: todayLocal });
        } else {
          const yDay = summarizeDay(yBlocks);
          const morningContext = yDay.openTitles.length === 0 && streak > 0 ? "strong" : yDay.openTitles.length > 2 ? "struggle" : "neutral";
          nudge = buildMorningBrief({
            yesterday: yDay,
            next: nextEvent(tBlocks, parseHm(hm)),
            energyPeakMin: energyPeakInMin((p.energy_zones as EnergyZones) ?? null, parseHm(hm)),
            streak,
            localDate: todayLocal,
            feature,
            closer: closingLine(todayLocal, "morning", morningContext),
          });
        }

        const r = await dispatchNudge(admin, userId, "morning", todayLocal, nudge);
        if (r.fired) { fired += 1; nativeSent += r.nativeSent; webSent += r.webSent; }
        continue;
      }

      // ── Evening debrief ────────────────────────────────────────────────
      if (hm === evening) {
        usersMatched += 1;

        const tPid = await planId(userId, todayLocal);
        if (!tPid) continue; // nothing planned → nothing to debrief

        const tBlocks = await blocksFor(tPid);
        // Pull ~29 days of entries once: today's metrics filter to today (local)
        // in the helper, and the same rows feed the per-day "personal record".
        const since = new Date(nowMs - 29 * 24 * 3600 * 1000).toISOString();
        const [entriesRes, catsRes, history, tmrPid] = await Promise.all([
          admin.from("time_entries").select("started_at,ended_at,category_id").eq("user_id", userId).gte("started_at", since),
          admin.from("time_categories").select("id,name,hourly_rate,rate_set_at,currency").eq("user_id", userId),
          historyRows(userId, todayLocal, 28),
          planId(userId, addDays(todayLocal, 1)),
        ]);
        const entries = (entriesRes.data as TimeEntryRow[]) ?? [];
        const cats = (catsRes.data as CategoryRow[]) ?? [];

        const { trackedMin, earnings } = trackedAndEarnings(entries, cats, todayLocal, tz, nowMs);

        // Per-day tracked/earnings + category breakdown across the window.
        const eveningHistory = buildDayStats(history.map((r) => {
          const te = trackedAndEarnings(entries, cats, r.date, tz, nowMs);
          const dayCategories = categoryBreakdown(entries, cats, r.date, tz, nowMs);
          return { ...r, trackedMin: te.trackedMin, amount: te.earnings?.amount ?? 0, currency: te.earnings?.currency ?? "USD", categories: dayCategories };
        }));

        // Today's category breakdown (for tracker-mode body).
        const todayCategories = categoryBreakdown(entries, cats, todayLocal, tz, nowMs);
        const todayStat = eveningHistory.find((d) => d.date === todayLocal) ?? {
          date: todayLocal, dow: dowOf(todayLocal), doneCount: 0, totalCount: 0, pct: 0,
          trackedMin, amount: earnings?.amount ?? 0, currency: earnings?.currency ?? "USD",
          topCategory: todayCategories[0] && trackedMin > 0 && todayCategories[0].trackedMin / trackedMin >= 0.4 && todayCategories[0].trackedMin >= 20
            ? todayCategories[0] : null,
        };

        const today = summarizeDay(tBlocks);
        const eveningSlot = selectEveningSlot({ ...todayStat, doneCount: today.doneCount, totalCount: today.totalCount, pct: today.pct });

        let nudge;
        if (eveningSlot === "tracker") {
          nudge = buildTrackerEvening({ today: { ...todayStat, doneCount: today.doneCount, totalCount: today.totalCount, pct: today.pct }, categories: todayCategories, localDate: todayLocal });
        } else {
          const feature = selectEveningFeature({ today, trackedMin, earnings, history: eveningHistory, localDate: todayLocal });
          const evContext = today.pct >= 80 ? "strong" : today.pct < 40 ? "struggle" : "neutral";
          const tmrBlocks = tmrPid ? await blocksFor(tmrPid) : [];
          nudge = buildEveningDebrief({
            today,
            trackedMin,
            earnings,
            localDate: todayLocal,
            feature,
            tomorrowFirst: nextEvent(tmrBlocks, -1),
            closer: closingLine(todayLocal, "evening", evContext),
          });
        }

        const r = await dispatchNudge(admin, userId, "evening", todayLocal, nudge);
        if (r.fired) { fired += 1; nativeSent += r.nativeSent; webSent += r.webSent; }
        continue;
      }

      // ── Weekly recap (Sun 18:00 local) — a real "your week" moment ─────
      if (dow === "Sun" && hm === "18:00") {
        usersMatched += 1;

        // Last 14 days (incl today) split into this week / prior week.
        const since = new Date(nowMs - 15 * 24 * 3600 * 1000).toISOString();
        const [history, entriesRes, catsRes, streakRow] = await Promise.all([
          historyRows(userId, addDays(todayLocal, 1), 14),
          admin.from("time_entries").select("started_at,ended_at,category_id").eq("user_id", userId).gte("started_at", since),
          admin.from("time_categories").select("id,name,hourly_rate,rate_set_at,currency").eq("user_id", userId),
          admin.from("streaks").select("current_streak").eq("user_id", userId).maybeSingle(),
        ]);
        const entries = (entriesRes.data as TimeEntryRow[]) ?? [];
        const cats = (catsRes.data as CategoryRow[]) ?? [];

        const stats = buildDayStats(history.map((r) => {
          const te = trackedAndEarnings(entries, cats, r.date, tz, nowMs);
          const dayCats = categoryBreakdown(entries, cats, r.date, tz, nowMs);
          return { ...r, trackedMin: te.trackedMin, amount: te.earnings?.amount ?? 0, currency: te.earnings?.currency ?? "USD", categories: dayCats };
        }));
        const week = stats.filter((d) => daysBetween(d.date, todayLocal) <= 6);
        const priorWeek = stats.filter((d) => { const a = daysBetween(d.date, todayLocal); return a >= 7 && a <= 13; });

        // Skip a hollow recap for users with no activity this week.
        const activity = week.reduce((s, d) => s + d.totalCount + d.trackedMin, 0);
        if (activity <= 0) continue;

        // Top tracker category for the week (sum across days).
        const weekCatTotals = new Map<string, TrackedCategory>();
        for (const d of week) {
          if (!d.topCategory) continue;
          const prev = weekCatTotals.get(d.topCategory.name) ?? { name: d.topCategory.name, trackedMin: 0, amount: 0, currency: d.topCategory.currency };
          weekCatTotals.set(d.topCategory.name, { ...prev, trackedMin: prev.trackedMin + d.topCategory.trackedMin, amount: prev.amount + d.topCategory.amount });
        }
        const topWeekCategory = weekCatTotals.size > 0
          ? [...weekCatTotals.values()].sort((a, b) => b.trackedMin - a.trackedMin)[0]
          : null;

        const weekPct = week.reduce((s, d) => s + d.totalCount, 0) > 0
          ? Math.round(week.reduce((s, d) => s + d.doneCount, 0) / week.reduce((s, d) => s + d.totalCount, 0) * 100) : 0;
        const nudge = buildWeeklyRecap({
          week, priorWeek,
          streak: Number(streakRow.data?.current_streak || 0),
          localDate: todayLocal,
          topWeekCategory,
          closer: closingLine(todayLocal, "weekly", weekPct >= 75 ? "strong" : "neutral"),
        });
        const r = await dispatchNudge(admin, userId, "weekly", todayLocal, nudge);
        if (r.fired) { fired += 1; nativeSent += r.nativeSent; webSent += r.webSent; }
        continue;
      }
    }

    return new Response(JSON.stringify({
      now_utc: nowUtc.toISOString(),
      users_matched: usersMatched,
      fired,
      native_sent: nativeSent,
      web_sent: webSent,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
