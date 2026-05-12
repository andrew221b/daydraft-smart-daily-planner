import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { HomeTrackerHero } from "@/components/app/HomeTrackerHero";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { todayDateStr, type Block, isUserTaskDone, isOpenUserTask } from "@/lib/daydraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
import { supabase } from "@/integrations/supabase/client";
import { applyAutoMissedBlocks } from "@/lib/blockResolution";
import { greetingFor, getTone } from "@/lib/tone";
import { CalendarDays, Sparkles, ChevronRight } from "lucide-react";
import { fmtHM, useTimeTracker } from "@/hooks/useTimeTracker";

/** Tracker is the hero. Plan is a small companion strip below. */
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
      nav("/history", { replace: true });
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
  const hasPlan = planData?.hasPlanForDate ?? false;

  const tasks = blocks.filter((b) => (b as Block).kind === "task" && !(b as Block).is_calendar_event);
  const done = tasks.filter((b) => isUserTaskDone(b as Block)).length;
  const allTasksDone = tasks.length > 0 && tasks.every((b) => !isOpenUserTask(b as Block));

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
          {/* Slim greeting */}
          <header className="mb-3 shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-fg/65">
              {firstName ? `Hi, ${firstName}` : greeting}
            </p>
          </header>

          {/* THE HERO — tracker */}
          <HomeTrackerHero onOpenDetails={() => nav("/history")} />

          {/* Today categories breakdown — minimal, only if data */}
          {breakdown.length > 0 && (
            <div className="mt-3 rounded-2xl border border-border/30 bg-card/30 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/70">Today</span>
                <button
                  type="button"
                  onClick={() => nav("/history")}
                  className="text-[11px] font-medium text-secondary-fg/80 hover:text-foreground pressable"
                >
                  Details →
                </button>
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

          {/* Subtle plan companion */}
          <div className="mt-3">
            {hasPlan ? (
              <button
                type="button"
                data-tour="home-plan-cta"
                onClick={() => nav("/today/plan")}
                className="group w-full flex items-center justify-between gap-3 rounded-2xl border border-border/30 bg-muted/[0.05] px-4 py-2.5 hover:bg-muted/[0.12] transition-colors pressable"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.1] text-primary">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-[13px] font-medium text-foreground/90 leading-tight">
                      {allTasksDone ? "Day complete" : "Today’s plan"}
                    </p>
                    <p className="text-[11px] text-secondary-fg/75 leading-tight mt-0.5 tabular-nums">
                      {done}/{tasks.length} tasks
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-secondary-fg/60 group-hover:text-foreground transition-colors" />
              </button>
            ) : (
              <button
                type="button"
                data-tour="home-plan-cta"
                onClick={() => nav("/today")}
                className="group w-full flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border/40 bg-transparent px-4 py-2.5 hover:border-border/70 hover:bg-muted/[0.06] transition-colors pressable"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05] text-foreground/70">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-[13px] font-medium text-foreground/90 leading-tight">
                      Plan the day
                    </p>
                    <p className="text-[11px] text-secondary-fg/75 leading-tight mt-0.5">
                      Optional companion
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-secondary-fg/55 group-hover:text-foreground transition-colors" />
              </button>
            )}
          </div>
        </div>
      </PullToRefresh>
    </Shell>
  );
}
