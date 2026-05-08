import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Block, todayDateStr } from "@/lib/daydraft";
import { Check, ChevronRight, Plus, Sparkles, MapPin, ExternalLink, Loader2, Lightbulb, Copy, Phone, CalendarPlus, Mail, Timer, Square, X, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { mapsUrl } from "@/lib/maps";
import { toast } from "sonner";
import { useTimeTracker, useTimeTrackerElapsed, fmtHMS } from "@/hooks/useTimeTracker";
import { getTone, t as toneCopy } from "@/lib/tone";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { haptics } from "@/lib/haptics";
import { PreflightSheet } from "@/components/app/PreflightSheet";
import { getCalmMode, setCalmMode } from "@/lib/calmMode";
import { isAiFlagEnabled, trackAiEvent } from "@/lib/aiRuntime";
import { useEntitlement } from "@/hooks/useEntitlement";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type AIHelp = {
  substeps: string[];
  links: { label: string; url: string }[];
  tip: string;
  draft?: { subject?: string; body: string };
  recovery_actions?: { id: "compress_rest_day" | "defer_low_priority" | "split_current_block"; label: string; why: string }[];
};

export default function Focus() {
  const { blockId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfile();
  const tone = getTone(profile as any);
  const { active: tracking, start: startTracking, stop: stopTracking, categories } = useTimeTracker();
  const elapsedSec = useTimeTrackerElapsed();
  const [block, setBlock] = useState<any | null>(null);
  const [next, setNext] = useState<Block | null>(null);
  const [remaining, setRemaining] = useState<number>(0); // seconds
  const [total, setTotal] = useState<number>(1);
  const [showCheck, setShowCheck] = useState(false);
  const [help, setHelp] = useState<AIHelp | null>(null);
  const [helpLoading, setHelpLoading] = useState(false);
  const [helpError, setHelpError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const tickRef = useRef<number | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [extended, setExtended] = useState(false);
  const startedHereRef = useRef(false);
  const [confirmSkipOpen, setConfirmSkipOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [runtimeReason, setRuntimeReason] = useState<"stuck" | "skip" | "overtime" | null>(null);
  // Wall-clock when the timer actually started ticking (after preflight).
  // Used to attribute REAL elapsed time to time_entries on complete().
  const actualStartMsRef = useRef<number | null>(null);
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  /** Plan calendar day (YYYY-MM-DD) — for recap / back navigation off the default "today". */
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const oneThingMode = searchParams.get("mode") === "one";
  const [oneThingDoneFlash, setOneThingDoneFlash] = useState(false);
  const calmAutoEnabledRef = useRef(false);
  const guardrailToastShownRef = useRef(false);
  const trackingRef = useRef(tracking);
  const aiFocusRuntimeEnabled = isAiFlagEnabled("aiFocusRuntime", user?.id);
  const { isPro } = useEntitlement();

  useEffect(() => {
    const wasCalm = getCalmMode();
    if (!wasCalm) {
      calmAutoEnabledRef.current = true;
      setCalmMode(true);
    }
    return () => {
      if (calmAutoEnabledRef.current) {
        setCalmMode(false);
      }
    };
  }, []);

  useEffect(() => {
    if (!blockId || !user) return;
    // Reset all per-block state so navigating between blocks via /focus/:id
    // doesn't leave the previous block's UI (e.g. green checkmark) on screen.
    setBlock(null);
    setNext(null);
    setRemaining(0);
    setTotal(1);
    setShowCheck(false);
    setExtended(false);
    setExtendedMin(0);
    setArmed(false);
    setHelp(null);
    setHelpOpen(false);
    setHelpError(null);
    setHelpLoading(false);
    startedHereRef.current = false;
    actualStartMsRef.current = null;
    guardrailToastShownRef.current = false;
    setPlanDate(null);
    (async () => {
      const { data } = await supabase.from("blocks").select("*").eq("id", blockId).maybeSingle();
      if (!data) {
        toast("This block is no longer available");
        nav("/today/plan");
        return;
      }
      const { data: planRow } = await supabase.from("plans").select("date").eq("id", data.plan_id).maybeSingle();
      setPlanDate((planRow as { date?: string } | null)?.date ?? todayDateStr());
      setBlock(data as Block);
      setTotal(data.duration_min * 60);
      setRemaining(data.duration_min * 60);
      // Match DayView's "Start" button: skip calendar events the user can't act on
      // inside Focus mode. Otherwise the "Next" jump lands on a non-actionable item.
      const { data: rest } = await supabase.from("blocks").select("*").eq("plan_id", data.plan_id)
        .eq("kind", "task").eq("completed", false).eq("is_calendar_event", false)
        .gt("position", data.position).order("position").limit(1);
      setNext((rest?.[0] as Block) || null);
      // Show preflight on first visit per session — unless the user opted out.
      // Skip on intra-session block transitions to avoid nagging.
      const optedOut = (() => { try { return localStorage.getItem("dd_preflight_disabled") === "1"; } catch { return false; } })();
      if (!optedOut && !sessionStorage.getItem("dd_preflight_seen") && !sessionStorage.getItem("dd_focus_active")) {
        setPreflightOpen(true);
      } else {
        setArmed(true);
      }
      sessionStorage.setItem("dd_focus_active", "1");
    })();
  }, [blockId, user?.id]);

  const dismissPreflight = () => {
    sessionStorage.setItem("dd_preflight_seen", "1");
    setPreflightOpen(false);
    setArmed(true);
  };

  // Mark the wall-clock start the first time the timer is armed for this block.
  useEffect(() => {
    if (armed && !actualStartMsRef.current) {
      actualStartMsRef.current = Date.now();
    }
  }, [armed]);

  useEffect(() => {
    if (!block || !armed) return;
    const onVis = () => { /* timer pauses naturally when tab hidden — we use realtime */ };
    document.addEventListener("visibilitychange", onVis);
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      if (!document.hidden) {
        const dt = (now - last) / 1000;
        setRemaining(r => Math.max(0, r - dt));
      }
      last = now;
      tickRef.current = window.setTimeout(tick, 250);
    };
    tick();
    return () => { if (tickRef.current) clearTimeout(tickRef.current); document.removeEventListener("visibilitychange", onVis); };
  }, [block?.id, armed]);

  useEffect(() => {
    if (!block || !armed) return;
    if (remaining > 0) return;
    // Offer extend before auto-completing the block
    if (!extended) {
      // pause at zero — show "extend or complete" UI; do nothing here
      return;
    }
    complete();
    // eslint-disable-next-line
  }, [remaining]);

  const EXTEND_CAP_MIN = 60; // hard cap on cumulative extensions per block
  const [extendedMin, setExtendedMin] = useState(0);
  const extendFiveMin = () => {
    if (extendedMin + 5 > EXTEND_CAP_MIN) {
      toast("You have already extended this block by 60 minutes. Wrap up or complete it.", { duration: 3500 });
      return;
    }
    setRemaining(r => r + 5 * 60);
    setTotal(t => t + 5 * 60);
    setExtendedMin(m => m + 5);
    setExtended(true);
    haptics.tap();
    toast.success(`+5 min · ${extendedMin + 5}/${EXTEND_CAP_MIN}m extended`);
  };

  // Start time-tracking only if the user opted in for THIS task during planning.
  // The choice is persisted per plan in localStorage (see Today.tsx).
  useEffect(() => {
    if (!block || !categories.length) return;
    if (tracking) return; // honor any existing session
    let optedIn = false;
    try {
      const raw = localStorage.getItem(`dd_track_titles_${block.plan_id}`);
      const titles: string[] = raw ? JSON.parse(raw) : [];
      optedIn = titles.includes((block.title || "").trim().toLowerCase());
    } catch {/* ignore */}
    if (!optedIn) return;
    startedHereRef.current = true;
    startTracking(undefined, { source: "focus", blockId: block.id, note: block.title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block?.id, categories.length]);

  useEffect(() => {
    trackingRef.current = tracking;
  }, [tracking]);

  useEffect(() => {
    return () => {
      // Stop tracking on unmount (leaving Focus entirely)
      if (startedHereRef.current && trackingRef.current) stopTracking();
      sessionStorage.removeItem("dd_focus_active");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trackingCat = categories.find(c => c.id === tracking?.category_id);

  const loadHelp = async (reason?: "stuck" | "skip" | "overtime") => {
    if (!block || helpLoading) return;
    setHelpOpen(true);
    if (help) return;
    if (reason) setRuntimeReason(reason);
    setHelpLoading(true);
    setHelpError(null);
    trackAiEvent("ai_focus_help_used", { reason: reason || "manual", block_type: block.type });
    try {
      const { data, error } = await supabase.functions.invoke("task-assistant", {
        body: {
          title: block.title,
          type: block.type,
          location: block.location,
          duration_min: block.duration_min,
          ai_tone: (profile as any)?.ai_tone || "professional",
          ai_tone_custom: (profile as any)?.ai_tone_custom || null,
          runtime_reason: reason || null,
        },
      });
      if (error) throw error;
      setHelp(data as AIHelp);
    } catch (e: any) {
      console.error(e);
      setHelpError(e?.message || "Unable to load AI assistant");
    } finally {
      setHelpLoading(false);
    }
  };

  const complete = async () => {
    if (!block) return;
    haptics.notify("success");
    setShowCheck(true);
    // Compute REAL time spent (wall-clock from when the timer armed → now).
    // This replaces the old behaviour where completion silently credited the
    // user with the full estimate even if they pressed Complete after 30s.
    const actualSec = actualStartMsRef.current
      ? Math.max(0, Math.round((Date.now() - actualStartMsRef.current) / 1000))
      : 0;
    // Persist completion BEFORE navigating so a flaky network can't leave the
    // block stuck as incomplete after we've already advanced the user.
    const { error } = await supabase
      .from("blocks")
      .update({ completed: true, completed_at: new Date().toISOString() })
      .eq("id", block.id);
    if (error) {
      setShowCheck(false);
      toast.error("Unable to save. Please try again.");
      return;
    }
    try { localStorage.setItem(`dd_last_plan_progress_${planDate || todayDateStr()}`, new Date().toISOString()); } catch {/* ignore */}
    // Only credit time-tracker hours if the user EXPLICITLY tracked this block
    // (started a timer for it). Otherwise we fabricate hours that never happened.
    if (startedHereRef.current && tracking) {
      try { await stopTracking(); } catch {/* ignore */}
      startedHereRef.current = false;
    }
    const recap = `/recap?date=${planDate || todayDateStr()}`;
    if (oneThingMode) {
      setOneThingDoneFlash(true);
      setTimeout(() => {
        if (next) nav(`/focus/${next.id}?mode=one`);
        else nav(recap);
      }, 3000);
      return;
    }
    setTimeout(() => {
      if (next) nav(`/focus/${next.id}`);
      else nav(recap);
    }, 600);
  };

  const skip = async () => {
    if (!block) return;
    haptics.impact("light");
    // Skip means "I'm not doing this right now" — DO NOT mark complete and DO
    // NOT bank tracker time. Just move on. The block stays open so it can be
    // carried over or re-planned later.
    if (startedHereRef.current && tracking) {
      // Drop the in-progress entry entirely — they didn't actually do the work.
      try {
        await supabase.from("time_entries").delete().eq("id", tracking.id);
      } catch {/* ignore */}
      startedHereRef.current = false;
    }
    const backPlan =
      planDate && planDate !== todayDateStr() ? `/today/plan?date=${planDate}` : "/today/plan";
    if (next) nav(`/focus/${next.id}`); else nav(backPlan);
  };

  // Cancel = leave focus mode without changing anything (no completion, no
  // tracker write). Mirrors browser-back but with a confirmation if a session
  // is active so the user doesn't accidentally lose tracked time.
  const cancel = async () => {
    if (startedHereRef.current && tracking) {
      try {
        await supabase.from("time_entries").delete().eq("id", tracking.id);
      } catch {/* ignore */}
      startedHereRef.current = false;
    }
    const backPlan =
      planDate && planDate !== todayDateStr() ? `/today/plan?date=${planDate}` : "/today/plan";
    nav(backPlan);
  };

  const lateDeepWork = !!block && block.type === "deep_work" && new Date().getHours() >= 18;
  const longSession = !!block && block.duration_min >= 90;

  useEffect(() => {
    if (!armed || guardrailToastShownRef.current) return;
    if (!block) return;
    if (lateDeepWork) {
      guardrailToastShownRef.current = true;
      toast("Guardrail: keep this block focused, then switch to lighter work.");
      return;
    }
    if (longSession) {
      guardrailToastShownRef.current = true;
      toast("Guardrail: take a short break after this focus block.");
    }
  }, [armed, lateDeepWork, longSession]);

  const timeUp = remaining <= 0 && armed;
  useEffect(() => {
    if (!aiFocusRuntimeEnabled || !timeUp || runtimeReason) return;
    void loadHelp("overtime");
  }, [aiFocusRuntimeEnabled, timeUp, runtimeReason]);

  if (!block) return <div className="min-h-screen bg-background" />;
  if (oneThingMode && !isPro) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center">
          <div className="text-[18px] font-display text-foreground">One thing mode is Pro</div>
          <button onClick={() => nav(`/focus/${block.id}`)} className="mt-3 text-primary text-sm hover:underline">Continue in regular focus</button>
        </div>
      </div>
    );
  }

  const pct = 1 - remaining / total;
  const radius = 110;
  const circ = 2 * Math.PI * radius;
  const offset = circ * pct;
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  const lowTime = remaining < 300;
  const oneThingElapsedSec = actualStartMsRef.current ? Math.max(0, Math.floor((Date.now() - actualStartMsRef.current) / 1000)) : 0;

  if (oneThingMode) {
    return (
      <div className="min-h-screen w-full bg-black flex justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-black/95" />
        <button
          onClick={() => cancel()}
          className="absolute top-5 right-5 z-20 text-[12px] text-slate-300 border border-slate-700 rounded-full px-3 py-1.5 pressable hover:text-white"
        >
          × Exit focus
        </button>
        <div className="relative z-10 w-full max-w-[430px] min-h-screen flex flex-col items-center justify-center px-8">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">One thing mode</div>
          <h1 className="mt-3 text-center font-display text-[34px] leading-[1.08] text-white text-balance">{block.title}</h1>
          <div className="mt-8 text-[46px] font-mono-sf tabular-nums text-cyan-300">{fmtHMS(oneThingElapsedSec)}</div>
          <button
            onClick={complete}
            className="mt-10 h-14 px-10 rounded-2xl bg-cyan-400 text-slate-950 font-semibold text-[17px] pressable shadow-[0_10px_40px_-12px_rgba(34,211,238,0.7)]"
          >
            Done
          </button>
        </div>
        {oneThingDoneFlash && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-emerald-500/92 animate-in fade-in duration-300">
            <div className="text-center text-emerald-950">
              <Check className="h-20 w-20 mx-auto" strokeWidth={3.2} />
              <div className="mt-3 text-[20px] font-display font-semibold">Great work</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const applyRecoveryAction = async (actionId: "compress_rest_day" | "defer_low_priority" | "split_current_block") => {
    if (!block || !user) return;
    trackAiEvent("ai_replan_applied", { action_id: actionId, block_id: block.id });
    if (actionId === "split_current_block") {
      toast.success("Use the suggested steps below as your micro-plan.");
      return;
    }
    const { data: restRows } = await supabase
      .from("blocks")
      .select("title,duration_min,type,kind,completed,position")
      .eq("plan_id", block.plan_id)
      .gt("position", block.position)
      .eq("completed", false)
      .order("position", { ascending: true });
    const rest = (restRows || []).filter((r: any) => r.kind === "task");
    if (!rest.length) {
      toast("No remaining tasks to re-plan.");
      return;
    }
    const shaped = rest
      .filter((r: any) => actionId !== "defer_low_priority" || r.type !== "routine")
      .map((r: any) => {
        const min = Number(r.duration_min) || 30;
        const nextMin = actionId === "compress_rest_day" ? Math.max(20, Math.round(min * 0.8)) : min;
        return `${r.title} (${nextMin}m)`;
      });
    if (!shaped.length) {
      toast("Everything left is low-priority. Finish this block first.");
      return;
    }
    sessionStorage.setItem("dd_planning_input", shaped.join("\n"));
    if (planDate) sessionStorage.setItem("dd_planning_plan_date", planDate);
    nav(planDate && planDate !== todayDateStr() ? `/today?date=${planDate}&composer=1` : "/today?composer=1");
  };

  // Smart contextual quick actions derived from the title/type
  const title = (block.title || "").toLowerCase();
  const isCall = /\b(call|phone|ring|dial)\b/.test(title);
  const isMeeting = block.type === "communication" && /\b(meeting|sync|standup|1:1|catchup|catch-up|call with|meet with)\b/.test(title);
  const isEmail = /\b(email|reply|respond|inbox)\b/.test(title);

  const calendarUrl = (() => {
    const t = encodeURIComponent(block.title || "Block");
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${t}`;
  })();
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(block.title || "")}`;
  const telUrl = `tel:`;

  const copyDraft = async () => {
    if (!help?.draft) return;
    const txt = help.draft.subject
      ? `Subject: ${help.draft.subject}\n\n${help.draft.body}`
      : help.draft.body;
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("Draft copied");
    } catch {
      toast.error("Unable to copy draft");
    }
  };

  return (
    <div className="min-h-screen w-full bg-background flex justify-center relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[160px]" style={{ background: "var(--gradient-glow)" }} />
      <div className="relative w-full max-w-[400px] min-h-screen flex flex-col items-center px-6 pt-14 pb-10 page-enter">
        {/* Cancel — top-left, returns to plan without altering anything */}
        <button
          onClick={() => (startedHereRef.current && tracking) ? setConfirmCancelOpen(true) : cancel()}
          className="absolute top-4 left-4 h-11 w-11 rounded-full border border-soft bg-background/70 backdrop-blur-md flex items-center justify-center text-secondary-fg hover:text-foreground pressable shadow-card"
          aria-label="Cancel focus session"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="px-3 py-1 rounded-full surface-accent border border-accent text-[10px] tracking-[0.14em] text-primary font-semibold uppercase">Focus</div>
        {/* Tracking pill removed — the main timer + the inline "Stop tracking"
            button below already convey state. Two timers on one screen was
            redundant and confusing. */}

        <h1 className="mt-10 font-display text-[22px] font-semibold text-center leading-snug max-w-[300px] line-clamp-3 text-balance">{block.title}</h1>
        {(lateDeepWork || longSession) && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-soft surface-soft text-[11px] text-secondary-fg">
            <ShieldAlert className="h-3.5 w-3.5 text-primary" />
            {lateDeepWork ? "Late-day guardrail: one priority, then wind down." : "Guardrail: take a short reset right after this block."}
          </div>
        )}

        <div className="relative mt-12">
          {/* Ambient breathing ring (subtle pulse around the timer) */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: "radial-gradient(closest-side, hsl(var(--primary) / 0.1), transparent 72%)",
              animation: "breathe 4s ease-in-out infinite",
            }}
          />
          <svg width="260" height="260" className={lowTime ? "ring-pulse rounded-full relative" : "relative"}>
            <circle cx="130" cy="130" r={radius} stroke="hsl(var(--border) / 0.45)" strokeWidth="5" fill="none" />
            <circle cx="130" cy="130" r={radius} stroke="hsl(var(--primary))" strokeWidth="5" fill="none" strokeLinecap="round"
              strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90 130 130)" style={{ transition: "stroke-dashoffset 240ms linear" }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {showCheck ? (
              <div className="h-20 w-20 rounded-full bg-success flex items-center justify-center check-pop">
                <Check className="h-10 w-10 text-success-foreground" strokeWidth={3} />
              </div>
            ) : timeUp ? (
              <div className="text-center">
                <div className="text-[28px] font-mono-sf font-semibold tabular-nums leading-none text-primary">Time's up</div>
                <div className="text-secondary-fg text-xs mt-2">Need a little more?</div>
              </div>
            ) : (
              <>
                <div className="text-[48px] font-mono-sf font-medium tabular-nums leading-none">
                  {String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}
                </div>
                <div className="text-secondary-fg text-sm mt-2">of {block.duration_min} minutes</div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-12 w-full">
          <button
            onClick={extendFiveMin}
            className={`h-12 px-3 rounded-[14px] text-sm font-medium pressable flex items-center gap-1.5 transition-colors backdrop-blur-sm ${
              timeUp
                ? "surface-accent border border-accent text-primary"
                : "app-card py-0 border-soft"
            }`}
          >
            <Plus className="h-3.5 w-3.5" /> 5 min
          </button>
          <button onClick={complete} className="flex-1 h-13 py-3 rounded-[14px] bg-primary text-primary-foreground font-medium pressable flex items-center justify-center gap-2 shadow-card"
           >
            Complete <Check className="h-4 w-4" strokeWidth={3} />
          </button>
        </div>
        <button onClick={() => setConfirmSkipOpen(true)} className="mt-3 text-secondary-fg text-xs hover:text-foreground inline-flex items-center gap-1">
          Skip block <ChevronRight className="h-3 w-3" />
        </button>
        {aiFocusRuntimeEnabled && (
          <button
            onClick={() => void loadHelp("stuck")}
            className="mt-2 text-secondary-fg text-xs hover:text-foreground inline-flex items-center gap-1"
          >
            {toneCopy(tone, "ai_stuck_cta")} <Sparkles className="h-3 w-3" />
          </button>
        )}
        {!tracking && armed && categories.length > 0 && (
          <Popover open={catPickerOpen} onOpenChange={setCatPickerOpen}>
            <PopoverTrigger asChild>
              <button className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-soft bg-background/60 backdrop-blur-sm text-[12px] text-secondary-fg hover:text-foreground pressable">
                <Timer className="h-3.5 w-3.5" /> Track time…
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="center">
              <div className="text-[10px] uppercase tracking-wider text-secondary-fg px-2 py-1">Pick a category</div>
              <div className="space-y-0.5">
                {categories.map(c => (
                  <button
                    key={c.id}
                    onClick={() => {
                      startedHereRef.current = true;
                      startTracking(c.id, { source: "focus", blockId: block.id, note: block.title });
                      setCatPickerOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-muted text-foreground text-left pressable"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                    <span className="flex-1 truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {tracking && startedHereRef.current && trackingCat && (
          <button
            onClick={() => { stopTracking(); startedHereRef.current = false; }}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-soft bg-background/60 backdrop-blur-sm text-[12px] text-secondary-fg hover:text-foreground pressable"
          >
            <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: trackingCat.color }} />
            <span className="text-foreground font-medium">{trackingCat.name}</span>
            <span className="font-mono tabular-nums">{fmtHMS(elapsedSec)}</span>
            <Square className="h-3 w-3 ml-1" />
          </button>
        )}
        <style>{`@keyframes breathe {
          0%, 100% { transform: scale(0.92); opacity: 0.55; }
          50% { transform: scale(1.05); opacity: 0.95; }
        }`}</style>

        <div className="mt-auto pt-8 text-secondary-fg text-[13px] leading-relaxed text-center px-2">
          {next ? (
            <>Next up: <span className="text-foreground">{next.title}</span></>
          ) : block.kind === "task" ? (
            "Last block — finish strong."
          ) : block.kind === "lunch" ? (
            "Enjoy your lunch."
          ) : (
            "Take a real break."
          )}
        </div>

        {/* AI Assistant panel */}
        <div className="w-full mt-6">
          {!helpOpen ? (
            <button
              onClick={() => loadHelp()}
              className="w-full h-10 rounded-[12px] app-card py-0 text-sm font-medium pressable inline-flex items-center justify-center gap-2 text-foreground"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              {toneCopy(tone, "ai_help_cta")}
            </button>
          ) : (
            <div className="app-card panel-luxe p-3.5 space-y-3 text-left">
              <div className="flex items-center gap-2 eyebrow text-primary">
                <Sparkles className="h-3.5 w-3.5" /> {toneCopy(tone, "ai_assistant_title")}
              </div>
              {block.location && (
                <a
                  href={mapsUrl(block.location, block.location_lat, block.location_lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground bg-background/80 rounded-[12px] px-3 py-2 border border-soft pressable"
                >
                  <MapPin className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate flex-1">{block.location}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-secondary-fg" />
                </a>
              )}
              {/* Contextual quick actions */}
              {(isCall || isMeeting || isEmail) && (
                <div className="flex gap-1.5 flex-wrap">
                  {isCall && (
                    <a href={telUrl} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background border border-soft text-xs font-medium text-foreground pressable">
                      <Phone className="h-3.5 w-3.5 text-primary" /> Call
                    </a>
                  )}
                  {isMeeting && (
                    <a href={calendarUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background border border-soft text-xs font-medium text-foreground pressable">
                      <CalendarPlus className="h-3.5 w-3.5 text-primary" /> Add to calendar
                    </a>
                  )}
                  {isEmail && (
                    <a href={mailtoUrl} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background border border-soft text-xs font-medium text-foreground pressable">
                      <Mail className="h-3.5 w-3.5 text-primary" /> New email
                    </a>
                  )}
                </div>
              )}
              {helpLoading && (
                <div className="flex items-center gap-2 text-sm text-secondary-fg py-3 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                </div>
              )}
              {helpError && (
                <div className="text-sm text-destructive">{helpError}</div>
              )}
              {help && (
                <>
                  {aiFocusRuntimeEnabled && help.recovery_actions && help.recovery_actions.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-secondary-fg">AI quick recovery</div>
                      {help.recovery_actions.map((a, idx) => (
                        <button
                          key={`${a.id}-${idx}`}
                          type="button"
                          onClick={() => void applyRecoveryAction(a.id)}
                          className="w-full text-left rounded-lg border border-soft bg-background/70 px-3 py-2 pressable"
                        >
                          <div className="text-[12px] font-medium text-foreground">{a.label}</div>
                          <div className="text-[11px] text-secondary-fg mt-0.5">{a.why}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {help.draft && (
                    <div className="rounded-[14px] border border-accent surface-accent overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-accent">
                        <div className="flex items-center gap-1.5 eyebrow text-primary">
                          <Mail className="h-3 w-3" /> Draft
                        </div>
                        <button onClick={copyDraft} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary pressable">
                          <Copy className="h-3 w-3" /> Copy
                        </button>
                      </div>
                      <div className="px-3 py-2.5 text-sm space-y-1">
                        {help.draft.subject && (
                          <div className="text-foreground"><span className="text-secondary-fg text-xs">Subject: </span>{help.draft.subject}</div>
                        )}
                        <pre className="whitespace-pre-wrap font-sans text-foreground text-[13px] leading-relaxed">{help.draft.body}</pre>
                      </div>
                    </div>
                  )}
                  {help.substeps?.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-secondary-fg mb-1.5">Steps</div>
                      <ol className="space-y-1.5">
                        {help.substeps.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                            <span className="text-foreground">{s}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {help.links?.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-secondary-fg mb-1.5">Useful links</div>
                      <div className="space-y-1">
                        {help.links.map((l, i) => (
                          <a
                            key={i}
                            href={l.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 text-sm text-primary hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{l.label}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {help.tip && (
                    <div className="flex items-start gap-2 surface-accent border border-accent rounded-[12px] px-3 py-2 text-sm text-foreground">
                      <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span>{help.tip}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <PreflightSheet
        open={preflightOpen}
        onOpenChange={(v) => { if (!v) dismissPreflight(); }}
        onStart={dismissPreflight}
        taskTitle={block?.title}
        taskType={block?.type}
      />
      <AlertDialog open={confirmSkipOpen} onOpenChange={setConfirmSkipOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip this block?</AlertDialogTitle>
            <AlertDialogDescription>
              "{block?.title}" stays open (not completed) and you'll move on. Any tracker time started here is dropped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {aiFocusRuntimeEnabled && (
              <button
                type="button"
                onClick={() => {
                  setConfirmSkipOpen(false);
                  void loadHelp("skip");
                }}
                className="h-10 rounded-md border border-soft px-3 text-sm text-secondary-fg hover:text-foreground pressable"
              >
                {toneCopy(tone, "ai_skip_alt_cta")}
              </button>
            )}
            <AlertDialogAction onClick={() => { setConfirmSkipOpen(false); skip(); }}>Skip</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave focus?</AlertDialogTitle>
            <AlertDialogDescription>
              You're tracking time. Leaving will discard this session — the block stays as it was.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmCancelOpen(false); cancel(); }}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
