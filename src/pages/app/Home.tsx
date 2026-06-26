import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { HomeTrackerHero } from "@/components/app/HomeTrackerHero";
import { FeatureHint } from "@/components/app/FeatureHint";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { YesterdayDebriefCard } from "@/components/app/YesterdayDebriefCard";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { todayDateStr, isUserTask, isOpenUserTask, isUserTaskDone, type Block } from "@/lib/daydraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
import { supabase } from "@/integrations/supabase/client";
import { applyAutoMissedBlocks } from "@/lib/blockResolution";
import { greetingFor, getTone } from "@/lib/tone";
import { fmtHM, useTimeTracker } from "@/hooks/useTimeTracker";
import {
  fetchRollingEntries,
  filterEntriesByRange,
  rollingEntriesQueryKey,
} from "@/lib/timeEntriesQuery";
import { useTabVisible } from "@/components/app/PersistentTabs";
import { peekChecklistCounts, prefetchChecklistCounts } from "@/hooks/useChecklist";
import { useDayKey } from "@/hooks/useDayKey";
import { motion } from "framer-motion";

function fmtMoney(amount: number, currency: string): string | null {
  if (amount < 0.005) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Tracker is the hero. */
export default function Home() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const tone = getTone(profile);
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  // Reactive "today" — re-evaluated on resume so opening the app the next morning
  // shows the new day immediately, not yesterday's plan. A plain todayDateStr()
  // const only updates when something else happens to re-render.
  const [viewDate, setViewDate] = useState(() => todayDateStr());
  useEffect(() => {
    const sync = () => setViewDate(todayDateStr());
    const onVis = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(sync, 60_000);
    let nativeListener: Promise<{ remove: () => void }> | null = null;
    import("@capacitor/app")
      .then(({ App }) => {
        nativeListener = App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) sync();
        });
      })
      .catch(() => {});
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
      if (nativeListener) void nativeListener.then((l) => l.remove());
    };
  }, []);

  // When the local day rolls over (viewDate just changed), the plan-dashboard
  // query refetches via its viewDate key and the insight card via its own
  // dayKey — but the shared rolling-entries cache is keyed only on the user, and
  // native builds disable refetch-on-focus. Nudge the day-scoped caches so
  // "tracked today" and the calendar markers reflect the NEW day on resume
  // instead of silently showing yesterday's until the next manual refresh.
  const dayRolloverRef = useRef(true);
  useEffect(() => {
    if (dayRolloverRef.current) { dayRolloverRef.current = false; return; }
    if (!user?.id) return;
    void queryClient.invalidateQueries({ queryKey: rollingEntriesQueryKey(user.id) });
    void queryClient.invalidateQueries({ queryKey: ["plan-dates-markers", user.id] });
  }, [viewDate, user?.id, queryClient]);

  const { allCatMap } = useTimeTracker();
  // Rolls over at local midnight (live: matches the hero counter) so the
  // "Time tracked today" breakdown below recomputes its day window instead of
  // showing yesterday's sessions until the next manual reload.
  const dayKey = useDayKey({ live: true });

  // Pause the missed-block poll while this tab isn't on screen. Background
  // tabs in a native app don't keep hitting the network — this matches that
  // behavior so we don't pay a Supabase round-trip every 60s while the user
  // is on Reports / Settings / Tracker.
  const tabVisible = useTabVisible();

  const { data: planData } = useQuery({
    queryKey: planDashboardQueryKey(user?.id || "", viewDate),
    queryFn: () => fetchPlanDashboard(user!.id, viewDate),
    enabled: !!user?.id && !!viewDate && tabVisible,
    staleTime: 30_000,
    // No keepPreviousData: the query key only changes when the day rolls over (or
    // the user changes). Carrying yesterday's plan across that boundary is exactly
    // the "stale previous day flashes for a second" bug — show empty/loading until
    // today's data lands instead. Within a day the cache already serves instantly.
  });
  const blocks = planData?.planBlocks ?? [];

  // Checklist counts from localStorage cache — synchronous read, no fetch.
  // `seed` bumps after a background prefetch so the card appears on first
  // login without the user having to visit the checklist screen first.
  const [checklistSeed, setChecklistSeed] = useState(0);
  // Direct read — peekChecklistCounts is a cheap synchronous localStorage
  // read; useMemo was stale-caching it and missing updates when the user
  // toggled checklist items on the Plan tab and came back.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checklistCounts = peekChecklistCounts(user?.id, viewDate);
  void checklistSeed; void tabVisible; // keep the deps that force re-render

  // On first tab-visible with an empty cache, prefetch from Supabase so the
  // progress card shows immediately after sign-in (before visiting the checklist tab).
  useEffect(() => {
    if (!user?.id || !tabVisible || checklistCounts.total > 0) return;
    void prefetchChecklistCounts(user.id, viewDate).then((fetched) => {
      if (fetched) setChecklistSeed((n) => n + 1);
    });
  }, [user?.id, viewDate, tabVisible, checklistCounts.total]);

  useEffect(() => {
    if (!user?.id || !tabVisible) return;
    let alive = true;
    const run = async () => {
      const d = await fetchPlanDashboard(user.id, viewDate);
      if (!d.planBlocks.length || !alive) return;
      const missed = await applyAutoMissedBlocks(supabase, viewDate, d.planBlocks as Block[]);
      if (alive && missed.length) void queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, viewDate) });
    };
    void run();
    const id = setInterval(run, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user?.id, viewDate, queryClient, tabVisible]);

  const onRefresh = async () => {
    if (!user?.id) return;
    await queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, viewDate) });
    await queryClient.invalidateQueries({ queryKey: ["plan-dates-markers", user!.id] });
  };

  const greeting = greetingFor(tone, profile?.display_name);
  const firstName = profile?.display_name?.split(" ")[0];

  // Today's category breakdown reads from the shared rolling-entries cache —
  // no Home-only fetch. Reports, Tracker, and useTimeTracker all draw from the
  // same query, so the data is already warm by the time Home mounts.
  const { data: rollingEntries } = useQuery({
    queryKey: rollingEntriesQueryKey(user?.id),
    queryFn: () => fetchRollingEntries(user!.id),
    enabled: !!user?.id && tabVisible,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });
  // Intentionally not subscribing to elapsed ticks — the breakdown reads
  // committed entries from rollingEntries (db-backed), which only updates
  // when a session ends, not per-second. Re-rendering every second here
  // gains nothing and costs a React diff of the whole page.

  const userTasks = useMemo(() => blocks.filter(isUserTask), [blocks]);
  const doneTasks = useMemo(() => userTasks.filter((b) => isUserTaskDone(b)).length, [userTasks]);
  const nextTask = useMemo(() => blocks.find((b) => isUserTask(b) && isOpenUserTask(b)), [blocks]);

  const breakdown = useMemo(() => {
    if (!rollingEntries?.length) return [];
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const ds = dayStart.getTime();
    const de = dayEnd.getTime();
    const todays = filterEntriesByRange(rollingEntries, { from: dayStart, to: dayEnd });
    const map = new Map<string, { sec: number; earned: number }>();
    let total = 0;
    for (const e of todays) {
      if (!e.ended_at) continue; // only show completed sessions
      const s = Math.max(new Date(e.started_at).getTime(), ds);
      const en = Math.min(new Date(e.ended_at).getTime(), de);
      const sec = Math.max(0, (en - s) / 1000);
      if (sec <= 0 || !e.category_id) continue;
      total += sec;
      // Use only the snapshot rate captured at session start — changing the
      // current rate must never retroactively alter what was earned.
      const rate = e.snapshot_hourly_rate ?? 0;
      const earned = (rate > 0) ? (rate * sec) / 3600 : 0;
      const prev = map.get(e.category_id) ?? { sec: 0, earned: 0 };
      map.set(e.category_id, { sec: prev.sec + sec, earned: prev.earned + earned });
    }
    return Array.from(map.entries())
      .map(([id, { sec, earned }]) => {
        const cat = allCatMap.get(id);
        if (!cat) return null;
        return {
          cat,
          sec,
          earned,
          pct: total > 0 ? sec / total : 0,
          isDeleted: !!cat.deleted_at,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.sec - a.sec)
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollingEntries, allCatMap, dayKey]);

  return (
    <PullToRefresh onRefresh={onRefresh}>
        <div className="w-full md:max-w-[680px] lg:max-w-[760px] md:mx-auto flex flex-col px-5 md:px-8 pt-[var(--content-inset-top)] pb-6">
          {/* Greeting */}
          <header className="mb-5 shrink-0">
            <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-secondary-fg/50 mb-1">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <h1 className="page-title text-foreground break-words pr-2">
              {greeting}
            </h1>
          </header>

          {/* Morning look-back / daily surprise. Silently hides when there's no plan from
              yesterday, when the edge function isn't deployed, or when the
              user dismissed it for the day. */}
          <motion.div layout transition={{ type: "spring", bounce: 0.2, duration: 0.6 }} className="mt-4">
            <YesterdayDebriefCard timezone={profile?.timezone} />
          </motion.div>

          {/* THE HERO — tracker */}
          <motion.div layout transition={{ type: "spring", bounce: 0.2, duration: 0.6 }} className="mt-4">
            <HomeTrackerHero onOpenDetails={() => nav("/reports")} />
          </motion.div>

          {/* In-context tip: the tracker's persistence is its killer, non-obvious trait. */}
          <FeatureHint
            id="tracker-persistence"
            selector="[data-tour='hero-tracker']"
            title="A timer that never loses count"
            placement="bottom"
          >
            Start it, pick a category and rate, and it keeps running through locks and reboots — even on your Lock Screen — tallying earnings live.
          </FeatureHint>

          {/* Today's plan progress */}
          {userTasks.length > 0 && (
            <motion.div
              layout
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              className="mt-4 hero-glass border border-border/65 rounded-[28px] px-4 py-4 cursor-pointer tappable"
              onClick={() => nav("/today?mode=timeline")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && nav("/today?mode=timeline")}
              aria-label="Open today's plan"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="eyebrow">Today's timeline</span>
                <div className="flex items-center gap-2">
                  {doneTasks > 0 && doneTasks < userTasks.length && (
                    <span className="text-[12px] font-semibold text-primary tabular-nums">
                      {Math.round((doneTasks / userTasks.length) * 100)}%
                    </span>
                  )}
                  <span className="text-[12px] tabular-nums text-secondary-fg/70">
                    {doneTasks}/{userTasks.length}
                  </span>
                </div>
              </div>
              <div className="h-2 rounded-full bg-muted/45 overflow-hidden">
                <div
                  className="h-full rounded-full progress-fill"
                  style={{ width: `${(doneTasks / userTasks.length) * 100}%` }}
                />
              </div>
              {nextTask && doneTasks < userTasks.length && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/55 shrink-0">Next</span>
                  <span className="text-[13px] font-medium text-foreground/90 truncate">{nextTask.title}</span>
                </div>
              )}
              {doneTasks === userTasks.length && (
                <div className="mt-2 text-[13px] font-semibold text-success">All done ✓</div>
              )}
            </motion.div>
          )}

          {/* Checklist plan progress — only when items exist */}
          {checklistCounts.total > 0 && (
            <motion.div
              layout
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              className="mt-3 hero-glass border border-border/65 rounded-[28px] px-4 py-4 cursor-pointer tappable"
              onClick={() => nav("/today?mode=checklist")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && nav("/today?mode=checklist")}
              aria-label="Open today's checklist"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="eyebrow">Today's checklist</span>
                <div className="flex items-center gap-2">
                  {checklistCounts.open > 0 && checklistCounts.open < checklistCounts.total && (
                    <span className="text-[12px] font-semibold tabular-nums" style={{ color: "hsl(var(--checklist-accent))" }}>
                      {Math.round(((checklistCounts.total - checklistCounts.open) / checklistCounts.total) * 100)}%
                    </span>
                  )}
                  <span className="text-[12px] tabular-nums text-secondary-fg/70">
                    {checklistCounts.total - checklistCounts.open}/{checklistCounts.total}
                  </span>
                </div>
              </div>
              <div className="h-2 rounded-full bg-muted/45 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${((checklistCounts.total - checklistCounts.open) / checklistCounts.total) * 100}%`,
                    background: "hsl(var(--checklist-accent))",
                    boxShadow: checklistCounts.open === 0 ? "0 0 8px hsl(var(--checklist-accent) / 0.5)" : "none",
                  }}
                />
              </div>
              {checklistCounts.open === 0 && (
                <div className="mt-2 text-[13px] font-semibold" style={{ color: "hsl(var(--checklist-accent))" }}>
                  All checked off ✓
                </div>
              )}
            </motion.div>
          )}

          {/* Today categories breakdown — minimal, only if data */}
          {breakdown.length > 0 && (
            <motion.div layout transition={{ type: "spring", bounce: 0.2, duration: 0.6 }} className="mt-4 hero-glass border border-border/65 rounded-[28px] px-4 py-3.5">
              <div className="flex items-center justify-between mb-3">
                <span className="eyebrow">Time tracked today</span>
                <span className="text-[11px] tabular-nums text-secondary-fg/55 font-medium">
                  {fmtHM(breakdown.reduce((s, r) => s + r.sec, 0))} total
                </span>
              </div>
              <ul className="space-y-2.5">
                {breakdown.map((row) => (
                  <li key={row.cat!.id} className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: row.cat!.color }} />
                    <span className="text-[13px] font-medium text-foreground/85 truncate flex-1">
                      {row.cat!.name}
                      {row.isDeleted && <span className="text-destructive/70"> (Deleted)</span>}
                    </span>
                    <div className="flex-1 max-w-[72px] h-[3px] rounded-full bg-foreground/[0.07] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(8, row.pct * 100)}%`, background: row.cat!.color }} />
                    </div>
                    <div className="flex flex-col items-end shrink-0 w-[3.8rem]">
                      <span className="text-[12px] tabular-nums text-secondary-fg/80 font-medium leading-tight">{fmtHM(row.sec)}</span>
                      {row.earned > 0 && (
                        <span className="text-[10px] tabular-nums text-success/70 font-medium leading-tight">
                          {fmtMoney(row.earned, row.cat!.currency || "USD")}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </div>
    </PullToRefresh>
  );
}
