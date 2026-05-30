import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAbortOnUnmount } from "@/hooks/useAbortOnUnmount";
import { Block, todayDateStr, wallMsOnPlanDay, blockSlotEndHHMM, fmtTime, isOpenUserTask } from "@/lib/daydraft";
import { minutesFromFocusArmSeconds, resolveActualMinutesOnComplete } from "@/lib/blockActualTime";
import { Check, Timer, Square, X, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { toast } from "sonner";
import { useTimeTracker, getElapsedSec, fmtHMS } from "@/hooks/useTimeTracker";
import { Input } from "@/components/ui/input";
import { getTone, t as toneCopy } from "@/lib/tone";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { haptics } from "@/lib/haptics";
import { liveActivity } from "@/lib/liveActivity";
import { PreflightSheet } from "@/components/app/PreflightSheet";
import { getAssignedCategoryId } from "@/lib/blockCategory";
import { getCalmMode, setCalmMode } from "@/lib/calmMode";
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

export default function Focus() {
  const { blockId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfile();
  const tone = getTone(profile as any);
  const { active: tracking, start: startTracking, stop: stopTracking, categories, addCategory, refresh: refreshTracker, entries } = useTimeTracker();
  // Read elapsed seconds synchronously each render. `sessionTick` (below)
  // drives the once-per-second re-render that keeps this value fresh.
  const elapsedSec = getElapsedSec();
  const [block, setBlock] = useState<any | null>(null);
  const [next, setNext] = useState<Block | null>(null);
  const windowWallRef = useRef({ startMs: 0, endMs: 0 });
  /** Ticks once per second while armed so session elapsed re-renders without countdown pressure. */
  const [sessionTick, setSessionTick] = useState(0);
  const [showCheck, setShowCheck] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  // Cancels in-flight task-assistant calls if the user leaves the Focus
  // screen mid-request — prevents setState-after-unmount.
  const getAbortSignal = useAbortOnUnmount();
  const startedHereRef = useRef(false);
  const autoStartedRef = useRef(false);
  // Guards so the Focus Live Activity (Dynamic Island) starts once per block,
  // and the deep-link "Mark done" auto-completes only once.
  const focusLAStartedRef = useRef(false);
  const autoCompletedRef = useRef(false);
  const [confirmSkipOpen, setConfirmSkipOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  // Wall-clock when the timer actually started ticking (after preflight).
  // Used to attribute REAL elapsed time to time_entries on complete().
  const actualStartMsRef = useRef<number | null>(null);
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const [newFocusCatName, setNewFocusCatName] = useState("");
  // Set when the user explicitly chooses "focus without tracking" for this
  // block. Suppresses the tracker prompt for the rest of the session, so the
  // big ring keeps counting plain elapsed without nagging.
  const [trackerSkipped, setTrackerSkipped] = useState(false);
  /** Plan calendar day (YYYY-MM-DD) — for recap / back navigation off the default "today". */
  const [planDate, setPlanDate] = useState<string | null>(null);
  // searchParams carries the Live Activity deep-link flag (?complete=1).
  const [searchParams] = useSearchParams();
  // "One thing mode" was removed from the product. Keep the variable so
  // existing branches stay dead without a large refactor.
  const oneThingMode = false;
  const [oneThingDoneFlash, setOneThingDoneFlash] = useState(false);
  const calmAutoEnabledRef = useRef(false);
  const guardrailToastShownRef = useRef(false);
  const trackingRef = useRef(tracking);
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
    windowWallRef.current = { startMs: 0, endMs: 0 };
    setShowCheck(false);
    setArmed(false);
    setTrackerSkipped(false);
    autoStartedRef.current = false;
    startedHereRef.current = false;
    actualStartMsRef.current = null;
    focusLAStartedRef.current = false;
    autoCompletedRef.current = false;
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
      const pd =
        ((planRow as { date?: string } | null)?.date ?? todayDateStr());
      const startMs = wallMsOnPlanDay(pd, data.start_time);
      const endMs = wallMsOnPlanDay(pd, blockSlotEndHHMM(data as Block));
      windowWallRef.current = { startMs, endMs };
      const { data: rest } = await supabase
        .from("blocks")
        .select("*")
        .eq("plan_id", data.plan_id)
        .eq("kind", "task")
        .eq("is_calendar_event", false)
        .gt("position", data.position)
        .order("position")
        .limit(24);
      const nextOpen = (rest || []).find((row) => isOpenUserTask(row as Block));
      setNext((nextOpen as Block) || null);
      // Show preflight on first visit per session — unless the user opted out.
      // Skip on intra-session block transitions to avoid nagging. Also skip
      // entirely when we arrived via the Live Activity "Mark done" deep link
      // (?complete=1): the user already decided, so arm immediately and let
      // the auto-complete effect run without a preflight flash.
      const wantsComplete = searchParams.get("complete") === "1";
      const optedOut = (() => { try { return localStorage.getItem("dd_preflight_disabled") === "1"; } catch { return false; } })();
      if (!wantsComplete && !optedOut && !sessionStorage.getItem("dd_preflight_seen") && !sessionStorage.getItem("dd_focus_active")) {
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

  // Auto-start the tracker the moment the focus session arms IF the user
  // already earmarked a category for this block on the Plan screen. If
  // they didn't, we leave tracking off and a prompt below offers a choice
  // ("pick category" / "focus without tracking").
  useEffect(() => {
    if (!armed || !block || autoStartedRef.current) return;
    if (tracking) return; // a timer is already running — don't double-start
    const assignedId = getAssignedCategoryId(block.id);
    if (!assignedId) return;
    const cat = categories.find((c) => c.id === assignedId);
    if (!cat) return;
    autoStartedRef.current = true;
    startedHereRef.current = true;
    void startTracking(cat.id, { source: "focus", blockId: block.id, note: block.title });
  }, [armed, block?.id, categories, tracking, startTracking]);

  useEffect(() => {
    if (!armed || !block) return;
    // Per-second re-render to drive the big ring countdown — pause it
    // when the tab is hidden so we don't burn renders the user can't
    // see. visibilitychange re-syncs when they come back.
    let id: number | null = null;
    const start = () => {
      if (id !== null) return;
      id = window.setInterval(() => setSessionTick((n) => n + 1), 1000);
    };
    const stop = () => {
      if (id !== null) { clearInterval(id); id = null; }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { setSessionTick((n) => n + 1); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [armed, block?.id]);

  useEffect(() => {
    trackingRef.current = tracking;
  }, [tracking]);

  useEffect(() => {
    return () => {
      // Stop tracking on unmount (leaving Focus entirely)
      if (startedHereRef.current && trackingRef.current) stopTracking();
      // Tear down the Dynamic Island / Lock Screen activity. Moving between
      // blocks keeps this component mounted (only the param changes), so this
      // fires only when the user actually leaves Focus — exactly when we want
      // the activity gone.
      void liveActivity.stopFocus();
      sessionStorage.removeItem("dd_focus_active");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trackingCat = categories.find(c => c.id === tracking?.category_id);

  const complete = async () => {
    if (!block || !user) return;
    haptics.notify("success");
    setShowCheck(true);
    // Wall-clock from when the Focus session timer armed → now (in-app countdown).
    const actualSec = actualStartMsRef.current
      ? Math.max(0, Math.round((Date.now() - actualStartMsRef.current) / 1000))
      : 0;
    const completedAtMs = Date.now();
    const completedIso = new Date(completedAtMs).toISOString();
    // Stop linked tracker first so `actual_minutes` can be derived from time_entries.
    const hadTrackerForBlock = !!(startedHereRef.current && tracking);
    let trackerStopOk = true;
    if (hadTrackerForBlock) {
      try {
        trackerStopOk = (await stopTracking()) !== false;
      } catch {
        trackerStopOk = false;
      }
      startedHereRef.current = false;
    }
    const patch: Record<string, unknown> = {
      completed: true,
      completed_at: completedIso,
      resolution: "done",
      resolved_at: completedIso,
    };
    if (!hadTrackerForBlock) {
      const fromArm = minutesFromFocusArmSeconds(actualSec);
      if (fromArm != null) patch.actual_minutes = fromArm;
      else {
        patch.actual_minutes = resolveActualMinutesOnComplete(
          entries,
          block.id,
          planDate || todayDateStr(),
          block.start_time,
          completedAtMs,
        );
      }
    } else {
      try {
        const { data: row } = await supabase.from("blocks").select("actual_minutes").eq("id", block.id).maybeSingle();
        const am = (row as { actual_minutes?: number | null } | null)?.actual_minutes;
        if (!trackerStopOk || typeof am !== "number" || am < 1) {
          const fromArm = minutesFromFocusArmSeconds(actualSec);
          patch.actual_minutes =
            fromArm ??
            resolveActualMinutesOnComplete(
              entries,
              block.id,
              planDate || todayDateStr(),
              block.start_time,
              completedAtMs,
            );
        }
      } catch {
        const fromArm = minutesFromFocusArmSeconds(actualSec);
        patch.actual_minutes = fromArm ?? null;
      }
    }
    const { error } = await supabase.from("blocks").update(patch as never).eq("id", block.id);
    if (error) {
      setShowCheck(false);
      toast.error("Unable to save. Please try again.");
      return;
    }
    try { localStorage.setItem(`dd_last_plan_progress_${planDate || todayDateStr()}`, new Date().toISOString()); } catch {/* ignore */}
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
    if (startedHereRef.current && tracking) {
      const entryId = tracking.id;
      try {
        await supabase.from("time_entries").delete().eq("id", entryId);
        await refreshTracker();
      } catch {/* ignore */}
      startedHereRef.current = false;
    }
    const resolvedIso = new Date().toISOString();
    try {
      await supabase
        .from("blocks")
        .update({ resolution: "skipped", resolved_at: resolvedIso, completed: false })
        .eq("id", block.id);
    } catch {
      toast.error("Could not save skip");
      return;
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
      const entryId = tracking.id;
      try {
        await supabase.from("time_entries").delete().eq("id", entryId);
        await refreshTracker();
      } catch {/* ignore */}
      startedHereRef.current = false;
    }
    const backPlan =
      planDate && planDate !== todayDateStr() ? `/today/plan?date=${planDate}` : "/today/plan";
    nav(backPlan);
  };

  // Start the Focus Live Activity (Dynamic Island + Lock Screen) once the
  // session is armed. The native timer counts up from the same wall-clock the
  // big ring uses, so the two never drift. iOS-only; a no-op everywhere else.
  useEffect(() => {
    if (!armed || !block || oneThingMode) return;
    if (focusLAStartedRef.current) return;
    focusLAStartedRef.current = true;
    void liveActivity.startFocus({
      taskTitle: block.title,
      plannedMinutes: block.duration_min,
      blockId: block.id,
      nextTaskTitle: next?.title,
      startedAt: actualStartMsRef.current ?? Date.now(),
    });
  }, [armed, block?.id, oneThingMode]);

  // Deep-link "Mark done" from the Live Activity lands here as ?complete=1.
  // Fire the normal completion path exactly once, after the block is loaded
  // and armed so all the same side-effects (tracker stop, actual_minutes,
  // navigation) run identically to tapping Done in-app.
  useEffect(() => {
    if (autoCompletedRef.current) return;
    if (!armed || !block) return;
    if (searchParams.get("complete") !== "1") return;
    autoCompletedRef.current = true;
    void complete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, block?.id, searchParams]);

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

  void sessionTick;
  const focusElapsedSec = actualStartMsRef.current
    ? Math.max(0, Math.floor((Date.now() - actualStartMsRef.current) / 1000))
    : 0;
  const oneThingElapsedSec = focusElapsedSec;
  const trackingThisBlock = !!(tracking && block && tracking.block_id === block.id);
  // The big ring should reflect the *tracker* when it's actually attributing
  // time to a category. With no tracker running, it falls back to a plain
  // wall-clock since-arm count (which doesn't persist to time_entries).
  const ringElapsedSec = trackingThisBlock ? elapsedSec : focusElapsedSec;
  const assignedCatIdForBlock = block ? getAssignedCategoryId(block.id) : null;
  const fmtDur = (m: number) =>
    m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;

  const RING_R = 100;
  const RING_CIRC = 2 * Math.PI * RING_R;
  const plannedSec = block.duration_min * 60;
  const progressRatio = plannedSec > 0 ? Math.min(1, ringElapsedSec / plannedSec) : 0;
  const isOverTime = ringElapsedSec > 0 && ringElapsedSec > plannedSec;

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
          <div className="mt-8 text-[44px] font-mono-sf tabular-nums text-cyan-200 leading-none">
            {fmtHMS(oneThingElapsedSec)}
          </div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500 mt-3">
            Session time · planned window to {fmtTime(blockSlotEndHHMM(block))}
          </div>
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

  return (
    <div className="absolute inset-0 w-full h-[100dvh] bg-background overflow-hidden flex flex-col items-center justify-between pb-[env(safe-area-inset-bottom)] pt-[var(--safe-area-inset-top)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[160px]" style={{ background: "var(--gradient-glow)" }} />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 h-[250px] shell-glow-floor opacity-50" />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", bounce: 0.2, duration: 0.7 }}
        className="relative w-full h-full max-w-[400px] flex flex-col items-center px-6 pt-8 pb-4 mx-auto"
      >
        {/* Cancel — top-left, returns to plan without altering anything */}
        <button
          onClick={() => (startedHereRef.current && tracking) ? setConfirmCancelOpen(true) : cancel()}
          className="absolute top-2 left-4 h-11 w-11 z-50 rounded-full border border-soft bg-background/70 backdrop-blur-md flex items-center justify-center text-secondary-fg hover:text-foreground pressable shadow-card"
          aria-label="Cancel focus session"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="px-4 py-1.5 mt-2 rounded-full bg-primary/10 border border-primary/30 text-[10px] tracking-[0.2em] text-primary font-bold uppercase shadow-[0_0_12px_hsl(var(--primary)/0.25)] shrink-0">Focus</div>
        {/* Tracking pill removed — the main timer + the inline "Stop tracking"
            button below already convey state. Two timers on one screen was
            redundant and confusing. */}

        <h1 className="mt-4 font-display text-[26px] font-semibold text-center leading-[1.15] max-w-[310px] line-clamp-3 text-balance tracking-[-0.02em]">{block.title}</h1>
        {(lateDeepWork || longSession) && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-soft surface-soft text-[11px] text-secondary-fg">
            <ShieldAlert className="h-3.5 w-3.5 text-primary" />
            {lateDeepWork ? "Late-day guardrail: one priority, then wind down." : "Guardrail: take a short reset right after this block."}
          </div>
        )}

        {/* Circular ring timer */}
        <div className="relative mt-6 flex flex-col items-center">
          <div className="relative h-[240px] w-[240px] flex items-center justify-center" style={{ transformStyle: "preserve-3d" }}>
            {showCheck ? (
              <div className="absolute inset-0 flex items-center justify-center z-20">
                <div className="h-28 w-28 rounded-full bg-success flex items-center justify-center check-pop shadow-[0_12px_40px_-10px_hsl(var(--success)/0.55)]">
                  <Check className="h-14 w-14 text-success-foreground" strokeWidth={2.75} />
                </div>
              </div>
            ) : (
              <>
                {/* Isometric 3D Ring Stack */}
                <div className="absolute inset-0 pointer-events-none" style={{ transformStyle: "preserve-3d", transform: "rotateX(55deg)" }}>
                  {/* Ambient glow behind ring — bumped opacity so it actually
                      reads on light backgrounds (was 0.15, vanished on paper). */}
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      transform: "translateZ(-40px)",
                      background: isOverTime
                        ? "radial-gradient(circle, hsl(var(--destructive)/0.22) 0%, transparent 72%)"
                        : "radial-gradient(circle, hsl(var(--primary)/0.24) 0%, transparent 72%)",
                    }}
                  />
                  {[0, 10, 20, 30].map((z, i) => (
                    <svg key={i} className="absolute inset-0 w-full h-full -rotate-90" style={{ transform: `translateZ(-${z}px)`, opacity: 1 - (i * 0.2) }} viewBox="0 0 240 240">
                      {/* Track — themed via .ring-track in index.css (light mode
                          uses a measurably darker stroke so the ring stays
                          visible on the off-white canvas). */}
                      <circle cx="120" cy="120" r={RING_R} fill="none" className="ring-track" strokeWidth="9" />
                      {/* Progress fill - only on top layer */}
                      {i === 0 && (
                        <circle
                          cx="120" cy="120" r={RING_R}
                          fill="none"
                          stroke={isOverTime ? "hsl(var(--destructive))" : "hsl(var(--primary))"}
                          strokeWidth="9"
                          strokeLinecap="round"
                          strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
                          strokeDashoffset={RING_CIRC * (1 - progressRatio)}
                          className={isOverTime ? "focus-timer-overtime" : "focus-timer-ring-active"}
                          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1), stroke 0.4s ease" }}
                        />
                      )}
                    </svg>
                  ))}
                </div>

                {/* Center content (Flat, floating above the isometric rings) */}
                <div className="relative z-10 flex flex-col items-center justify-center" style={{ transform: "translateZ(60px)" }}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/55 inline-flex items-center gap-1">
                    {trackingThisBlock && trackingCat ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: trackingCat.color }} aria-hidden />
                        {trackingCat.name}
                      </>
                    ) : isOverTime ? (
                      "overtime"
                    ) : (
                      "elapsed"
                    )}
                  </div>
                  <div className={`text-[46px] font-mono-sf font-semibold tabular-nums leading-none mt-1.5 ${isOverTime ? "text-destructive" : "text-foreground"}`}>
                    {fmtHMS(ringElapsedSec)}
                  </div>
                  <div className="text-[12px] text-secondary-fg/60 mt-2">
                    of {fmtDur(block.duration_min)}
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Stop-tracking control */}
          {armed && trackingThisBlock && trackingCat && (
            <button
              type="button"
              onClick={() => { stopTracking(); startedHereRef.current = false; }}
              className="mt-4 flex items-center gap-1 mx-auto rounded-full border border-soft bg-background/70 px-3 py-1.5 text-[11px] font-medium text-secondary-fg pressable hover:text-foreground"
            >
              <Square className="h-3 w-3" /> Stop tracking
            </button>
          )}
        </div>

        <div className="mt-5 w-full max-w-[320px] space-y-2">
          <button
            type="button"
            onClick={() => void complete()}
            className="w-full flex h-14 items-center justify-center gap-2 rounded-[18px] bg-primary text-[17px] font-semibold text-primary-foreground pressable shadow-[0_0_28px_-4px_hsl(var(--primary)/0.5)]"
          >
            <Check className="h-5 w-5 shrink-0" strokeWidth={2.75} />
            Done
          </button>
          <button
            type="button"
            onClick={() => setConfirmSkipOpen(true)}
            className="w-full flex h-12 items-center justify-center rounded-[18px] border border-soft bg-card text-[14px] font-medium text-secondary-fg pressable hover:text-foreground hover:bg-muted/40 transition-colors shadow-card"
          >
            Skip
          </button>
        </div>
        {/* Decision prompt when this block has no tracker category yet and
            the user hasn't opted out for this session. Two clear paths so
            the user is never silently un-tracked. */}
        {!trackingThisBlock && armed && !assignedCatIdForBlock && !trackerSkipped && (
          <div className="mt-6 w-full max-w-[320px] rounded-[28px] app-card p-5 space-y-4 shadow-lg border border-soft">
            <div className="flex items-start gap-3">
              <Timer className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="text-[13px] leading-snug text-foreground/90">
                Track this block's time? Pick a category to log it, or focus without saving.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Popover open={catPickerOpen} onOpenChange={(o) => { setCatPickerOpen(o); if (!o) setNewFocusCatName(""); }}>
                <PopoverTrigger asChild>
                  <button className="h-11 rounded-[14px] bg-primary/15 border border-primary/30 text-primary text-[14px] font-bold pressable hover:bg-primary/20 transition-colors">
                    Pick category
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-3" align="center">
                  <div className="text-[10px] uppercase tracking-wider text-secondary-fg px-1 pb-2">Pick a category</div>
                  <div className="max-h-48 space-y-0.5 overflow-y-auto pr-0.5">
                    {categories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          startedHereRef.current = true;
                          void startTracking(c.id, { source: "focus", blockId: block.id, note: block.title });
                          setCatPickerOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground pressable hover:bg-muted"
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                        <span className="flex-1 truncate">{c.name}</span>
                      </button>
                    ))}
                    {categories.length === 0 && (
                      <p className="px-1 py-2 text-[12px] leading-snug text-secondary-fg">No categories yet. Create one below.</p>
                    )}
                  </div>
                  <form
                    className="mt-3 flex flex-col gap-2 border-t border-border/40 pt-3"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const name = newFocusCatName.trim();
                      if (!name) return;
                      const c = await addCategory(name);
                      if (!c) return;
                      startedHereRef.current = true;
                      await startTracking(c.id, { source: "focus", blockId: block.id, note: block.title });
                      setNewFocusCatName("");
                      setCatPickerOpen(false);
                    }}
                  >
                    <Input
                      value={newFocusCatName}
                      onChange={(e) => setNewFocusCatName(e.target.value)}
                      placeholder="New category name"
                      className="h-10 text-[13px]"
                    />
                    <button
                      type="submit"
                      disabled={!newFocusCatName.trim()}
                      className="h-10 w-full rounded-xl bg-primary text-[13px] font-semibold text-primary-foreground pressable disabled:opacity-45"
                    >
                      Add and start
                    </button>
                  </form>
                </PopoverContent>
              </Popover>
              <button
                type="button"
                onClick={() => { setTrackerSkipped(true); haptics.selection(); }}
                className="h-11 rounded-[14px] border border-soft surface-soft text-secondary-fg text-[13px] font-medium pressable hover:text-foreground transition-colors"
              >
                Focus without tracking
              </button>
            </div>
          </div>
        )}

        {/* Quiet "add tracker" button after the user opted to skip — non-blocking,
            in case they change their mind mid-session. */}
        {!trackingThisBlock && armed && !assignedCatIdForBlock && trackerSkipped && (
          <Popover open={catPickerOpen} onOpenChange={(o) => { setCatPickerOpen(o); if (!o) setNewFocusCatName(""); }}>
            <PopoverTrigger asChild>
              <button className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-border/45 bg-card/60 text-[12px] font-medium text-secondary-fg hover:text-foreground hover:border-border/65 pressable transition-colors">
                <Timer className="h-3.5 w-3.5" /> Start tracking
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-3" align="center">
              <div className="text-[10px] uppercase tracking-wider text-secondary-fg px-1 pb-2">Pick a category</div>
              <div className="max-h-48 space-y-0.5 overflow-y-auto pr-0.5">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      startedHereRef.current = true;
                      void startTracking(c.id, { source: "focus", blockId: block.id, note: block.title });
                      setCatPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground pressable hover:bg-muted"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="flex-1 truncate">{c.name}</span>
                  </button>
                ))}
                {categories.length === 0 && (
                  <p className="px-1 py-2 text-[12px] leading-snug text-secondary-fg">Create a category below, then time links to this task.</p>
                )}
              </div>
              <form
                className="mt-3 flex flex-col gap-2 border-t border-border/40 pt-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = newFocusCatName.trim();
                  if (!name) return;
                  const c = await addCategory(name);
                  if (!c) return;
                  startedHereRef.current = true;
                  await startTracking(c.id, { source: "focus", blockId: block.id, note: block.title });
                  setNewFocusCatName("");
                  setCatPickerOpen(false);
                }}
              >
                <Input
                  value={newFocusCatName}
                  onChange={(e) => setNewFocusCatName(e.target.value)}
                  placeholder="New category name"
                  className="h-10 text-[13px]"
                />
                <button
                  type="submit"
                  disabled={!newFocusCatName.trim()}
                  className="h-10 w-full rounded-xl bg-primary text-[13px] font-semibold text-primary-foreground pressable disabled:opacity-45"
                >
                  Add category and start
                </button>
              </form>
            </PopoverContent>
          </Popover>
        )}
        <div className="mt-auto pt-8 text-center px-2">
          <p className="text-[13px] text-secondary-fg/80 leading-relaxed">
            {next ? (
              <>Next up: <span className="text-foreground font-medium">{next.title}</span></>
            ) : block.kind === "task" ? (
              "Last block — finish strong."
            ) : block.kind === "lunch" ? (
              "Enjoy your lunch."
            ) : (
              "Take a real break."
            )}
          </p>
        </div>

      </motion.div>
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
              &quot;{block?.title}&quot; will be marked skipped (cleared from your plate). Any tracker time started here is dropped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
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
