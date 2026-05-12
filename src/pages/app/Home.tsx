import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { HomeTrackerHero } from "@/components/app/HomeTrackerHero";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TrackerView } from "@/components/app/TrackerPill";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { todayDateStr, type Block, isUserTaskDone, isOpenUserTask } from "@/lib/daydraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
import { supabase } from "@/integrations/supabase/client";
import { applyAutoMissedBlocks } from "@/lib/blockResolution";
import { getTone, greetingFor } from "@/lib/tone";
import { CalendarDays, Sparkles, ChevronRight } from "lucide-react";

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

  return (
    <Shell>
      <PullToRefresh onRefresh={onRefresh}>
        <div className="flex min-h-0 flex-1 flex-col px-5 pt-9 pb-6">
          {/* Slim greeting — yields space to the hero */}
          <header className="mb-4 shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-secondary-fg/65">
              {firstName ? `Hi, ${firstName}` : greeting}
            </p>
            <h1 className="font-display text-[20px] font-semibold tracking-tight text-foreground/90 leading-snug mt-0.5">
              What are you working on?
            </h1>
          </header>

          {/* THE HERO — tracker */}
          <HomeTrackerHero onOpenDetails={() => setTrackerSheet(true)} />

          {/* Subtle plan companion */}
          <div className="mt-4">
            {hasPlan ? (
              <button
                type="button"
                data-tour="home-plan-cta"
                onClick={() => nav("/today/plan")}
                className="group w-full flex items-center justify-between gap-3 rounded-2xl border border-border/35 bg-muted/[0.08] px-4 py-3 hover:bg-muted/[0.16] transition-colors pressable"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.12] text-primary">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-[13px] font-semibold text-foreground/90 leading-tight">
                      {allTasksDone ? "Day complete" : "Today’s plan"}
                    </p>
                    <p className="text-[11px] text-secondary-fg/75 leading-tight mt-0.5 tabular-nums">
                      {done}/{tasks.length} tasks · tap to open
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
                className="group w-full flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border/45 bg-transparent px-4 py-3 hover:border-border/70 hover:bg-muted/[0.08] transition-colors pressable"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-foreground/70">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-[13px] font-semibold text-foreground/90 leading-tight">
                      Plan the day
                    </p>
                    <p className="text-[11px] text-secondary-fg/75 leading-tight mt-0.5">
                      Optional · shape a calm timeline
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-secondary-fg/55 group-hover:text-foreground transition-colors" />
              </button>
            )}
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
