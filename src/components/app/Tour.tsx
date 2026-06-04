import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode, useLayoutEffect, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useProfile } from "@/hooks/useProfile";

const LazyTourOverlay = lazy(() => import("./TourOverlay"));

export type TourStep = {
  id: string;
  selector: string; // CSS selector for the target
  title: string;
  body: string;
  placement?: "top" | "bottom" | "auto";
};

export type TourFlow = {
  /** Stable key stored in profile.tour_seen */
  key: string;
  steps: TourStep[];
};

type Ctx = {
  start: (flow: TourFlow, opts?: { force?: boolean }) => void;
  stop: () => void;
  resetAll: () => Promise<void>;
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

  // Reset scroll flag when step changes
  useEffect(() => { setScrolled(false); }, [step?.id]);

  // Auto-skip a step if its target never appears. Use a longer window so first-load
  // (lazy chunks, fonts, layout settle) doesn't race past valid targets.
  useEffect(() => {
    if (!step) return;
    const t = setTimeout(() => {
      const el = document.querySelector(step.selector);
      if (!el) {
        setStepIndex(i => (flow && i < flow.steps.length - 1 ? i + 1 : i));
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [step?.id, flow]);

  // Re-measure 200ms after step changes (give DOM time to settle)
  useEffect(() => {
    if (!step) return;
    const t = setTimeout(() => setTick(v => v + 1), 200);
    return () => clearTimeout(t);
  }, [step?.id]);

  const markSeen = useCallback(async (key: string) => {
    const next = { ...(profile?.tour_seen || {}), [key]: true };
    await update({ tour_seen: next });
  }, [profile?.tour_seen, update]);

  const stop = useCallback(() => {
    if (flow) markSeen(flow.key);
    setFlow(null);
    setStepIndex(0);
    setRect(null);
  }, [flow, markSeen]);

  const next = useCallback(() => {
    if (!flow) return;
    if (stepIndex >= flow.steps.length - 1) { stop(); return; }
    setStepIndex(i => i + 1);
  }, [flow, stepIndex, stop]);

  const start: Ctx["start"] = useCallback((f, opts) => {
    if (!opts?.force && profile?.tour_seen?.[f.key]) return;
    // Idempotent: if the same flow is already running (started by a previous
    // call), don't reset stepIndex back to 0. Without this, the auto-start
    // effect in consumers (Home) could rewind the user every time it re-ran.
    if (flow?.key === f.key && !opts?.force) return;
    setFlow(f);
    setStepIndex(0);
  }, [profile?.tour_seen, flow?.key]);

  const resetAll = useCallback(async () => {
    await update({ tour_seen: {} });
  }, [update]);

  const value: Ctx = useMemo(
    () => ({ start, stop, resetAll, isActive: !!flow }),
    [start, stop, resetAll, flow],
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
              onNext={next}
              onSkip={stop}
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

export const TOUR_TODAY: TourFlow = {
  key: "today",
  steps: [
    {
      id: "tracker",
      selector: "[data-tour='hero-tracker']",
      title: "Track your time",
      body: "Pick a category and tap Start. Your running session and today's total live here — open Plan to add a structured schedule.",
      placement: "bottom",
    },
  ],
};

export const TOUR_DAYVIEW: TourFlow = {
  key: "dayview",
  steps: [
    {
      id: "block",
      selector: "[data-tour='dayview-block']",
      title: "Focus mode",
      body: "Tap any task to enter Focus — start working, track time automatically, and mark it done when finished.",
      placement: "bottom",
    },
    {
      id: "complete",
      selector: "[data-tour='dayview-complete']",
      title: "Mark done",
      body: "Tap the circle to check a task off. It's marked done right where it is — a clear record of what you've finished today.",
      placement: "bottom",
    },
  ],
};

export const TOUR_REPORTS: TourFlow = {
  key: "reports",
  steps: [
    {
      id: "summary",
      selector: "[data-tour='reports-summary']",
      title: "Your time summary",
      body: "See total tracked time and earnings broken down by category. Switch between day, week, and month. Pro unlocks PDF and CSV export.",
      placement: "bottom",
    },
  ],
};