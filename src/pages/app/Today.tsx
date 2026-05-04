import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  friendlyDate,
  todayDateStr,
  dateStr,
  parseDateStr,
  friendlyDateFor,
  fmtTime,
  Block,
  typeColor,
  isUserTask,
} from "@/lib/daydraft";
import { getTone, t as toneCopy, greetingFor } from "@/lib/tone";
import {
  Mic,
  ArrowRight,
  CalendarDays,
  MoreHorizontal,
  Bookmark,
  Plus,
  Pencil,
  Target,
  ListChecks,
  Inbox,
  CheckCircle2,
  Clock3,
  Zap,
  ShieldAlert,
  Info,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ProBadge } from "@/components/app/ProBadge";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { ClarifySheet, ClarifiedTask } from "@/components/app/ClarifySheet";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { BeginnerTip } from "@/components/app/BeginnerTip";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { haptics } from "@/lib/haptics";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TodayInsight } from "@/components/app/TodayInsight";
import { NextUpCard } from "@/components/app/NextUpCard";
import { getWeekIntention } from "@/lib/weekIntention";
import { dayShapeHint } from "@/lib/microDelights";
import { readComposerDraft, writeComposerDraft, clearComposerDraft } from "@/lib/composerDraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
import { KpiCard } from "@/components/app/KpiCard";
import { useCalmMode } from "@/lib/calmMode";
import { EnergyState, RescueMode, readEnergyState, rescuePlanFromBlocks, writeEnergyState } from "@/lib/productPolish";

const DEFAULT_PLACEHOLDER =
  "Brain-dump your day…\nfinish deck · gym 45m · call mom 15m · ship invoice";
const TODAY_TIP_DISMISSED_KEY = "dd_today_tip_dismissed";

export default function Today() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isPro, planQuotaRemaining, planQuotaUsed, planQuotaLimit, entitlement } = useEntitlement();
  const tour = useTour();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<"quota" | "feature" | "trial-banner" | "momentum">("feature");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const [templates, setTemplates] = useState<{ id: string; name: string; raw_input: string }[]>([]);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [planDate, setPlanDate] = useState<string>(todayDateStr());
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerExtrasOpen, setComposerExtrasOpen] = useState(false);
  const [pendingCaptureIds, setPendingCaptureIds] = useState<string[]>([]);
  const { data: planData } = useQuery({
    queryKey: planDashboardQueryKey(user?.id ?? "", planDate),
    queryFn: () => fetchPlanDashboard(user!.id, planDate),
    enabled: !!user?.id,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const planBlocks = planData?.planBlocks ?? [];
  const hasPlanForDate = planData?.hasPlanForDate ?? false;
  const planSummary = planData?.planSummary ?? null;
  const [calmMode] = useCalmMode();
  const [energyState, setEnergyState] = useState<EnergyState>(() => readEnergyState());
  const [rescueMode, setRescueMode] = useState<RescueMode>("stabilize");
  const [rescueRationale, setRescueRationale] = useState<string>("");
  const [tipDismissed, setTipDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TODAY_TIP_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [nowHM, setNowHM] = useState(() => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
  });
  const [intentTick, setIntentTick] = useState(0);
  const weekIntention = useMemo(() => getWeekIntention(), [intentTick]);
  const hourNow = new Date().getHours();
  const openUpgrade = (reason: "quota" | "feature" | "trial-banner" | "momentum") => {
    setUpgradeReason(reason);
    setUpgradeOpen(true);
  };

  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date();
      setNowHM(`${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`);
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    writeEnergyState(energyState);
  }, [energyState]);
  useEffect(() => {
    try {
      localStorage.setItem(TODAY_TIP_DISMISSED_KEY, tipDismissed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [tipDismissed]);

  useEffect(() => {
    const h = () => setIntentTick((x) => x + 1);
    window.addEventListener("dd-week-intent", h);
    return () => window.removeEventListener("dd-week-intent", h);
  }, []);

  const qsDate = searchParams.get("date");
  useEffect(() => {
    if (qsDate && /^\d{4}-\d{2}-\d{2}$/.test(qsDate)) setPlanDate(qsDate);
  }, [qsDate]);

  const composerBailHandled = useRef(false);
  useEffect(() => {
    if (searchParams.get("composer") !== "1") {
      composerBailHandled.current = false;
      return;
    }
    if (composerBailHandled.current) return;
    composerBailHandled.current = true;
    const dRaw = searchParams.get("date");
    const d =
      dRaw && /^\d{4}-\d{2}-\d{2}$/.test(dRaw)
        ? dRaw
        : sessionStorage.getItem("dd_planning_plan_date") || todayDateStr();
    setPlanDate(d);
    const fromSess = sessionStorage.getItem("dd_planning_input") || "";
    const fromDraft = readComposerDraft(d);
    setInput(fromSess || fromDraft || "");
    setComposerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("composer");
    setSearchParams(next, { replace: true });
    toast("Draft restored. Review and generate when ready.");
  }, [searchParams, setSearchParams]);

  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      writeComposerDraft(planDate, input);
    }, 450);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [input, planDate, user?.id]);

  useEffect(() => {
    if (!composerOpen) return;
    if (input.trim()) return;
    const d = readComposerDraft(planDate);
    if (d) setInput(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only hydrate empty composer on open
  }, [composerOpen, planDate]);

  useEffect(() => {
    if (!user) return;
    supabase.from("block_templates").select("id, name, raw_input").eq("user_id", user.id).order("created_at", { ascending: false })
      .then(({ data }) => setTemplates((data || []) as any));
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: caps } = await supabase.from("quick_captures").select("*").eq("user_id", user.id).eq("consumed", false);
      if (!caps || !caps.length) { setPendingCaptureIds([]); return; }
      const matching = caps.filter((c: any) => {
        const content: string = c.content || "";
        const forMatch = content.match(/^\[for:(\d{4}-\d{2}-\d{2})\]\s*/);
        if (forMatch) return forMatch[1] === planDate;
        return planDate === todayDateStr();
      });
      if (!matching.length) { setPendingCaptureIds([]); return; }
      const block = matching.map((c: any) => (c.content || "")
        .replace(/^\[today\]\s*/, "")
        .replace(/^\[for:\d{4}-\d{2}-\d{2}\]\s*/, "")
      ).join("\n");
      setInput(prev => prev ? block + "\n" + prev : block);
      setComposerOpen(true);
      setPendingCaptureIds(matching.map((c: any) => c.id));
      toast(`Imported ${matching.length} item${matching.length === 1 ? "" : "s"} from Capture`);
    })();
  }, [user?.id, planDate]);

  useEffect(() => {
    if (!profile?.onboarded) return;
    if (profile.tour_seen && (profile.tour_seen as any).today) return;
    const t = setTimeout(() => tour.start(TOUR_TODAY), 800);
    return () => clearTimeout(t);
  }, [profile?.onboarded, profile?.tour_seen]);

  const useYesterday = async (): Promise<boolean> => {
    if (!user) return false;
    const { data } = await supabase
      .from("plans")
      .select("raw_input")
      .eq("user_id", user.id)
      .lt("date", planDate)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const raw = (data?.raw_input || "")
      .split(/\r?\n/)
      .map(line => line.replace(/^\[(today|for:\d{4}-\d{2}-\d{2})\]\s*/i, "").trim())
      .filter(Boolean)
      .join("\n");
    if (raw) {
      setInput(raw);
      setComposerOpen(true);
      toast.success("Loaded previous tasks");
      return true;
    }
    return false;
  };

  const carryOverUnfinished = async (): Promise<boolean> => {
    if (!user) return false;
    const { data: prevPlan } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", user.id)
      .lt("date", planDate)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!prevPlan?.id) {
      toast("No previous plan available");
      return false;
    }
    const { data: bs } = await supabase
      .from("blocks")
      .select("title, kind, completed, is_calendar_event")
      .eq("plan_id", prevPlan.id)
      .eq("kind", "task")
      .eq("completed", false);
    const titles = (bs || [])
      .filter((b: { is_calendar_event?: boolean }) => !b.is_calendar_event)
      .map((b: { title: string }) => (b.title || "").trim())
      .filter(Boolean);
    if (!titles.length) {
      toast("No unfinished tasks found in your last plan");
      return false;
    }
    const block = titles.join("\n");
    setInput((prev) => (prev ? `${prev}\n${block}` : block));
    setComposerOpen(true);
    haptics.selection();
    toast.success(`Added ${titles.length} open task${titles.length === 1 ? "" : "s"} — tweak times, then generate`);
    return true;
  };

  const reusePreviousPlan = async () => {
    const carried = await carryOverUnfinished();
    if (carried) return;
    const loaded = await useYesterday();
    if (!loaded) toast("No reusable tasks found in previous plans");
  };

  const rescueMyDay = () => {
    if (!hasPlanForDate || !planBlocks.length) return;
    const rescue = rescuePlanFromBlocks(planBlocks as Block[], {
      nowHHMM: nowHM,
      activeHoursEnd: (profile as any)?.active_hours_end || "22:00",
      energyState,
      mode: rescueMode,
    });
    const rescueInput = rescue.input;
    if (!rescueInput.trim()) {
      toast("No rescue needed. Your plan is already clear.");
      return;
    }
    setInput(rescueInput);
    setRescueRationale(rescue.rationale);
    setComposerOpen(true);
    haptics.impact("light");
    toast.success(`Rescue ready · ${rescue.selectedCount} priorities · ${rescue.budgetMin}m window`);
  };

  const recalculateRescue = () => {
    if (!hasPlanForDate || !planBlocks.length) return;
    const rescue = rescuePlanFromBlocks(planBlocks as Block[], {
      nowHHMM: nowHM,
      activeHoursEnd: (profile as any)?.active_hours_end || "22:00",
      energyState,
      mode: rescueMode,
    });
    if (!rescue.input.trim()) {
      toast("No rescue suggestions available right now.");
      return;
    }
    setInput(rescue.input);
    setRescueRationale(rescue.rationale);
    toast.success("Rescue recalculated");
  };

  const saveAsTemplate = async () => {
    if (!user || !input.trim()) { toast.error("Add tasks first"); return; }
    const name = prompt("Template name", "My standard day");
    if (!name) return;
    const { data, error } = await supabase.from("block_templates").insert({
      user_id: user.id, name, raw_input: input,
    } as any).select().single();
    if (error) { toast.error(error.message); return; }
    setTemplates(t => [data as any, ...t]);
    toast.success("Template saved");
  };

  const applyTemplate = (t: { raw_input: string; name: string }) => {
    setInput(t.raw_input);
    setComposerOpen(true);
    haptics.selection();
    toast.success(`Loaded "${t.name}"`);
  };

  const voice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Voice input not supported in this browser"); return; }
    const r = new SR(); r.lang = "en-US"; r.interimResults = false;
    r.onresult = (e: any) => { setInput(prev => prev + (prev ? "\n" : "") + e.results[0][0].transcript); setComposerOpen(true); };
    r.onerror = () => toast.error("Voice capture failed");
    r.start();
    toast("Listening...");
  };

  const openClarify = async () => {
    if (!input.trim()) { toast.error("Add at least one task"); return; }
    if (!user || !profile) return;
    try {
      const since = new Date();
      since.setDate(since.getDate() - 6);
      const { data: q } = await supabase.functions.invoke("check-plan-quota", {
        body: { since_date: dateStr(since) },
      });
      if (q && q.allowed === false) {
        setUpgradeReason("quota");
        setUpgradeOpen(true);
        return;
      }
    } catch {/* fail open */}
    setClarifyOpen(true);
  };

  const plan = async (clarified: ClarifiedTask[]) => {
    if (!user || !profile) return;
    haptics.impact("medium");
    setClarifyOpen(false);
    setBusy(true);
    sessionStorage.setItem("dd_planning_input", input);
    sessionStorage.setItem("dd_planning_plan_date", planDate);
    nav("/today/planning");
    try {
      const startedAt = Date.now();
      let hoursAlreadyCommitted = 0;
      let behaviorSignals: { completion_rate_14d?: number; avg_completed_task_min_14d?: number; tracking_coverage_7d?: number } = {};
      let completedMin14 = 0;
      try {
        if (planDate === todayDateStr()) {
          const { data: existingPlan } = await supabase
            .from("plans").select("id").eq("user_id", user.id).eq("date", planDate).maybeSingle();
          if (existingPlan?.id) {
            const { data: completed } = await supabase
              .from("blocks").select("duration_min")
              .eq("plan_id", existingPlan.id).eq("kind", "task").eq("completed", true);
            const min = (completed || []).reduce((s: number, b: any) => s + (b.duration_min || 0), 0);
            hoursAlreadyCommitted = min / 60;
          }
        }
        const since14 = new Date();
        since14.setDate(since14.getDate() - 13);
        const { data: recentPlans } = await supabase
          .from("plans")
          .select("id,date")
          .eq("user_id", user.id)
          .gte("date", dateStr(since14));
        const recentPlanIds = (recentPlans || []).map((p: any) => p.id).filter(Boolean);
        if (recentPlanIds.length) {
          const { data: recentBlocks } = await supabase
            .from("blocks")
            .select("plan_id,duration_min,kind,completed,is_calendar_event")
            .in("plan_id", recentPlanIds);
          const userBlocks = (recentBlocks || []).filter((b: any) => b.kind === "task" && !b.is_calendar_event);
          const completed = userBlocks.filter((b: any) => b.completed);
          const completedMin = completed.reduce((sum: number, b: any) => sum + (b.duration_min || 0), 0);
          completedMin14 = completedMin;
          const plannedMin = userBlocks.reduce((sum: number, b: any) => sum + (b.duration_min || 0), 0);
          behaviorSignals.completion_rate_14d = plannedMin > 0 ? completedMin / plannedMin : 0;
          behaviorSignals.avg_completed_task_min_14d = completed.length > 0 ? completedMin / completed.length : 0;
        }
        const since7 = new Date();
        since7.setDate(since7.getDate() - 6);
        const { data: entries } = await supabase
          .from("time_entries")
          .select("started_at,ended_at")
          .eq("user_id", user.id)
          .gte("started_at", since7.toISOString());
        const trackedSec = (entries || []).reduce((sum: number, row: any) => {
          const s = new Date(row.started_at).getTime();
          const e = row.ended_at ? new Date(row.ended_at).getTime() : Date.now();
          return sum + Math.max(0, (e - s) / 1000);
        }, 0);
        if (trackedSec > 0 && completedMin14 > 0) {
          behaviorSignals.tracking_coverage_7d = Math.min(1.5, trackedSec / (completedMin14 * 60));
        }
      } catch {/* non-fatal */}
      const { data, error } = await supabase.functions.invoke("generate-plan", {
        body: {
          raw_input: input,
          energy_preference: profile.energy_preference,
          energy_state: energyState,
          name: profile.display_name,
          clarified_tasks: clarified,
          plan_date: planDate,
          now_iso: new Date().toISOString(),
          timezone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          hours_already_committed: hoursAlreadyCommitted,
          active_hours_start: (profile as any).active_hours_start || "09:00",
          active_hours_end: (profile as any).active_hours_end || "22:00",
          ai_tone: (profile as any).ai_tone || "professional",
          ai_tone_custom: (profile as any).ai_tone_custom || null,
          behavior_signals: behaviorSignals,
        },
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed));
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { data: planRow, error: planErr } = await supabase.from("plans").upsert({
        user_id: user.id, date: planDate, raw_input: input, ai_summary: data.summary, ai_subtext: data.subtext,
      }, { onConflict: "user_id,date" }).select().single();
      if (planErr) throw planErr;

      await supabase.from("blocks").delete().eq("plan_id", planRow.id);
      const blocks = (data.blocks || []).map((b: any, i: number) => ({
        plan_id: planRow.id, user_id: user.id,
        start_time: b.start_time, duration_min: b.duration_min, title: b.title,
        type: b.type, kind: b.kind, position: i,
        ai_reasoning: b.reasoning ?? null,
        location: b.location ?? null,
        location_lat: b.location_lat ?? null,
        location_lng: b.location_lng ?? null,
      }));
      if (!blocks.length) {
        await supabase.from("plans").delete().eq("id", planRow.id);
        throw new Error("No schedule was generated — try fewer tasks or simpler wording.");
      }
      await supabase.from("blocks").insert(blocks);
      if (pendingCaptureIds.length) {
        try {
          await supabase.from("quick_captures").update({ consumed: true } as any)
            .in("id", pendingCaptureIds);
        } catch {/* ignore */}
        setPendingCaptureIds([]);
      }
      try {
        const trackTitles = clarified
          .filter(t => t.track_time)
          .map(t => t.title.trim().toLowerCase());
        localStorage.setItem(
          `dd_track_titles_${planRow.id}`,
          JSON.stringify(trackTitles),
        );
      } catch {/* ignore */}
      clearComposerDraft(planDate);
      sessionStorage.removeItem("dd_planning_input");
      sessionStorage.removeItem("dd_planning_plan_date");
      void queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, planDate) });
      nav(planDate === todayDateStr() ? "/today/plan" : `/today/plan?date=${planDate}`);
    } catch (e: any) {
      toast.error(e.message || "Planning failed");
      nav(planDate === todayDateStr() ? "/today" : `/today?date=${planDate}`);
    } finally { setBusy(false); }
  };

  const showTrialBanner = entitlement?.tier === "trial" && (entitlement.daysLeftInTrial ?? 99) <= 3;

  // Derive a glanceable plan summary
  const planStats = useMemo(() => {
    const tasks = planBlocks.filter(isUserTask);
    const done = tasks.filter(b => b.completed).length;
    const totalMin = tasks.reduce((s, b) => s + b.duration_min, 0);
    return { tasks, done, total: tasks.length, hours: Math.round(totalMin / 6) / 10 };
  }, [planBlocks]);

  const isToday = planDate === todayDateStr();
  const dayShapeLine = useMemo(() => {
    if (!hasPlanForDate || !isToday || planBlocks.length === 0) return null;
    return dayShapeHint(planBlocks);
  }, [hasPlanForDate, isToday, planBlocks]);
  const tone = getTone(profile as any);

  return (
    <Shell>
      <PullToRefresh
        onRefresh={async () => {
          if (!user) return;
          await queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, planDate) });
        }}
      >
      <div className="px-5 pt-9">
        {/* ── Header ─────────────────────────── */}
        <div className="hero-glass p-5 md:p-6 shadow-elevated">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="kicker">{friendlyDate()}</p>
              <h1 className="font-display text-[31px] font-semibold leading-[1.05] mt-2 truncate text-balance">
              {greetingFor(tone, profile?.display_name)}
              </h1>
              {!profile?.onboarded ? (
                <p className="text-[12.5px] text-secondary-fg leading-relaxed mt-2.5">
                  Bottom bar: <span className="text-subtle">Today</span> · <span className="text-subtle">Timer</span> ·{" "}
                  <span className="text-subtle">History</span> · <span className="text-subtle">Settings</span>
                </p>
              ) : hasPlanForDate && planDate === todayDateStr() ? (
                <p className="text-[12.5px] text-secondary-fg leading-relaxed mt-2.5">
                  <span className="text-subtle">Next up</span> jumps into Focus; open the plan card to tick tasks off.
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-start gap-1.5">
              <ProBadge />
            </div>
          </div>
          <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-border/80 to-transparent" />
          <div className="mt-3 text-[11px] text-secondary-fg uppercase tracking-[0.08em]">
            {hasPlanForDate ? "Plan ready" : "No plan yet"} · {isToday ? "Today" : friendlyDateFor(parseDateStr(planDate))}
          </div>
        </div>

        {profile?.onboarded && !hasPlanForDate && planDate === todayDateStr() && !tipDismissed && (
          <div className="mt-5">
            <BeginnerTip onDismiss={() => setTipDismissed(true)}>
              <strong className="text-foreground font-medium">How it works:</strong> tap{" "}
              <strong className="text-foreground font-medium">Plan my day</strong>, write tasks in any format, then{" "}
              <strong className="text-foreground font-medium">Generate plan</strong>.{" "}
              The inbox button (top-right) saves quick notes for later. Need help?{" "}
              <strong className="text-foreground font-medium">Settings → Replay tutorial</strong>.
            </BeginnerTip>
          </div>
        )}

        {profile?.onboarded && planDate === todayDateStr() && (
          <div className="mt-5 space-y-3">
            {!calmMode && <TodayInsight />}
            {!calmMode && weekIntention && (
              <div className="flex items-start gap-3 rounded-[20px] border border-accent surface-accent backdrop-blur-sm px-4 py-3.5 shadow-card animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
                <Target className="h-4 w-4 text-primary shrink-0 mt-0.5" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-secondary-fg">This week&apos;s focus</div>
                  <p className="text-[13px] text-foreground mt-1 leading-snug">{weekIntention.text}</p>
                </div>
                <Link to="/settings#week-intention" className="text-[11px] font-medium text-primary shrink-0 pt-0.5 hover:underline">
                  Edit
                </Link>
              </div>
            )}
          </div>
        )}

        {profile?.onboarded && !calmMode && (
          <div className="mt-4 app-card p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider text-secondary-fg inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-primary" />Energy check-in</span>
              <span className="text-[11px] text-secondary-fg">Now {nowHM}</span>
            </div>
            <p className="mt-1 text-[11px] text-secondary-fg leading-relaxed">
              Used by AI to tune plan intensity: low = lighter blocks, high = harder work first.
            </p>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {([
                { key: "low" as EnergyState, label: "Low" },
                { key: "medium" as EnergyState, label: "Medium" },
                { key: "high" as EnergyState, label: "High" },
              ]).map((e) => (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => setEnergyState(e.key)}
                  className={`h-10 rounded-xl border text-[12px] font-medium pressable ${
                    energyState === e.key ? "surface-accent border-accent text-primary" : "surface-soft border-soft text-secondary-fg"
                  }`}
                >
                  {e.label}
                </button>
              ))}
            </div>
            {hourNow >= 18 && hasPlanForDate && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRescueMode("stabilize")}
                    className={`h-9 rounded-lg border text-[11px] font-medium pressable ${rescueMode === "stabilize" ? "surface-accent border-accent text-primary" : "surface-soft border-soft text-secondary-fg"}`}
                  >
                    Stabilize
                  </button>
                  <button
                    type="button"
                    onClick={() => setRescueMode("push")}
                    className={`h-9 rounded-lg border text-[11px] font-medium pressable ${rescueMode === "push" ? "surface-accent border-accent text-primary" : "surface-soft border-soft text-secondary-fg"}`}
                  >
                    Push
                  </button>
                </div>
                <button
                  type="button"
                  onClick={rescueMyDay}
                  className="w-full h-10 rounded-xl border border-soft surface-soft text-[12px] text-secondary-fg hover:text-foreground pressable inline-flex items-center justify-center gap-1.5"
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Rescue my day ({rescueMode})
                </button>
                {rescueRationale && (
                  <p className="text-[11px] text-secondary-fg leading-relaxed px-1">
                    {rescueRationale}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {profile?.onboarded && calmMode && (
          <div className="mt-4 rounded-xl border border-soft surface-soft px-3 py-2.5 text-[11px] text-secondary-fg flex items-center justify-between gap-2">
            <span>Calm Mode is on: insights, energy controls, and non-essential cards are hidden.</span>
            <button
              type="button"
              onClick={() => nav("/settings")}
              className="text-primary font-medium whitespace-nowrap"
            >
              Edit
            </button>
          </div>
        )}

        {/* ── Plan — primary surface when present ─ */}
        {hasPlanForDate ? (
          <div className="mt-7 space-y-4">
            {!calmMode && (
              <div className="grid grid-cols-3 gap-2.5 section-switch-stagger">
                <KpiCard
                  label="Done"
                  value={`${planStats.done}/${planStats.total}`}
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  tone="primary"
                />
                <KpiCard
                  label="Planned"
                  value={`${planStats.hours}h`}
                  icon={<Clock3 className="h-3.5 w-3.5" />}
                />
                <KpiCard
                  label="Status"
                  value={planStats.total > 0 && planStats.done === planStats.total ? "Done" : "Active"}
                  tone={planStats.total > 0 && planStats.done === planStats.total ? "success" : "neutral"}
                />
              </div>
            )}

            {isToday && (
              <NextUpCard
                blocks={planBlocks}
                nowHHMM={nowHM}
                onOpenPlan={() => nav("/today/plan")}
              />
            )}
            {!calmMode && dayShapeLine && (
              <p
                className="text-[11.5px] leading-snug text-subtle pl-1 border-l-2 border-primary/25 pl-3 py-0.5 animate-in fade-in duration-300"
                aria-live="polite"
              >
                {dayShapeLine}
              </p>
            )}

            <button
              data-tour="today-plan"
              onClick={() => nav(isToday ? "/today/plan" : `/today/plan?date=${planDate}`)}
              className="w-full text-left hero-glass p-5 pressable hover:border-primary/28 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <span className="kicker">{isToday ? "Timeline preview" : friendlyDateFor(parseDateStr(planDate))}</span>
                <span className="text-[11px] text-secondary-fg">Tap to open full editor</span>
              </div>

              {planSummary && (
                <p className="font-display text-[20px] leading-snug text-foreground mt-3">
                  {planSummary}
                </p>
              )}

              <div className="mt-4 space-y-2.5">
                {planStats.tasks.slice(0, 4).map(b => (
                  <div key={b.id} className="flex items-center gap-3 rounded-xl border border-soft surface-soft px-3 py-2">
                    <span className="text-[11px] text-secondary-fg font-mono-sf w-11 tabular-nums">{fmtTime(b.start_time)}</span>
                    <span className="w-1 h-5 rounded-full" style={{ background: typeColor(b.type) }} />
                    <span className={`text-[13.5px] flex-1 truncate ${b.completed ? "line-through text-secondary-fg" : "text-foreground"}`}>
                      {b.title}
                    </span>
                  </div>
                ))}
                {planStats.total > 4 && (
                  <div className="text-[11.5px] text-secondary-fg pl-1">+ {planStats.total - 4} more blocks</div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-[13px] text-primary inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                  Open plan editor <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </button>

            <button
              onClick={() => setComposerOpen(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 h-11 rounded-2xl text-[13px] text-secondary-fg hover:text-foreground border border-soft surface-soft pressable"
            >
              <Pencil className="h-3.5 w-3.5" /> Adjust plan
            </button>
          </div>
        ) : (
          /* ── Empty state — single question ── */
          <div className="mt-10 hero-glass p-5 shadow-elevated">
            <p className="font-display text-[22px] leading-snug text-foreground">
              {toneCopy(tone, "plan_cta") || "What's on your plate today?"}
            </p>
            <p className="text-[13.5px] text-secondary-fg mt-2 leading-relaxed">
              Brain-dump in any format. AI shapes it into a focused day.
            </p>
            <p className="text-[11.5px] text-secondary-fg mt-2">
              Next step: add 3-5 tasks, then tap Generate plan.
            </p>

            <Button
              onClick={() => setComposerOpen(true)}
              data-tour="today-plan"
              className="w-full mt-6 h-14 rounded-2xl bg-primary hover:bg-primary/92 text-primary-foreground text-[15.5px] font-semibold pressable shadow-elevated"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} /> Plan my day
            </Button>

            <button
              type="button"
              onClick={() => setComposerExtrasOpen((v) => !v)}
              className="mt-3 w-full h-10 rounded-xl border border-soft surface-soft text-[12px] text-secondary-fg hover:text-foreground pressable inline-flex items-center justify-center gap-1.5"
            >
              {composerExtrasOpen ? "Hide extra options" : "More options"}
            </button>
            {composerExtrasOpen && (
              <div className="mt-2.5 flex items-center gap-2">
                <button onClick={voice}
                  className="flex-1 h-11 rounded-xl border border-soft surface-soft text-[12.5px] text-secondary-fg hover:text-foreground pressable inline-flex items-center justify-center gap-1.5">
                  <Mic className="h-3.5 w-3.5" /> Speak
                </button>
                <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "flex-1 h-11 rounded-xl border text-[12.5px] font-medium pressable inline-flex items-center justify-center gap-1.5",
                        isToday
                          ? "surface-soft border-soft text-secondary-fg hover:text-foreground"
                          : "surface-accent border-accent text-primary"
                      )}
                    >
                      <CalendarDays className="h-3.5 w-3.5" />
                      {isToday ? "Today" : friendlyDateFor(parseDateStr(planDate))}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={parseDateStr(planDate)}
                      onSelect={(d) => { if (d) { setPlanDate(dateStr(d)); setDatePopoverOpen(false); } }}
                      disabled={(d) => { const today = new Date(); today.setHours(0,0,0,0); return d < today; }}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                <button
                  onClick={() => setMoreOpen(true)}
                  className="h-11 w-11 rounded-xl border border-soft surface-soft text-secondary-fg hover:text-foreground pressable inline-flex items-center justify-center"
                  aria-label="More"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Trial / quota whisper ─────────── */}
        {showTrialBanner && (
          <button onClick={() => openUpgrade("trial-banner")}
            className="mt-5 w-full flex items-center justify-between px-4 h-11 rounded-xl border border-accent surface-accent pressable">
            <span className="text-[12.5px] text-foreground">{entitlement!.daysLeftInTrial} days left in trial</span>
            <span className="text-[12px] font-semibold text-primary">Upgrade →</span>
          </button>
        )}
        {!isPro && planQuotaRemaining === 0 && !showTrialBanner && (
          <p className="mt-4 text-[11.5px] text-secondary-fg">
            Free plans for this week are used.{" "}
            <button onClick={() => openUpgrade("feature")}
              className="text-primary hover:underline">Go unlimited</button>
          </p>
        )}
        {!isPro && planQuotaRemaining > 0 && planQuotaRemaining <= 2 && !showTrialBanner && (
          <button
            type="button"
            onClick={() => openUpgrade("quota")}
            className="mt-4 w-full h-10 rounded-xl border border-soft surface-soft text-[12px] text-secondary-fg hover:text-foreground pressable inline-flex items-center justify-center gap-1.5"
          >
            {planQuotaRemaining} free planning day{planQuotaRemaining === 1 ? "" : "s"} left this week
            <span className="text-primary font-medium">Upgrade</span>
          </button>
        )}
        {!isPro && planQuotaUsed >= Math.min(3, Number.isFinite(planQuotaLimit) ? planQuotaLimit : 3) && !showTrialBanner && (
          <p className="mt-3 text-[11px] text-secondary-fg text-center">
            You are at {planQuotaUsed}/{Number.isFinite(planQuotaLimit) ? planQuotaLimit : "∞"} weekly free planning days.
          </p>
        )}
      </div>
      </PullToRefresh>

      {/* ─── Composer sheet — write tasks here ─── */}
      <Sheet open={composerOpen} onOpenChange={setComposerOpen}>
        <SheetContent side="bottom" className="rounded-t-[24px] border-soft bg-popover p-5 max-h-[88vh]">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="font-display text-[18px]">
              {hasPlanForDate ? "Add or re-plan" : (isToday ? "Plan today" : `Plan ${friendlyDateFor(parseDateStr(planDate))}`)}
            </SheetTitle>
            <SheetDescription className="text-left text-[13px] leading-relaxed text-secondary-fg pr-6">
              {hasPlanForDate
                ? "Append tasks below, then re-run planning. DayDraft will merge them into an updated schedule."
                : "List everything you hope to do — bullets, commas, shorthand, rough times. You'll confirm durations on the next step before the schedule is built."}
            </SheetDescription>
          </SheetHeader>
          {rescueRationale && (
            <div className="mb-3 rounded-xl border border-soft surface-soft px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-wider text-secondary-fg inline-flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 text-primary" />
                  Why these tasks
                </div>
                <button
                  type="button"
                  onClick={recalculateRescue}
                  className="h-7 px-2.5 rounded-md border border-soft surface-card text-[11px] text-secondary-fg hover:text-foreground pressable"
                >
                  Recalculate
                </button>
              </div>
              <p className="text-[12px] text-subtle leading-relaxed mt-1">
                {rescueRationale}
              </p>
            </div>
          )}
          <Textarea
            data-tour="today-input"
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={DEFAULT_PLACEHOLDER}
            className="min-h-[180px] bg-surface-elevated border-soft rounded-2xl p-4 text-[15px] leading-relaxed resize-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/40"
          />
          <div className="flex items-center gap-2 mt-3">
            <button onClick={voice}
              className="h-11 w-11 rounded-xl border border-soft surface-card text-secondary-fg pressable hover:text-foreground inline-flex items-center justify-center"
              aria-label="Voice"
            >
              <Mic className="h-3.5 w-3.5" />
            </button>
            <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
              <PopoverTrigger asChild>
                <button className={cn(
                  "h-11 px-3 rounded-xl border text-[12px] font-medium pressable inline-flex items-center gap-1.5",
                  isToday ? "border-soft surface-soft text-secondary-fg" : "border-accent surface-accent text-primary"
                )}>
                  <CalendarDays className="h-3.5 w-3.5" />
                  {isToday ? "Today" : friendlyDateFor(parseDateStr(planDate))}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={parseDateStr(planDate)}
                  onSelect={(d) => { if (d) { setPlanDate(dateStr(d)); setDatePopoverOpen(false); } }}
                  disabled={(d) => { const today = new Date(); today.setHours(0,0,0,0); return d < today; }}
                  initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <button onClick={() => setMoreOpen(true)}
              className="ml-auto h-11 w-11 rounded-xl border border-soft surface-card text-secondary-fg pressable hover:text-foreground inline-flex items-center justify-center">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
          <Button onClick={openClarify} disabled={busy}
            className="w-full mt-3 h-12 rounded-xl bg-primary hover:bg-primary/92 text-primary-foreground text-[15px] font-semibold pressable">
            {hasPlanForDate ? "Re-plan with these" : "Generate plan"} <ArrowRight className="h-4 w-4" />
          </Button>
        </SheetContent>
      </Sheet>

      {/* ── More sheet ─────────────────────── */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-[24px] border-soft bg-popover">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="font-display text-[18px]">Quick actions</SheetTitle>
            <SheetDescription className="text-left text-[13px] text-secondary-fg">
              Reuse previous plans, templates, and quick capture inbox.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-1">
            <MoreRow onClick={() => { setMoreOpen(false); reusePreviousPlan(); }} icon={<ListChecks className="h-4 w-4" />} label="Reuse previous plan tasks" />
            {hourNow >= 18 && hasPlanForDate && (
              <MoreRow onClick={() => { setMoreOpen(false); rescueMyDay(); }} icon={<ShieldAlert className="h-4 w-4" />} label="Rescue my day" />
            )}
            <MoreRow onClick={() => { setMoreOpen(false); saveAsTemplate(); }} icon={<Bookmark className="h-4 w-4" />} label="Save current as template" />
            {templates.length > 0 && (
              <div className="pt-2 mt-2 border-t border-soft">
                <div className="px-3 py-1.5 eyebrow">Templates</div>
                {templates.map(t => (
                  <MoreRow key={t.id} onClick={() => { setMoreOpen(false); applyTemplate(t); }} icon={<Bookmark className="h-4 w-4" />} label={t.name} />
                ))}
              </div>
            )}
            <MoreRow
              onClick={() => {
                setMoreOpen(false);
                window.dispatchEvent(new Event("dd-open-quick-capture"));
              }}
              icon={<Inbox className="h-4 w-4" />}
              label="Open capture inbox"
            />
          </div>
        </SheetContent>
      </Sheet>

      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason={upgradeReason} />
      <ClarifySheet open={clarifyOpen} onOpenChange={setClarifyOpen} rawInput={input} onConfirm={plan} planDate={planDate} />
    </Shell>
  );
}

const MoreRow = ({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) => (
  <button onClick={onClick}
    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl pressable hover:bg-surface-elevated text-[14px] text-foreground"
  >
    <span className="text-secondary-fg">{icon}</span>
    <span className="flex-1 text-left">{label}</span>
  </button>
);
