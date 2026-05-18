import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { HomeTrackerHero } from "@/components/app/HomeTrackerHero";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { todayDateStr, isUserTask, isOpenUserTask, isUserTaskDone, type Block } from "@/lib/daydraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
import { supabase } from "@/integrations/supabase/client";
import { applyAutoMissedBlocks } from "@/lib/blockResolution";
import { greetingFor, getTone } from "@/lib/tone";
import { fmtHM, useTimeTracker } from "@/hooks/useTimeTracker";

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

  const { data: planData } = useQuery({
    queryKey: planDashboardQueryKey(user?.id ?? "", viewDate),
    queryFn: () => fetchPlanDashboard(user!.id, viewDate),
    enabled: !!user?.id,
    staleTime: 30_000,
  });
  const blocks = planData?.planBlocks ?? [];

  useEffect(() => {
    if (!user?.id) return;
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
  }, [user?.id, viewDate, queryClient]);

  const onRefresh = async () => {
    if (!user?.id) return;
    await queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, viewDate) });
    await queryClient.invalidateQueries({ queryKey: ["plan-dates-markers", user!.id] });
  };

  const greeting = greetingFor(tone, profile?.display_name);
  const firstName = profile?.display_name?.split(" ")[0];

  // Today's category breakdown — minimal, only when there is data
  const { data: todayEntries } = useQuery({
    queryKey: ["today-entries", user?.id, viewDate],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const start = new Date(); start.setHours(0,0,0,0);
      const { data } = await supabase
        .from("time_entries")
        .select("category_id, started_at, ended_at")
        .eq("user_id", user!.id)
        .gte("started_at", start.toISOString());
      return data ?? [];
    },
  });

  const userTasks = useMemo(() => blocks.filter(isUserTask), [blocks]);
  const doneTasks = useMemo(() => userTasks.filter((b) => isUserTaskDone(b)).length, [userTasks]);
  const nextTask = useMemo(() => blocks.find((b) => isUserTask(b) && isOpenUserTask(b)), [blocks]);

  const breakdown = useMemo(() => {
    if (!todayEntries?.length) return [];
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const ds = dayStart.getTime();
    const de = ds + 86_400_000;
    const now = Date.now();
    const map = new Map<string, number>();
    let total = 0;
    todayEntries.forEach((e: any) => {
      const s = Math.max(new Date(e.started_at).getTime(), ds);
      const en = Math.min(e.ended_at ? new Date(e.ended_at).getTime() : now, de);
      const sec = Math.max(0, (en - s) / 1000);
      if (sec <= 0 || !e.category_id) return;
      total += sec;
      map.set(e.category_id, (map.get(e.category_id) || 0) + sec);
    });
    const catMap = new Map(categories.map((c) => [c.id, c]));
    return Array.from(map.entries())
      .map(([id, sec]) => ({ cat: catMap.get(id), sec, pct: total > 0 ? sec / total : 0 }))
      .filter((r) => r.cat)
      .sort((a, b) => b.sec - a.sec)
      .slice(0, 5);
  }, [todayEntries, categories]);

  return (
    <Shell>
      <PullToRefresh onRefresh={onRefresh}>
        <div className="flex min-h-0 flex-1 flex-col px-5 pt-7 pb-6">
          {/* Greeting */}
          <header className="mb-4 shrink-0">
            <p className="text-[11px] font-medium tracking-[0.12em] uppercase text-secondary-fg/60 mb-0.5">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <h1 className="font-display text-[24px] font-semibold tracking-tight leading-tight text-foreground overflow-hidden text-ellipsis whitespace-nowrap">
              {greeting}
            </h1>
          </header>

          {/* THE HERO — tracker */}
          <HomeTrackerHero onOpenDetails={() => nav("/history")} />

          {/* Today's plan progress */}
          {userTasks.length > 0 && (
            <div
              className="mt-3 app-card px-4 py-3.5 cursor-pointer pressable"
              onClick={() => nav("/today")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && nav("/today")}
              aria-label="Open today's plan"
            >
              <div className="flex items-center justify-between mb-2.5">
                <span className="eyebrow">Today's plan</span>
                <span className="text-[12px] tabular-nums text-secondary-fg/80">
                  {doneTasks}/{userTasks.length} done
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/85 transition-all duration-500"
                  style={{ width: `${(doneTasks / userTasks.length) * 100}%` }}
                />
              </div>
              {nextTask && doneTasks < userTasks.length && (
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-[10px] text-secondary-fg/70 shrink-0">Next</span>
                  <span className="text-[13px] font-medium text-foreground/90 truncate">{nextTask.title}</span>
                </div>
              )}
              {doneTasks === userTasks.length && (
                <div className="mt-2 text-[12px] font-medium text-success">All done today ✓</div>
              )}
            </div>
          )}

          {/* Today categories breakdown — minimal, only if data */}
          {breakdown.length > 0 && (
            <div className="mt-3 app-card px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="eyebrow">Time tracked</span>
              </div>
              <ul className="space-y-1.5">
                {breakdown.map((row) => (
                  <li key={row.cat!.id} className="flex items-center gap-2.5">
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: row.cat!.color }} />
                    <span className="text-[12px] font-medium text-foreground/85 truncate flex-1">{row.cat!.name}</span>
                    <div className="flex-1 max-w-[80px] h-[3px] rounded-full bg-foreground/[0.06] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(6, row.pct * 100)}%`, background: row.cat!.color }} />
                    </div>
                    <span className="text-[11px] tabular-nums text-secondary-fg/85 w-[3.2rem] text-right">{fmtHM(row.sec)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </PullToRefresh>
    </Shell>
  );
}
