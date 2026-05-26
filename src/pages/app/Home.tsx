import { useEffect, useMemo } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { HomeTrackerHero } from "@/components/app/HomeTrackerHero";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { YesterdayDebriefCard } from "@/components/app/YesterdayDebriefCard";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
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
  const tone = getTone(profile as any);
  const tour = useTour();
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const viewDate = todayDateStr();
  const { categories } = useTimeTracker();

  useEffect(() => {
    if (location.hash === "#tracker" || searchParams.get("tracker") === "1") {
      nav("/tracker", { replace: true });
    }
  }, [location.hash, searchParams, nav]);

  useEffect(() => {
    if (!profile?.onboarded) return;
    if (profile.tour_seen && (profile.tour_seen as Record<string, unknown>).today) return;
    const t = setTimeout(() => tour.start(TOUR_TODAY), 800);
    return () => clearTimeout(t);
  }, [profile?.onboarded, profile?.tour_seen, tour]);

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
    placeholderData: keepPreviousData,
  });
  const blocks = planData?.planBlocks ?? [];

  useEffect(() => {
    if (!user?.id || !tabVisible) return;
    let alive = true;
    const run = async () => {
      const d = await fetchPlanDashboard(user.id, viewDate);
      if (!d.planBlocks.length || !alive) return;
      const changed = await applyAutoMissedBlocks(supabase, viewDate, d.planBlocks as Block[]);
      if (alive && changed) void queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, viewDate) });
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
    const now = Date.now();
    const map = new Map<string, number>();
    let total = 0;
    for (const e of todays) {
      const s = Math.max(new Date(e.started_at).getTime(), ds);
      const en = Math.min(e.ended_at ? new Date(e.ended_at).getTime() : now, de);
      const sec = Math.max(0, (en - s) / 1000);
      if (sec <= 0 || !e.category_id) continue;
      total += sec;
      map.set(e.category_id, (map.get(e.category_id) || 0) + sec);
    }
    const catMap = new Map(categories.map((c) => [c.id, c]));
    return Array.from(map.entries())
      .map(([id, sec]) => ({ cat: catMap.get(id), sec, pct: total > 0 ? sec / total : 0 }))
      .filter((r) => r.cat)
      .sort((a, b) => b.sec - a.sec)
      .slice(0, 5);
  }, [rollingEntries, categories]);

  return (
    <PullToRefresh onRefresh={onRefresh}>
        <div className="w-full flex flex-col px-5 pt-[var(--content-inset-top)] pb-6">
          {/* Greeting */}
          <header className="mb-5 shrink-0">
            <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-secondary-fg/50 mb-1">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground overflow-hidden text-ellipsis whitespace-nowrap">
              {greeting}
            </h1>
          </header>

          {/* THE HERO — tracker */}
          <motion.div layout transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}>
            <HomeTrackerHero onOpenDetails={() => nav("/reports")} />
          </motion.div>

          {/* Morning look-back. Silently hides when there's no plan from
              yesterday, when the edge function isn't deployed, or when the
              user dismissed it for the day. */}
          <motion.div layout transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}>
            <YesterdayDebriefCard timezone={profile?.timezone} />
          </motion.div>

          {/* Today's plan progress */}
          {userTasks.length > 0 && (
            <motion.div
              layout
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              className="mt-4 hero-glass border border-border/35 rounded-[28px] px-4 py-4 cursor-pointer tappable"
              onClick={() => nav("/today")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && nav("/today")}
              aria-label="Open today's plan"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="eyebrow">Today's plan</span>
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

          {/* Today categories breakdown — minimal, only if data */}
          {breakdown.length > 0 && (
            <motion.div layout transition={{ type: "spring", bounce: 0.2, duration: 0.6 }} className="mt-4 hero-glass border border-border/35 rounded-[28px] px-4 py-3.5">
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
                    <span className="text-[13px] font-medium text-foreground/85 truncate flex-1">{row.cat!.name}</span>
                    <div className="flex-1 max-w-[72px] h-[3px] rounded-full bg-foreground/[0.07] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(8, row.pct * 100)}%`, background: row.cat!.color }} />
                    </div>
                    <div className="flex flex-col items-end shrink-0 w-[3.8rem]">
                      <span className="text-[12px] tabular-nums text-secondary-fg/80 font-medium leading-tight">{fmtHM(row.sec)}</span>
                      {row.cat!.hourly_rate && row.cat!.hourly_rate > 0 && (() => {
                        const earned = fmtMoney((row.sec / 3600) * row.cat!.hourly_rate!, row.cat!.currency || "USD");
                        if (!earned) return null;
                        return <span className="text-[10px] tabular-nums text-success/70 font-medium leading-tight">{earned}</span>;
                      })()}
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
