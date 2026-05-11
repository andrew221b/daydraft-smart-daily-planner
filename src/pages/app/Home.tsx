import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { HomeTimerCard } from "@/components/app/HomeTimerCard";
import { NextUpCard } from "@/components/app/NextUpCard";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { TrackerView } from "@/components/app/TrackerPill";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { todayDateStr, parseDateStr, friendlyDateFor, type Block, isUserTaskDone, isOpenUserTask } from "@/lib/daydraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
import { supabase } from "@/integrations/supabase/client";
import { applyAutoMissedBlocks } from "@/lib/blockResolution";
import { getTone, greetingFor } from "@/lib/tone";
import { ListTree, Pencil } from "lucide-react";

/** Home stays today-only — other days live under Today / History. */
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
  const [trackerSheet, setTrackerSheet] = useState(false);

  useEffect(() => {
    if (location.hash === "#tracker" || searchParams.get("tracker") === "1") {
      setTrackerSheet(true);
    }
  }, [location.hash, searchParams]);

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

  const nowHMState = () => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
  };
  const [nowHM, setNowHM] = useState(nowHMState);
  useEffect(() => {
    const t = setInterval(() => setNowHM(nowHMState()), 30_000);
    return () => clearInterval(t);
  }, []);

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

  const openTodayPlan = () => nav("/today/plan");
  const openPlannerComposer = () => nav("/today");

  const greeting = greetingFor(tone, profile?.display_name);

  return (
    <Shell>
      <PullToRefresh onRefresh={onRefresh}>
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-10 pt-12">
          <header className="mb-5 shrink-0 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/72">Today</p>
            <h1 className="font-display text-[30px] font-semibold tracking-[-0.02em] text-foreground/95 text-balance leading-[1.12]">
              {greeting}
            </h1>
            <p className="text-[14px] font-medium text-secondary-fg/85 pt-0.5 leading-snug">
              {friendlyDateFor(parseDateStr(viewDate))}
              {profile?.display_name ? ` · ${profile.display_name.split(" ")[0]}` : ""}
            </p>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-5">
            <HomeTimerCard onExpand={() => setTrackerSheet(true)} />

            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/70">Plan</h2>
                {hasPlan ? (
                  <span className="text-[13px] tabular-nums font-semibold text-secondary-fg/85">
                    {done}/{tasks.length || 0}
                  </span>
                ) : null}
              </div>
              {hasPlan ? (
              <div
                data-tour="home-plan-cta"
                className="relative overflow-hidden rounded-[22px] border border-border/45 bg-background/30 backdrop-blur-[2px]"
              >
                <div className="relative z-10">
                  <NextUpCard
                    blocks={blocks as Block[]}
                    nowHHMM={nowHM}
                    onOpenPlan={openTodayPlan}
                    navigatePlanOnCardPress
                  />
                </div>
                <div className="relative z-20 flex gap-2 border-t border-border/30 px-3 pb-3 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1 h-12 rounded-2xl text-[14px] font-semibold text-foreground/88 hover:bg-muted/50"
                    onClick={(e) => {
                      e.stopPropagation();
                      openTodayPlan();
                    }}
                  >
                    <ListTree className="mr-2 h-4 w-4 opacity-65" />
                    Timeline
                  </Button>
                  {!allTasksDone && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1 h-12 rounded-2xl text-[14px] font-semibold text-primary hover:bg-primary/[0.08]"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPlannerComposer();
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4 opacity-85" />
                    Edit
                  </Button>
                  )}
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-tour="home-plan-cta"
                onClick={openPlannerComposer}
                className="group w-full rounded-[22px] border border-dashed border-border/50 bg-muted/[0.12] px-6 py-10 text-center pressable transition-colors hover:border-border/70 hover:bg-muted/[0.18]"
              >
                <p className="text-[15px] font-medium text-foreground/90 tracking-tight">Nothing on the slate</p>
                <p className="text-[13px] text-secondary-fg/75 mt-2 leading-relaxed max-w-[260px] mx-auto">
                  Add tasks and shape the day — one calm pass.
                </p>
              </button>
            )}
          </section>
          </div>
        </div>
      </PullToRefresh>

      <Sheet open={trackerSheet} onOpenChange={setTrackerSheet}>
        <SheetContent side="bottom" className="rounded-t-[28px] p-0 border-border/45 max-h-[92vh] overflow-y-auto bg-background">
          <div className="pt-14 pb-10">
            <TrackerView />
          </div>
        </SheetContent>
      </Sheet>
    </Shell>
  );
}
