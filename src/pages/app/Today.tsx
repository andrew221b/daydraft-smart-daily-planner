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
  todayDateStr,
  dateStr,
  parseDateStr,
  friendlyDateFor,
  Block,
  isUserTask,
  isOpenUserTask,
  isUserTaskDone,
  inferScheduleBlockType,
  blockSlotEndHHMM,
  wallMsOnPlanDay,
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
  ListChecks,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { ClarifySheet, ClarifiedTask } from "@/components/app/ClarifySheet";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { haptics } from "@/lib/haptics";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NextUpCard } from "@/components/app/NextUpCard";
import { readComposerDraft, writeComposerDraft, clearComposerDraft } from "@/lib/composerDraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
import { usePlannedDates } from "@/hooks/usePlannedDates";
import { readAiWeeklyMemory, trackAiEvent } from "@/lib/aiRuntime";

const DEFAULT_PLACEHOLDER =
  "Brain-dump your day…\nfinish deck · gym 45m · call mom 15m · ship invoice";
const DEBRIEF_DISMISSED_PREFIX = "dd_yesterday_debrief_dismissed_";

export default function Today() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isPro, planQuotaRemaining } = useEntitlement();
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
  const { data: plannedDates = new Set<string>() } = usePlannedDates(user?.id);

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
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [debriefExpanded, setDebriefExpanded] = useState(false);
  const [debriefTitle, setDebriefTitle] = useState("Yesterday's debrief");
  const [debriefBullets, setDebriefBullets] = useState<string[]>([]);
  const debriefSwipeStartX = useRef(0);
  const [nowHM, setNowHM] = useState(() => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
  });
  const toMin = (hhmm: string) => {
    const [h, m] = String(hhmm || "").split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
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
    if (!user || !profile || planDate !== todayDateStr() || !isPro) {
      setDebriefOpen(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const dismissKey = `${DEBRIEF_DISMISSED_PREFIX}${todayDateStr()}`;
      try {
        if (localStorage.getItem(dismissKey) === "1") return;
      } catch {
        // ignore
      }
      try {
        const { data, error } = await supabase.functions.invoke("yesterday-debrief", {
          body: {
            timezone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
            now_iso: new Date().toISOString(),
          },
        });
        if (cancelled || error || !data?.show) return;
        const bullets = Array.isArray(data?.bullets) ? data.bullets.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 3) : [];
        if (!bullets.length) return;
        setDebriefTitle(String(data?.title || "Yesterday's debrief"));
        setDebriefBullets(bullets);
        setDebriefOpen(true);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPro, planDate, profile, user]);

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
    if (busy) return;
    if (!input.trim()) { toast.error("Add at least one task"); return; }
    if (!user || !profile) return;
    if (!isPro) {
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
    }
    setClarifyOpen(true);
  };

  const plan = async (clarified: ClarifiedTask[], planningContext?: string) => {
    if (busy) return;
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
      let behaviorSignals: {
        completion_rate_14d?: number;
        avg_completed_task_min_14d?: number;
        tracking_coverage_7d?: number;
        closure_punctuality_7d?: number;
        skip_or_miss_rate_7d?: number;
      } = {};
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
        const since7d = new Date();
        since7d.setDate(since7d.getDate() - 6);
        const { data: plans7 } = await supabase
          .from("plans")
          .select("id,date")
          .eq("user_id", user.id)
          .gte("date", dateStr(since7d));
        const planDateById = new Map<string, string>((plans7 || []).map((p: any) => [p.id as string, p.date as string]));
        const ids7 = [...planDateById.keys()];
        if (ids7.length) {
          const { data: b7 } = await supabase
            .from("blocks")
            .select("plan_id,kind,is_calendar_event,completed,resolution,completed_at,start_time,duration_min,slot_end_time")
            .in("plan_id", ids7);
          const tasks7 = (b7 || []).filter((b: any) => b.kind === "task" && !b.is_calendar_event);
          if (tasks7.length) {
            const skipped = tasks7.filter((b: any) => b.resolution === "skipped").length;
            const missed = tasks7.filter((b: any) => b.resolution === "missed").length;
            behaviorSignals.skip_or_miss_rate_7d = (skipped + missed) / tasks7.length;
            const doneTasks = tasks7.filter(
              (b: any) => b.resolution === "done" || (b.completed && !b.resolution),
            );
            if (doneTasks.length) {
              let early = 0;
              for (const b of doneTasks) {
                const pd = planDateById.get(b.plan_id);
                const at = b.completed_at ? new Date(String(b.completed_at)).getTime() : 0;
                if (!pd || !at) continue;
                const endMs = wallMsOnPlanDay(pd, blockSlotEndHHMM(b as Block));
                if (at <= endMs + 120_000) early += 1;
              }
              behaviorSignals.closure_punctuality_7d = early / doneTasks.length;
            }
          }
        }
      } catch {/* non-fatal */}
      const { data, error } = await supabase.functions.invoke("generate-plan", {
        body: {
          raw_input: input,
          energy_preference: profile.energy_preference,
          name: profile.display_name,
          clarified_tasks: clarified,
          planning_context: planningContext?.trim() || null,
          plan_date: planDate,
          now_iso: new Date().toISOString(),
          timezone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          hours_already_committed: hoursAlreadyCommitted,
          active_hours_start: (profile as any).active_hours_start || "09:00",
          active_hours_end: (profile as any).active_hours_end || "22:00",
          ai_tone: (profile as any).ai_tone || "professional",
          ai_tone_custom: (profile as any).ai_tone_custom || null,
          ai_planning_rules: (profile as any).ai_planning_rules || "",
          behavior_signals: behaviorSignals,
          ai_memory: readAiWeeklyMemory(),
        },
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed < 120) await new Promise((r) => setTimeout(r, 120 - elapsed));
      if (error) throw error;
      if (data?.code === "INCOMPLETE_TASKS_NEED_CLARIFICATION") {
        if (typeof data?.suggested_raw_input === "string" && data.suggested_raw_input.trim()) {
          setInput(data.suggested_raw_input);
        }
        setComposerOpen(true);
        throw new Error(data.error || "Please clarify incomplete tasks before generating a plan.");
      }
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
        estimated_minutes: b.duration_min,
        actual_minutes: null,
        block_type: inferScheduleBlockType(b),
        ai_reasoning: b.reasoning ?? null,
        location: b.location ?? null,
        location_lat: b.location_lat ?? null,
        location_lng: b.location_lng ?? null,
        overlap_ok: Boolean(b.overlap_ok),
        parallel_group_id: typeof b.parallel_group_id === "string" && b.parallel_group_id ? b.parallel_group_id : null,
        slot_end_time: blockSlotEndHHMM({
          start_time: b.start_time,
          duration_min: b.duration_min,
          slot_end_time: b.slot_end_time ?? null,
        } as any),
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
      clearComposerDraft(planDate);
      sessionStorage.removeItem("dd_planning_input");
      sessionStorage.removeItem("dd_planning_plan_date");
      void queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, planDate) });
      void queryClient.invalidateQueries({ queryKey: ["plan-dates-markers", user.id] });
      nav(planDate === todayDateStr() ? "/today/plan" : `/today/plan?date=${planDate}`);
    } catch (e: any) {
      toast.error(e.message || "Planning failed");
      nav(planDate === todayDateStr() ? "/today" : `/today?date=${planDate}`);
    } finally { setBusy(false); }
  };

  // Derive a glanceable plan summary
  const planStats = useMemo(() => {
    const tasks = planBlocks.filter(isUserTask);
    const done = tasks.filter((b) => isUserTaskDone(b)).length;
    const totalMin = tasks.reduce((s, b) => s + b.duration_min, 0);
    return { tasks, done, total: tasks.length, hours: Math.round(totalMin / 6) / 10 };
  }, [planBlocks]);
  const remainingMin = useMemo(
    () => planStats.tasks.filter((b) => isOpenUserTask(b)).reduce((s, b) => s + (b.duration_min || 0), 0),
    [planStats.tasks],
  );
  const progressPct = planStats.total > 0 ? Math.round((planStats.done / planStats.total) * 100) : 0;
  const remainingLabel = useMemo(() => {
    const h = Math.floor(remainingMin / 60);
    const m = remainingMin % 60;
    return `${h}h ${m}m`;
  }, [remainingMin]);

  const isToday = planDate === todayDateStr();
  const tone = getTone(profile as any);

  return (
    <Shell>
      <PullToRefresh
        onRefresh={async () => {
          if (!user) return;
          await queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, planDate) });
          await queryClient.invalidateQueries({ queryKey: ["plan-dates-markers", user.id] });
        }}
      >
      <div className="px-6 pt-14 pb-12 space-y-10">
        {/* ── Header ─────────────────────────── */}
        <header className="space-y-4">
          <div className="space-y-2 min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-secondary-fg/70">
              {isToday ? "Today · planner" : friendlyDateFor(parseDateStr(planDate))}
            </p>
            <h1 className="font-display text-[28px] font-medium tracking-[-0.02em] text-foreground/95 text-balance leading-[1.15] break-words pr-1">
              {greetingFor(tone, profile?.display_name)}
            </h1>
            {!profile?.onboarded ? (
              <p className="text-[13px] text-secondary-fg/85 leading-relaxed pt-0.5 max-w-md">
                Use <span className="text-foreground/75">Home</span> for time and glance, <span className="text-foreground/75">Today</span> on the bar for this planner,{" "}
                <span className="text-foreground/75">History</span> for past days, <span className="text-foreground/75">Settings</span> for your account.
              </p>
            ) : hasPlanForDate && planDate === todayDateStr() ? (
              <p className="text-[13px] text-secondary-fg/85 leading-relaxed pt-0.5 max-w-md">
                Next step is obvious: timeline, focus on one block, or adjust wording.
              </p>
            ) : hasPlanForDate && !isToday ? (
              <p className="text-[13px] text-secondary-fg/85 leading-relaxed pt-0.5 max-w-md">
                You&apos;re viewing another day. Use the date control to return to today, or scroll to edit this plan.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {!(hasPlanForDate && isToday) ? (
            <p className="text-[12px] text-secondary-fg/75 leading-snug">
              {hasPlanForDate
                ? `Plan for ${friendlyDateFor(parseDateStr(planDate))}.`
                : isToday
                  ? "No schedule yet — brain-dump below, then generate."
                  : `No plan for ${friendlyDateFor(parseDateStr(planDate))} yet.`}
            </p>
            ) : (
              <span className="sr-only">Plan ready</span>
            )}
            {!isToday && (
              <button
                type="button"
                onClick={() => {
                  setPlanDate(todayDateStr());
                  setSearchParams((prev) => {
                    const n = new URLSearchParams(prev);
                    n.delete("date");
                    return n;
                  });
                }}
                className="text-[12px] font-medium text-primary/90 pressable whitespace-nowrap shrink-0"
              >
                Back to today
              </button>
            )}
          </div>
        </header>
        {hasPlanForDate && !isToday && (
          <div className="rounded-[22px] border border-border/45 bg-background/30 backdrop-blur-[2px] px-4 py-3.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-secondary-fg/65">That day</p>
            <p className="text-[13px] text-foreground/90 mt-1.5 tabular-nums">
              {planStats.done} of {planStats.total} completed
            </p>
          </div>
        )}
        {isPro && debriefOpen && (
          <div
            className="rounded-[22px] border border-border/45 bg-background/30 backdrop-blur-[2px] px-4 py-5"
            onTouchStart={(e) => {
              debriefSwipeStartX.current = e.changedTouches[0]?.clientX || 0;
            }}
            onTouchEnd={(e) => {
              const endX = e.changedTouches[0]?.clientX || 0;
              if (Math.abs(endX - debriefSwipeStartX.current) < 72) return;
              setDebriefOpen(false);
              try {
                localStorage.setItem(`${DEBRIEF_DISMISSED_PREFIX}${todayDateStr()}`, "1");
              } catch {
                // ignore
              }
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="flex-1 text-left inline-flex items-center gap-2 text-[13px] font-medium text-foreground"
                onClick={() => setDebriefExpanded((v) => !v)}
              >
                {debriefExpanded ? <ChevronUp className="h-4 w-4 text-secondary-fg" /> : <ChevronDown className="h-4 w-4 text-secondary-fg" />}
                {debriefTitle}
              </button>
              <button
                type="button"
                className="text-[11px] text-secondary-fg hover:text-foreground"
                onClick={() => {
                  setDebriefOpen(false);
                  try {
                    localStorage.setItem(`${DEBRIEF_DISMISSED_PREFIX}${todayDateStr()}`, "1");
                  } catch {
                    // ignore
                  }
                }}
              >
                Dismiss
              </button>
            </div>
            {debriefExpanded && (
              <ul className="mt-2.5 px-4 list-disc text-[12px] text-secondary-fg space-y-1.5">
                {debriefBullets.map((line, idx) => (
                  <li key={`${line}-${idx}`}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {/* ── Plan — primary surface when present ─ */}
        {hasPlanForDate ? (
          <section className="space-y-5">
            <div
              data-tour="today-plan"
              className="overflow-hidden rounded-[22px] border border-border/45 bg-background/30 backdrop-blur-[2px]"
            >
              {isToday && planStats.total > 0 && (
                <div className="border-b border-border/35 px-4 py-3">
                  <div className="flex items-center justify-between text-[13px] font-semibold text-secondary-fg/88">
                    <span className="tabular-nums">
                      {planStats.done}/{planStats.total} done · {remainingLabel} left
                    </span>
                    <span className="tabular-nums text-foreground/90">{progressPct}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-muted/55 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/88"
                      style={{
                        width: `${progressPct}%`,
                        transition: "width 420ms cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                    />
                  </div>
                </div>
              )}
              {planSummary ? (
                <p className="px-4 pt-4 font-display text-[19px] font-semibold leading-snug tracking-[-0.02em] text-foreground/95">
                  {planSummary}
                </p>
              ) : null}
              {isToday && (
                <div className="p-1 pt-2">
                  <NextUpCard
                    blocks={planBlocks}
                    nowHHMM={nowHM}
                    onOpenPlan={() => nav("/today/plan")}
                  />
                </div>
              )}
              {!isToday && (
                <button
                  type="button"
                  onClick={() => nav(`/today/plan?date=${planDate}`)}
                  className="flex w-full items-center justify-between px-4 py-4 text-left pressable hover:bg-muted/25"
                >
                  <span className="font-display text-[17px] font-semibold text-foreground/95">
                    View timeline
                  </span>
                  <ArrowRight className="h-4 w-4 text-primary opacity-80" />
                </button>
              )}
              <div className="grid grid-cols-2 gap-2 border-t border-border/35 p-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-12 rounded-2xl text-[14px] font-semibold"
                  onClick={() => nav(isToday ? "/today/plan" : `/today/plan?date=${planDate}`)}
                >
                  Timeline
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-2xl border-border/45 text-[14px] font-semibold text-foreground/90"
                  onClick={() => setComposerOpen(true)}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5 opacity-80" /> Edit
                </Button>
              </div>
              <button
                onClick={() => setComposerOpen(true)}
                type="button"
                className="flex w-full items-center justify-center gap-2 border-t border-border/25 py-3 text-[12px] font-medium text-secondary-fg/90 hover:bg-muted/20 pressable"
              >
                Re-run AI with edited tasks →
              </button>
            </div>
          </section>
        ) : (
          /* ── Empty state — single question ── */
          <div className="rounded-[22px] border border-dashed border-border/50 bg-muted/[0.12] px-6 py-10 text-center">
            <p className="font-display text-[22px] font-medium tracking-[-0.02em] text-foreground/95 leading-snug">
              {toneCopy(tone, "plan_cta") || "What's on your plate today?"}
            </p>
            <p className="text-[13px] text-secondary-fg/85 mt-3 leading-relaxed max-w-[280px] mx-auto">
              Brain-dump in any format. AI shapes it into a focused day.
            </p>
            <p className="text-[12px] text-secondary-fg/65 mt-2">
              Add a few tasks, then generate.
            </p>

            <Button
              onClick={() => setComposerOpen(true)}
              data-tour="today-plan"
              className="w-full mt-8 h-14 rounded-2xl bg-primary hover:bg-primary/92 text-primary-foreground text-[15px] font-semibold pressable"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} /> Plan my day
            </Button>

            <button
              type="button"
              onClick={() => setComposerExtrasOpen((v) => !v)}
              className="mt-3 w-full h-11 rounded-2xl border border-border/40 text-[12px] font-medium text-secondary-fg/90 hover:bg-muted/30 pressable inline-flex items-center justify-center gap-1.5"
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
                      modifiers={{ hasPlan: (d: Date) => plannedDates.has(dateStr(d)) }}
                      modifiersClassNames={{
                        hasPlan: "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-primary",
                      }}
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

        {!isPro && (
          <button
            type="button"
            onClick={() => openUpgrade(planQuotaRemaining <= 2 ? "quota" : "momentum")}
            className={`w-full rounded-[22px] border pressable text-left px-4 py-3.5 transition-colors ${
              planQuotaRemaining <= 2 ? "border-primary/30 bg-primary/[0.05]" : "border-border/45 bg-background/25"
            }`}
          >
            <span className="text-[12px] text-secondary-fg">
              {planQuotaRemaining <= 2 ? `${planQuotaRemaining} free planning day(s) left — ` : `${planQuotaRemaining} free days · `}
            </span>
            <span className="text-[12px] font-semibold text-primary">DayDraft Pro →</span>
          </button>
        )}
      </div>
      </PullToRefresh>

      {/* ─── Composer sheet — write tasks here ─── */}
      <Sheet open={composerOpen} onOpenChange={setComposerOpen}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover p-5 max-h-[88vh]">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="font-display text-[18px]">
              {hasPlanForDate ? "Add or re-plan" : (isToday ? "Plan today" : `Plan ${friendlyDateFor(parseDateStr(planDate))}`)}
            </SheetTitle>
            <SheetDescription className="text-left text-[13px] leading-relaxed text-secondary-fg pr-6">
              {hasPlanForDate
                ? "Add tasks, then generate — AI merges into your day."
                : "Dump tasks in any format. Next step: quick review, then AI builds the timeline."}
            </SheetDescription>
          </SheetHeader>
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
                <Calendar
                  mode="single"
                  selected={parseDateStr(planDate)}
                  onSelect={(d) => { if (d) { setPlanDate(dateStr(d)); setDatePopoverOpen(false); } }}
                  modifiers={{ hasPlan: (d: Date) => plannedDates.has(dateStr(d)) }}
                  modifiersClassNames={{
                    hasPlan: "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-primary",
                  }}
                  disabled={(d) => { const today = new Date(); today.setHours(0,0,0,0); return d < today; }}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
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
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="font-display text-[18px]">Quick actions</SheetTitle>
            <SheetDescription className="text-left text-[13px] text-secondary-fg">
              Reuse previous plans, templates, and quick capture inbox.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-1">
            <MoreRow onClick={() => { setMoreOpen(false); reusePreviousPlan(); }} icon={<ListChecks className="h-4 w-4" />} label="Reuse previous plan tasks" />
            <MoreRow onClick={() => { setMoreOpen(false); saveAsTemplate(); }} icon={<Bookmark className="h-4 w-4" />} label="Save current as template" />
            {templates.length > 0 && (
              <div className="pt-2 mt-2 border-t border-soft">
                <div className="px-3 py-1.5 eyebrow">Templates</div>
                {templates.map(t => (
                  <MoreRow key={t.id} onClick={() => { setMoreOpen(false); applyTemplate(t); }} icon={<Bookmark className="h-4 w-4" />} label={t.name} />
                ))}
              </div>
            )}
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
