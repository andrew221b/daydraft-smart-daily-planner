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
  inferScheduleBlockType,
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
  Inbox,
  ShieldAlert,
  Info,
  ChevronDown,
  ChevronUp,
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
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { haptics } from "@/lib/haptics";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NextUpCard } from "@/components/app/NextUpCard";
import { readComposerDraft, writeComposerDraft, clearComposerDraft } from "@/lib/composerDraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
import { RescueMode } from "@/lib/productPolish";
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
  const [rescueMode, setRescueMode] = useState<RescueMode>("balanced");
  const [rescueRationale, setRescueRationale] = useState<string>("");
  const [rescueExplain, setRescueExplain] = useState<string[]>([]);
  const [rescueSheetOpen, setRescueSheetOpen] = useState(false);
  const [rescueLoading, setRescueLoading] = useState(false);
  const [rescuePendingBlocks, setRescuePendingBlocks] = useState<any[]>([]);
  const [rescueDiffRows, setRescueDiffRows] = useState<Array<{ title: string; before: string; after: string }>>([]);
  const [rescueDeferredRows, setRescueDeferredRows] = useState<Array<{ title: string; mins: number }>>([]);
  const [rescueWindowLabel, setRescueWindowLabel] = useState("");
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
  const fmtMin = (min: number) => {
    const safe = Math.max(0, Math.round(min));
    const h = Math.floor(safe / 60);
    const m = safe % 60;
    if (h <= 0) return `${m}m`;
    if (m <= 0) return `${h}h`;
    return `${h}h ${m}m`;
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

  const rescueMyDay = async (manual = true) => {
    if (!user || !profile || !hasPlanForDate || !planBlocks.length) return;
    const activeEnd = (profile as any)?.active_hours_end || "18:00";
    const nowMin = toMin(nowHM);
    const endMin = Math.max(nowMin + 30, toMin(activeEnd));
    const remaining = (planBlocks as Block[]).filter((b) => isUserTask(b) && !b.completed);
    if (!remaining.length) {
      toast("No remaining tasks to rescue.");
      return;
    }
    const occupiedMin = (planBlocks as Block[])
      .filter((b) => !b.completed && (b.is_calendar_event || b.kind === "lunch" || b.kind === "break"))
      .filter((b) => {
        const start = toMin(b.start_time);
        const end = start + (b.duration_min || 0);
        return end > nowMin && start < endMin;
      })
      .reduce((sum, b) => {
        const start = toMin(b.start_time);
        const end = start + (b.duration_min || 0);
        return sum + Math.max(0, Math.min(end, endMin) - Math.max(start, nowMin));
      }, 0);
    const budgetMin = Math.max(30, endMin - nowMin - occupiedMin);
    const scored = remaining
      .map((b) => {
        const base = b.type === "deep_work" ? 24 : b.type === "communication" ? 15 : 12;
        const overdueBoost = toMin(b.start_time) + (b.duration_min || 0) < nowMin ? 4 : 0;
        const sizePenalty = Math.max(0, (b.duration_min || 0) - 75) * 0.08;
        return { ...b, score: base + overdueBoost - sizePenalty };
      })
      .sort((a, b) => b.score - a.score);
    const selected: Array<{ id: string; title: string; mins: number }> = [];
    let used = 0;
    for (const task of scored) {
      const mins = Math.max(20, Math.min(90, task.duration_min || 30));
      if (used + mins > budgetMin && selected.length > 0) continue;
      selected.push({ id: task.id, title: task.title, mins });
      used += mins;
      if (used >= budgetMin || selected.length >= 4) break;
    }
    if (!selected.length) {
      toast("No rescue needed. Your plan is already realistic.");
      return;
    }
    const selectedIds = new Set(selected.map((s) => s.id));
    const deferred = remaining
      .filter((b) => !selectedIds.has(b.id))
      .map((b) => ({ title: b.title, mins: b.duration_min || 0 }));

    setRescueSheetOpen(true);
    setRescueLoading(true);
    setRescueWindowLabel(`${fmtMin(budgetMin)} left before ${activeEnd}`);
    setRescueDeferredRows(deferred);
    haptics.impact("light");
    try {
      const raw_input = selected.map((b) => `${b.title} (${b.mins}m)`).join("\n");
      const { data, error } = await supabase.functions.invoke("generate-plan", {
        body: {
          raw_input,
          planning_context:
            `Rescue mode: build a minimal aggressive plan from ${nowHM} to ${activeEnd}. ` +
            `Keep only highest-priority work that fits today and defer the rest.`,
          energy_preference: profile.energy_preference,
          name: profile.display_name,
          mode: "replan",
          start_time: nowHM,
          plan_date: planDate,
          now_iso: new Date().toISOString(),
          timezone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          active_hours_start: (profile as any).active_hours_start || "09:00",
          active_hours_end: activeEnd,
          ai_tone: (profile as any).ai_tone || "professional",
          ai_tone_custom: (profile as any).ai_tone_custom || null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const nextBlocks = (data?.blocks || []) as any[];
      const nextTasks = nextBlocks.filter((b: any) => b?.kind === "task");
      const oldRows = remaining.map((b) => ({ title: b.title, before: b.start_time }));
      const usedIdx = new Set<number>();
      const diff = oldRows.map((row) => {
        const exact = nextTasks.findIndex((n: any, i: number) => !usedIdx.has(i) && String(n.title || "").trim().toLowerCase() === row.title.trim().toLowerCase());
        const pick = exact >= 0 ? exact : nextTasks.findIndex((_: any, i: number) => !usedIdx.has(i));
        if (pick >= 0) usedIdx.add(pick);
        const after = pick >= 0 ? String(nextTasks[pick]?.start_time || row.before) : "Deferred";
        return { title: row.title, before: row.before, after };
      }).filter((r) => r.before !== r.after).slice(0, 10);
      setRescuePendingBlocks(nextBlocks);
      setRescueDiffRows(diff);
      setRescueRationale(`Rescue window: ${fmtMin(budgetMin)} before ${activeEnd}.`);
      setRescueExplain([
        `${selected.length} highest-priority tasks kept for today.`,
        `${deferred.length} lower-priority task${deferred.length === 1 ? "" : "s"} moved to deferred.`,
      ]);
      trackAiEvent("ai_rescue_opened", {
        mode: rescueMode,
        selected_count: selected.length,
        budget_min: budgetMin,
        manual,
        overdue_count: overdueCount,
      });
    } catch (e: any) {
      setRescueSheetOpen(false);
      toast.error(e?.message || "Unable to build rescue plan.");
    } finally {
      setRescueLoading(false);
    }
  };

  const recalculateRescue = () => {
    void rescueMyDay(true);
    trackAiEvent("ai_rescue_recalculated", { mode: rescueMode });
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

  const plan = async (clarified: ClarifiedTask[], planningContext?: string) => {
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
          behavior_signals: behaviorSignals,
          ai_memory: readAiWeeklyMemory(),
        },
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed));
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
      }));
      if (!blocks.length) {
        await supabase.from("plans").delete().eq("id", planRow.id);
        throw new Error("No schedule was generated — try fewer tasks or simpler wording.");
      }
      await supabase.from("blocks").insert(blocks);
      if (rescueRationale) {
        trackAiEvent("ai_rescue_applied", {
          mode: rescueMode,
          blocks_generated: blocks.length,
        });
      }
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

  // Derive a glanceable plan summary
  const planStats = useMemo(() => {
    const tasks = planBlocks.filter(isUserTask);
    const done = tasks.filter(b => b.completed).length;
    const totalMin = tasks.reduce((s, b) => s + b.duration_min, 0);
    return { tasks, done, total: tasks.length, hours: Math.round(totalMin / 6) / 10 };
  }, [planBlocks]);
  const remainingMin = useMemo(
    () => planStats.tasks.filter((b) => !b.completed).reduce((s, b) => s + (b.duration_min || 0), 0),
    [planStats.tasks],
  );
  const progressPct = planStats.total > 0 ? Math.round((planStats.done / planStats.total) * 100) : 0;
  const remainingLabel = useMemo(() => {
    const h = Math.floor(remainingMin / 60);
    const m = remainingMin % 60;
    return `${h}h ${m}m`;
  }, [remainingMin]);

  const isToday = planDate === todayDateStr();
  const overdueCount = useMemo(() => {
    if (!isToday || !hasPlanForDate) return 0;
    const nowMin = toMin(nowHM);
    return (planBlocks as Block[]).filter((b) => {
      if (!isUserTask(b) || b.completed) return false;
      const end = toMin(b.start_time) + (b.duration_min || 0);
      return end < nowMin;
    }).length;
  }, [hasPlanForDate, isToday, nowHM, planBlocks]);
  const isRunningBehind = overdueCount >= 2;
  const tone = getTone(profile as any);

  return (
    <Shell>
      <PullToRefresh
        onRefresh={async () => {
          if (!user) return;
          await queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, planDate) });
        }}
      >
      <div className="px-5 pt-8">
        {/* ── Header ─────────────────────────── */}
        <div className="hero-glass p-4.5 md:p-5 shadow-elevated">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="kicker">{friendlyDate()}</p>
              <h1 className="type-title mt-2 truncate text-balance">
              {greetingFor(tone, profile?.display_name)}
              </h1>
              {!profile?.onboarded ? (
                <p className="type-body text-secondary-fg mt-2.5">
                  Bottom bar: <span className="text-subtle">Today</span> · <span className="text-subtle">Timer</span> ·{" "}
                  <span className="text-subtle">History</span> · <span className="text-subtle">Settings</span>
                </p>
              ) : hasPlanForDate && planDate === todayDateStr() ? (
                <p className="type-body text-secondary-fg mt-2.5">
                  <span className="text-subtle">Next up</span> jumps into Focus; open the plan card to tick tasks off.
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-start gap-1.5">
              <ProBadge />
            </div>
          </div>
          <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-border/80 to-transparent" />
          <div className="mt-3 type-meta uppercase tracking-[0.08em]">
            {hasPlanForDate ? "Plan ready" : "No plan yet"} · {isToday ? "Today" : friendlyDateFor(parseDateStr(planDate))}
          </div>
        </div>
        {hasPlanForDate && (
          <div className="mt-3 app-card px-3 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="type-section">Status</div>
              <div className="type-body truncate">{planStats.done} of {planStats.total} completed</div>
            </div>
            <button
              type="button"
              onClick={() => void rescueMyDay(true)}
              className="h-8 px-3 rounded-lg border border-accent surface-accent text-[12px] font-medium text-primary pressable shrink-0"
            >
              Rescue my day ↗
            </button>
          </div>
        )}
        {isPro && debriefOpen && (
          <div
            className="mt-3 app-card p-3.5"
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
        {isToday && hasPlanForDate && planStats.total > 0 && (
          <div className="mt-3 px-1">
            <div className="flex items-center justify-between type-meta">
              <span>{planStats.done} / {planStats.total} done · {remainingLabel} remaining</span>
              <span className="tabular-nums">{progressPct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-muted/70 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/90"
                style={{
                  width: `${progressPct}%`,
                  transition: "width 420ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
            </div>
          </div>
        )}

        {profile?.onboarded && (
          <div className="mt-4 app-card p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider text-secondary-fg inline-flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-primary" />
                Rescue
              </span>
              <span className="text-[11px] text-secondary-fg">{nowHM}</span>
            </div>
            {hasPlanForDate ? (
            <div className="mt-2.5 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setRescueMode("conservative")}
                    className={`h-9 rounded-lg border text-[11px] font-medium pressable ${rescueMode === "conservative" ? "surface-accent border-accent text-primary" : "surface-soft border-soft text-secondary-fg"}`}
                  >
                    Conservative
                  </button>
                  <button
                    type="button"
                    onClick={() => setRescueMode("balanced")}
                    className={`h-9 rounded-lg border text-[11px] font-medium pressable ${rescueMode === "balanced" ? "surface-accent border-accent text-primary" : "surface-soft border-soft text-secondary-fg"}`}
                  >
                    Balanced
                  </button>
                  <button
                    type="button"
                    onClick={() => setRescueMode("aggressive")}
                    className={`h-9 rounded-lg border text-[11px] font-medium pressable ${rescueMode === "aggressive" ? "surface-accent border-accent text-primary" : "surface-soft border-soft text-secondary-fg"}`}
                  >
                    Aggressive
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void rescueMyDay(true)}
                  className="w-full h-10 rounded-lg border border-soft surface-soft text-[12px] text-secondary-fg hover:text-foreground pressable inline-flex items-center justify-center gap-1.5"
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Rescue my day ↗
                </button>
                {rescueRationale && (
                  <p className="text-[11px] text-secondary-fg leading-relaxed px-1">
                    {rescueRationale}
                  </p>
                )}
                {rescueExplain.length > 0 && (
                  <ul className="px-4 list-disc text-[11px] text-secondary-fg space-y-1">
                    {rescueExplain.map((line, idx) => (
                      <li key={idx}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-secondary-fg">Generate a plan first to unlock Rescue.</p>
            )}
          </div>
        )}

        {/* ── Plan — primary surface when present ─ */}
        {hasPlanForDate ? (
          <div className="mt-7 space-y-4">
            {isToday && (
              <NextUpCard
                blocks={planBlocks}
                nowHHMM={nowHM}
                onOpenPlan={() => nav("/today/plan")}
              />
            )}
            {isRunningBehind && (
              <button
                type="button"
                onClick={() => void rescueMyDay(false)}
                className="w-full h-10 rounded-xl border border-accent surface-accent text-[12.5px] font-medium text-primary hover:opacity-95 pressable inline-flex items-center justify-center gap-2"
              >
                <ShieldAlert className="h-4 w-4" />
                Rescue my day ↗
                <span className="text-[11px] text-secondary-fg">({overdueCount} overdue)</span>
              </button>
            )}

            <button
              data-tour="today-plan"
              onClick={() => nav(isToday ? "/today/plan" : `/today/plan?date=${planDate}`)}
              className="w-full text-left hero-glass panel-luxe p-4.5 pressable hover:border-primary/28 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <span className="type-section text-primary">{isToday ? "Timeline preview" : friendlyDateFor(parseDateStr(planDate))}</span>
                <span className="type-meta">Tap to open full editor</span>
              </div>

              {planSummary && (
                <p className="font-display text-[19px] leading-snug text-foreground mt-2.5">
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
          <div className="mt-10 hero-glass panel-luxe p-5 shadow-elevated">
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

        {!isPro && (
          <button
            type="button"
            onClick={() => openUpgrade("feature")}
            className="mt-4 w-full h-10 rounded-xl border border-accent surface-accent text-[12px] text-foreground pressable inline-flex items-center justify-between px-3"
          >
            <span>
              {planQuotaRemaining} free planning day{planQuotaRemaining === 1 ? "" : "s"} left this week
            </span>
            <span className="text-primary font-medium">Upgrade</span>
          </button>
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
              {rescueExplain.length > 0 && (
                <ul className="mt-1.5 px-4 list-disc text-[11px] text-secondary-fg space-y-1">
                  {rescueExplain.map((line, idx) => (
                    <li key={idx}>{line}</li>
                  ))}
                </ul>
              )}
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
            {hasPlanForDate && (
              <MoreRow onClick={() => { setMoreOpen(false); void rescueMyDay(true); }} icon={<ShieldAlert className="h-4 w-4" />} label="Rescue my day ↗" />
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
      <Sheet open={rescueSheetOpen} onOpenChange={setRescueSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl border-soft bg-popover">
          <SheetHeader className="text-left">
            <SheetTitle className="text-[16px]">Rescue my day</SheetTitle>
            <SheetDescription>Keep what still fits today, defer the rest.</SheetDescription>
          </SheetHeader>
          {rescueLoading ? (
            <div className="mt-3 text-[12px] text-secondary-fg">Building a realistic rescue plan…</div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="type-meta">{rescueWindowLabel}</div>
              <div>
                <div className="text-[12px] font-medium text-foreground">Here&apos;s what changed</div>
                {rescueDiffRows.length === 0 ? (
                  <div className="mt-1 text-[12px] text-secondary-fg">No schedule shifts needed.</div>
                ) : (
                  <div className="mt-1 space-y-1.5 max-h-44 overflow-y-auto">
                    {rescueDiffRows.map((r, i) => (
                      <div key={`${r.title}-${i}`} className="rounded-lg border border-soft surface-soft px-3 py-2">
                        <div className="text-[12px] text-foreground truncate">{r.title}</div>
                        <div className="text-[11px] text-secondary-fg tabular-nums">{fmtTime(r.before)} → {r.after === "Deferred" ? "Deferred" : fmtTime(r.after)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[12px] font-medium text-foreground">Deferred</div>
                <div className="text-[11px] text-secondary-fg">These didn&apos;t make today&apos;s cut.</div>
                {rescueDeferredRows.length === 0 ? (
                  <div className="mt-1 text-[12px] text-secondary-fg">Nothing deferred.</div>
                ) : (
                  <div className="mt-1 space-y-1 max-h-28 overflow-y-auto">
                    {rescueDeferredRows.slice(0, 8).map((r, i) => (
                      <div key={`${r.title}-${i}`} className="text-[12px] text-secondary-fg truncate">
                        • {r.title} {r.mins > 0 ? `(${fmtMin(r.mins)})` : ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  onClick={async () => {
                    if (!user || !rescuePendingBlocks.length) return;
                    try {
                      const { data: planRow, error: planErr } = await supabase
                        .from("plans")
                        .select("id")
                        .eq("user_id", user.id)
                        .eq("date", planDate)
                        .maybeSingle();
                      if (planErr || !planRow?.id) throw new Error("Plan not found.");
                      const { data: current } = await supabase
                        .from("blocks")
                        .select("*")
                        .eq("plan_id", planRow.id)
                        .order("position");
                      const currentBlocks = (current || []) as any[];
                      const toRemoveIds = currentBlocks
                        .filter((b) => {
                          if (b.is_calendar_event) return false;
                          if (isUserTask(b) && !b.completed) return true;
                          if ((b.kind === "break" || b.kind === "lunch") && !b.completed) return true;
                          return false;
                        })
                        .map((b) => b.id);
                      const keep = currentBlocks.filter((b) => !toRemoveIds.includes(b.id));
                      if (toRemoveIds.length) await supabase.from("blocks").delete().in("id", toRemoveIds);
                      const inserts = rescuePendingBlocks.map((b: any, i: number) => ({
                        plan_id: planRow.id,
                        user_id: user.id,
                        start_time: b.start_time,
                        duration_min: b.duration_min,
                        estimated_minutes: b.estimated_minutes ?? b.duration_min,
                        actual_minutes: null,
                        title: b.title,
                        type: b.type,
                        kind: b.kind,
                        block_type: inferScheduleBlockType(b),
                        position: keep.length + i,
                        ai_reasoning: b.reasoning ?? null,
                        location: b.location ?? null,
                        location_lat: b.location_lat ?? null,
                        location_lng: b.location_lng ?? null,
                      }));
                      if (inserts.length) await supabase.from("blocks").insert(inserts);
                      await queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, planDate) });
                      setRescueSheetOpen(false);
                      setRescuePendingBlocks([]);
                      setRescueDiffRows([]);
                      trackAiEvent("ai_rescue_applied", { mode: rescueMode, deferred_count: rescueDeferredRows.length });
                      toast.success("Rescue plan applied.");
                    } catch (e: any) {
                      toast.error(e?.message || "Unable to apply rescue plan.");
                    }
                  }}
                  className="flex-1 h-10 rounded-xl"
                >
                  Use this plan
                </Button>
                <Button variant="outline" className="flex-1 h-10 rounded-xl border-soft" onClick={() => setRescueSheetOpen(false)}>
                  Go back
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
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
