import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode, useLayoutEffect, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useProfile } from "@/hooks/useProfile";

const LazyTourOverlay = lazy(() => import("./TourOverlay"));

export type TourStep = {
  id: string;
  selector: string; // CSS selector for the target
  title?: string;
  body?: string;
  placement?: "top" | "bottom" | "auto" | "center";
  advance?: "next-button" | "click-target" | "auto-delay" | "dom-mutation" | "navigate";
  autoDelayMs?: number;
  nextWaitSelector?: string;
  nextWaitPath?: string;
  buttonLabel?: string;
  silent?: boolean;
};

export type TourFlow = {
  /** Stable key stored in profile.tour_seen */
  key: string;
  steps: TourStep[];
};

type Ctx = {
  start: (flow: TourFlow, opts?: { force?: boolean }) => void;
  stop: (clearData?: boolean) => void;
  resetAll: () => Promise<void>;
  hasSeen: (key: string) => boolean;
  /** True while a tour flow is actively running (overlay is on screen). */
  isActive: boolean;
};

const TourCtx = createContext<Ctx | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const { profile, update } = useProfile();
  const [flow, setFlow] = useState<TourFlow | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [tick, setTick] = useState(0); // re-measure trigger
  const [scrolled, setScrolled] = useState(false); // ensure we only auto-scroll once per step

  const step = flow?.steps[stepIndex] || null;

  const [isStuck, setIsStuck] = useState(false);
  
  // Track seen tours synchronously to prevent restart loops before DB updates
  const localSeen = useRef<Record<string, boolean>>({});

  const hasSeen = useCallback((key: string) => {
    return !!(localSeen.current[key] || profile?.tour_seen?.[key]);
  }, [profile?.tour_seen]);

  // Measure target on step change / window resize / scroll
  useLayoutEffect(() => {
    if (!step) { setRect(null); return; }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      // Scroll into view once per step if off-screen, then measure regardless
      if (!scrolled && (r.top < 60 || r.bottom > window.innerHeight - 220)) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setScrolled(true);
        raf = window.setTimeout(() => setTick(t => t + 1), 350) as unknown as number;
        return;
      }
      setRect(r);
    };
    measure();
    const onResize = () => setTick(t => t + 1);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      if (raf) clearTimeout(raf);
    };
  }, [step?.selector, tick, scrolled]);

  // Reset scroll and stuck flag when step changes
  useEffect(() => { 
    setScrolled(false); 
    setIsStuck(false); 
  }, [step?.id]);

  // Advance logic & auto-skip (stuck)
  useEffect(() => {
    if (!step) return;

    let timeoutId: number;
    let stuckId: number;
    let observer: MutationObserver;
    let intervalId: number;

    const doNext = () => setStepIndex(i => (flow && i < flow.steps.length - 1 ? i + 1 : i));

    // Target missing timeout (first load / missing elements).
    // Increased to 8s to prevent premature skips on slow networks/renders.
    const t = setTimeout(() => {
      const el = document.querySelector(step.selector);
      if (!el) doNext();
    }, 8000);

    // If waiting for user action (click/mutation), set stuck after 15s
    if (step.advance === "click-target" || step.advance === "dom-mutation" || step.advance === "navigate") {
      stuckId = window.setTimeout(() => setIsStuck(true), 15000);
    }

    if (step.advance === "auto-delay" && step.autoDelayMs) {
      timeoutId = window.setTimeout(doNext, step.autoDelayMs);
    } else if (step.advance === "navigate" && step.nextWaitPath) {
      intervalId = window.setInterval(() => {
        if (window.location.pathname.includes(step.nextWaitPath!)) {
          doNext();
        }
      }, 100);
    } else if (step.advance === "dom-mutation" && step.nextWaitSelector) {
      observer = new MutationObserver(() => {
        if (document.querySelector(step.nextWaitSelector!)) {
          doNext();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      if (document.querySelector(step.nextWaitSelector)) doNext();
    } else if (step.advance === "click-target") {
      // For click-target, we advance on any click that hits the hole area,
      // but the hole is transparent so the actual app elements receive the click.
      const onClick = (e: MouseEvent) => {
        const el = document.querySelector(step.selector);
        if (el && el.contains(e.target as Node)) {
          // Add a tiny delay to allow the app to process the click first
          setTimeout(doNext, 50);
        }
      };
      document.addEventListener("click", onClick, true); // Capture phase
      return () => {
        clearTimeout(t);
        if (timeoutId) clearTimeout(timeoutId);
        if (stuckId) clearTimeout(stuckId);
        if (intervalId) clearInterval(intervalId);
        if (observer) observer.disconnect();
        document.removeEventListener("click", onClick, true);
      };
    }

    return () => {
      clearTimeout(t);
      if (timeoutId) clearTimeout(timeoutId);
      if (stuckId) clearTimeout(stuckId);
      if (intervalId) clearInterval(intervalId);
      if (observer) observer.disconnect();
    };
  }, [step, flow]);

  // Re-measure 200ms after step changes (give DOM time to settle)
  useEffect(() => {
    if (!step) return;
    const t = setTimeout(() => setTick(v => v + 1), 200);
    return () => clearTimeout(t);
  }, [step?.id]);

  const markSeen = useCallback(async (key: string) => {
    localSeen.current[key] = true;
    const next = { ...(profile?.tour_seen || {}), [key]: true };
    await update({ tour_seen: next });
  }, [profile?.tour_seen, update]);

  const stop = useCallback((clearData?: boolean) => {
    if (clearData) {
      window.dispatchEvent(new CustomEvent("tour-sandbox-clear"));
    }
    if (flow) markSeen(flow.key);
    setFlow(null);
    setStepIndex(0);
    setRect(null);
  }, [flow, markSeen]);

  const next = useCallback((clearData?: boolean) => {
    if (!flow) return;
    if (stepIndex >= flow.steps.length - 1) { 
      stop(clearData); 
      return; 
    }
    setStepIndex(i => i + 1);
  }, [flow, stepIndex, stop]);

  const start: Ctx["start"] = useCallback((f, opts) => {
    if (!opts?.force && hasSeen(f.key)) return;
    // Idempotent: if the same flow is already running (started by a previous
    // call), don't reset stepIndex back to 0. Without this, the auto-start
    // effect in consumers (Home) could rewind the user every time it re-ran.
    if (flow?.key === f.key && !opts?.force) return;
    setFlow(f);
    setStepIndex(0);
  }, [hasSeen, flow?.key]);

  const resetAll = useCallback(async () => {
    await update({ tour_seen: {} });
  }, [update]);

  const value: Ctx = useMemo(
    () => ({ start, stop, resetAll, hasSeen, isActive: !!flow }),
    [start, stop, resetAll, hasSeen, flow],
  );

  return (
    <TourCtx.Provider value={value}>
      {children}
      {step &&
        rect &&
        createPortal(
          <Suspense fallback={null}>
            <LazyTourOverlay
              rect={rect}
              step={step}
              index={stepIndex}
              total={flow!.steps.length}
              onNext={(clearData) => next(clearData)}
              onSkip={stop}
              isStuck={isStuck}
            />
          </Suspense>,
          document.body,
        )}
    </TourCtx.Provider>
  );
}

export function useTour() {
  const ctx = useContext(TourCtx);
  if (!ctx) throw new Error("useTour must be used inside TourProvider");
  return ctx;
}

// ============ Predefined flows ============

export const TOUR_SANDBOX: TourFlow = {
  key: "sandbox",
  steps: [
    // ── Chapter 1: Welcome (Home — the default page) ──────────────
    {
      id: "welcome",
      selector: "body",
      title: "Welcome to DayDraft!",
      body: "Let's learn how to plan your day. We'll walk through the main features together.",
      placement: "center",
      advance: "next-button",
      buttonLabel: "Start tour",
    },

    // ── Chapter 2: Tracker (Home) ─────────────────────────────────
    {
      id: "tracker-hero",
      selector: "[data-tour='hero-tracker']",
      title: "Time Tracker",
      body: "This is the heart of DayDraft — track time across your projects and categories.",
      placement: "bottom",
    },
    {
      id: "start-tracking",
      selector: ".tracker-start-btn",
      title: "Start Tracking",
      body: "Tap Start to launch the timer. It will ask for a category if you don't have one.",
      placement: "bottom",
      advance: "click-target",
    },
    {
      id: "tracker-running",
      selector: ".tracker-stop-btn",
      title: "Timer is running!",
      body: "The timer is now ticking. DayDraft tracks your time automatically, even in the background.",
      placement: "bottom",
      advance: "auto-delay",
      autoDelayMs: 3500,
    },
    {
      id: "stop-tracking",
      selector: ".tracker-stop-btn",
      title: "Stop when done",
      body: "Tap Stop to end the session. Your time is logged automatically.",
      placement: "bottom",
      advance: "click-target",
    },

    // ── Chapter 3: Planning (Today — Timeline) ────────────────────
    {
      id: "go-to-plan",
      selector: "[data-tour='tab-today']",
      title: "Timeline View",
      body: "Now let's see where your time-blocked tasks live. Tap the Plan tab.",
      placement: "top",
      advance: "click-target",
    },
    {
      id: "plan-arrived",
      selector: "body",
      title: "",
      body: "",
      advance: "navigate",
      nextWaitPath: "/today",
      silent: true,
    },
    {
      id: "add-tasks-btn",
      selector: ".add-tasks-btn",
      title: "Add tasks",
      body: "Build your plan here. Tap to add tasks — type them out, paste a list, or let AI do the work.",
      placement: "top",
      advance: "click-target",
    },
    {
      id: "composer-wait",
      selector: "body",
      title: "",
      body: "",
      advance: "dom-mutation",
      nextWaitSelector: ".app-card",
      silent: true,
    },
    {
      id: "timeline-block",
      selector: ".app-card",
      title: "Your plan is ready!",
      body: "AI automatically placed your tasks on the timeline. Long-press to drag and reorder them.",
      placement: "top",
    },
    {
      id: "block-tap",
      selector: ".app-card",
      title: "Task details",
      body: "Tap on a task to expand it — you'll find duration, reminders, AI assist and more.",
      placement: "top",
      advance: "click-target",
    },
    {
      id: "block-sheet-wait",
      selector: "body",
      title: "",
      body: "",
      advance: "dom-mutation",
      nextWaitSelector: ".block-action-ai-btn",
      silent: true,
    },
    {
      id: "ask-ai-feature",
      selector: ".block-action-ai-btn",
      title: "Ask AI",
      body: "This button lets AI break down complex tasks into subtasks or give time estimates. Try it later!",
      placement: "top",
    },

    // ── Chapter 4: Mass Actions (Today) ───────────────────────────
    {
      id: "more-menu",
      selector: ".more-menu-btn",
      title: "Mass Actions",
      body: "The '⋯' menu hides powerful operations. Tap to see what's inside.",
      placement: "bottom",
      advance: "click-target",
    },
    {
      id: "more-actions-info",
      selector: ".more-menu-content",
      title: "Carry unfinished tasks",
      body: "Copy your plan as text, select multiple items, or carry all unfinished tasks to tomorrow with one tap.",
      placement: "bottom",
    },

    // ── Chapter 5: Checklist (Today) ──────────────────────────────
    {
      id: "checklist-pill",
      selector: "[data-tour='checklist-pill']",
      title: "Checklist Mode",
      body: "Not every task needs a specific time. Switch to Checklist for flexible, untimed lists.",
      placement: "bottom",
      advance: "click-target",
    },
    {
      id: "add-list",
      selector: ".checklist-add-list-btn",
      title: "Create a list",
      body: "Tap here to create your first category, like 'Groceries' or 'Ideas'.",
      placement: "top",
      advance: "click-target",
    },
    {
      id: "add-item-wait",
      selector: "body",
      title: "",
      body: "",
      advance: "dom-mutation",
      nextWaitSelector: ".checklist-add-item-input",
      silent: true,
    },
    {
      id: "checklist-item",
      selector: ".checklist-add-item-input",
      title: "Add items",
      body: "Type tasks directly into the list. Tip: Tap on a task later to reschedule it to another day.",
      placement: "top",
    },

    // ── Chapter 6: Reports ────────────────────────────────────────
    {
      id: "go-to-reports",
      selector: "[data-tour='tab-reports']",
      title: "Analytics",
      body: "Let's see your statistics. Head to the Reports tab.",
      placement: "top",
      advance: "click-target",
    },
    {
      id: "reports-arrived",
      selector: "body",
      title: "",
      body: "",
      advance: "navigate",
      nextWaitPath: "/reports",
      silent: true,
    },
    {
      id: "reports-period",
      selector: ".reports-period-tabs",
      title: "Periods and Filters",
      body: "Switch between Day, Week, and Month. Pro users can also export PDF/CSV reports here.",
      placement: "bottom",
    },

    // ── Chapter 7: Settings ───────────────────────────────────────
    {
      id: "go-to-settings",
      selector: "[data-tour='tab-settings']",
      title: "Personalization",
      body: "Finally, let's open Settings.",
      placement: "top",
      advance: "click-target",
    },
    {
      id: "settings-arrived",
      selector: "body",
      title: "",
      body: "",
      advance: "navigate",
      nextWaitPath: "/settings",
      silent: true,
    },
    {
      id: "settings-appearance",
      selector: ".settings-appearance",
      title: "Your Style",
      body: "Customize the theme (Light/Dark) and visual mode (Standard or Neon).",
      placement: "bottom",
    },
    {
      id: "settings-replay",
      selector: ".settings-replay-btn",
      title: "Replay Tutorial",
      body: "You can always replay this tutorial from here if you need a refresher.",
      placement: "bottom",
    },
    {
      id: "finish",
      selector: "body",
      title: "You're all set! 🎉",
      body: "You've mastered the essentials of DayDraft. Have a productive day!",
      placement: "center",
      buttonLabel: "Got it",
    },
  ],
};