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
import { todayDateStr, parseDateStr, friendlyDateFor, type Block } from "@/lib/daydraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
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
  const done = tasks.filter((b) => b.completed).length;

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
        <div className="px-6 pt-14 pb-14 space-y-12 max-h-[calc(100dvh-112px)] overflow-y-auto">
          <header className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-secondary-fg/70">Today</p>
            <h1 className="font-display text-[28px] font-medium tracking-[-0.02em] text-foreground/95 text-balance leading-[1.15]">
              {greeting}
            </h1>
            <p className="text-[13px] text-secondary-fg/85 leading-relaxed pt-0.5">
              {friendlyDateFor(parseDateStr(viewDate))}
              {profile?.display_name ? ` · ${profile.display_name.split(" ")[0]}` : ""}
            </p>
          </header>

          <HomeTimerCard onExpand={() => setTrackerSheet(true)} />

          <section className="space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.2em] text-secondary-fg/65">Plan</h2>
              {hasPlan ? (
                <span className="text-[11px] text-secondary-fg/70 tabular-nums font-medium">
                  {done}/{tasks.length || 0}
                </span>
              ) : null}
            </div>
            {hasPlan ? (
              <div className="rounded-[22px] border border-border/45 bg-background/30 backdrop-blur-[2px] overflow-hidden">
                <div className="p-1">
                  <NextUpCard
                    blocks={blocks as Block[]}
                    nowHHMM={nowHM}
                    onOpenPlan={openTodayPlan}
                  />
                </div>
                <div className="flex gap-2 px-3 pb-3 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1 h-11 rounded-2xl text-[13px] font-medium text-foreground/85 hover:bg-muted/50"
                    onClick={openTodayPlan}
                  >
                    <ListTree className="h-4 w-4 mr-2 opacity-60" />
                    Timeline
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    data-tour="home-plan-cta"
                    className="flex-1 h-11 rounded-2xl text-[13px] font-medium text-primary hover:bg-primary/[0.07]"
                    onClick={openPlannerComposer}
                  >
                    <Pencil className="h-4 w-4 mr-2 opacity-80" />
                    Edit
                  </Button>
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
