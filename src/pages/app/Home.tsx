import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { HomeTimerCard } from "@/components/app/HomeTimerCard";
import { NextUpCard } from "@/components/app/NextUpCard";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TrackerView } from "@/components/app/TrackerPill";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import {
  todayDateStr,
  dateStr,
  parseDateStr,
  friendlyDateFor,
  type Block,
} from "@/lib/daydraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
import { usePlannedDates } from "@/hooks/usePlannedDates";
import { getTone, greetingFor } from "@/lib/tone";
import { CalendarDays, ListTree, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Home() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const tone = getTone(profile as any);
  const tour = useTour();
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [viewDate, setViewDate] = useState<string>(todayDateStr());
  const [dateOpen, setDateOpen] = useState(false);
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

  const { data: plannedDates = new Set<string>() } = usePlannedDates(user?.id);

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
  const isTodayView = viewDate === todayDateStr();

  const onRefresh = async () => {
    if (!user?.id) return;
    await queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, viewDate) });
    await queryClient.invalidateQueries({ queryKey: ["plan-dates-markers", user!.id] });
  };

  const greeting = greetingFor(tone, profile?.display_name);

  return (
    <Shell>
      <PullToRefresh onRefresh={onRefresh}>
        <div className="px-6 pt-14 pb-14 space-y-12 max-h-[calc(100dvh-112px)] overflow-y-auto">
          <header className="flex items-start justify-between gap-6">
            <div className="min-w-0 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-secondary-fg/70">
                {isTodayView ? "Today" : friendlyDateFor(parseDateStr(viewDate))}
              </p>
              <h1 className="font-display text-[28px] font-medium tracking-[-0.02em] text-foreground/95 text-balance leading-[1.15]">
                {greeting}
              </h1>
              <p className="text-[13px] text-secondary-fg/85 leading-relaxed pt-0.5">
                {friendlyDateFor(parseDateStr(viewDate))}
                {profile?.display_name ? ` · ${profile.display_name.split(" ")[0]}` : ""}
              </p>
              {!isTodayView && (
                <button
                  type="button"
                  onClick={() => setViewDate(todayDateStr())}
                  className="mt-3 text-[12px] font-medium text-primary/90 pressable"
                >
                  Back to today
                </button>
              )}
            </div>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-2 h-11 px-3.5 rounded-2xl text-[12px] font-medium shrink-0 pressable",
                    "bg-background/40 text-foreground/90 border border-border/50 shadow-none",
                    "hover:bg-background/60 hover:border-border/80 transition-colors",
                    plannedDates.has(viewDate) && "ring-1 ring-primary/20",
                  )}
                >
                  <CalendarDays className="h-4 w-4 text-secondary-fg/80" />
                  {isTodayView ? "Date" : viewDate.slice(5).replace("-", ".")}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 border-border/60 shadow-lg" align="end">
                <Calendar
                  mode="single"
                  selected={parseDateStr(viewDate)}
                  onSelect={(d) => {
                    if (!d) return;
                    const key = dateStr(d);
                    setViewDate(key);
                    setDateOpen(false);
                  }}
                  modifiers={{ hasPlan: (d: Date) => plannedDates.has(dateStr(d)) }}
                  modifiersClassNames={{
                    hasPlan: "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-primary",
                  }}
                  disabled={(d) => {
                    const today = new Date();
                    today.setHours(23, 59, 59, 999);
                    return d > today;
                  }}
                  initialFocus
                  className="p-3"
                />
              </PopoverContent>
            </Popover>
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
                    nowHHMM={isTodayView ? nowHM : "12:00"}
                    onOpenPlan={() => nav(`/today/plan?date=${viewDate}`)}
                  />
                </div>
                <div className="flex gap-2 px-3 pb-3 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1 h-11 rounded-2xl text-[13px] font-medium text-foreground/85 hover:bg-muted/50"
                    onClick={() => nav(`/today/plan?date=${viewDate}`)}
                  >
                    <ListTree className="h-4 w-4 mr-2 opacity-60" />
                    Timeline
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    data-tour="home-plan-cta"
                    className="flex-1 h-11 rounded-2xl text-[13px] font-medium text-primary hover:bg-primary/[0.07]"
                    onClick={() => nav(isTodayView ? `/today` : `/today?date=${viewDate}`)}
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
                onClick={() => nav(isTodayView ? "/today" : `/today?date=${viewDate}`)}
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
