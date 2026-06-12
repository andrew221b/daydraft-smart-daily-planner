import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode, useLayoutEffect, useRef, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { useProfile } from "@/hooks/useProfile";

const LazyTourOverlay = lazy(() => import("./TourOverlay"));

export type TourStep = {
  id: string;
  selector: string; // CSS selector for the target
  /** Short chapter label shown as the tooltip eyebrow (replaces "Step X of Y"). */
  chapter?: string;
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
  // Safety net: if a non-center step's target can't be found within a grace
  // window, show the tooltip CENTERED (no spotlight) instead of a blank
  // screen. All real steps target guaranteed-present elements, so this only
  // fires if something unexpected is missing.
  const [missingCenter, setMissingCenter] = useState(false);
  
  // Track seen tours synchronously to prevent restart loops before DB updates
  const localSeen = useRef<Record<string, boolean>>({});

  const hasSeen = useCallback((key: string) => {
    return !!(localSeen.current[key] || profile?.tour_seen?.[key]);
  }, [profile?.tour_seen]);

  // Measure target on step change / resize / scroll.
  //
  // Jitter fix: the old version pumped setTick on every scroll/resize event
  // (capture phase, every scroll container) AND used smooth scrollIntoView —
  // a smooth scroll fires a *stream* of scroll events, each forcing a full
  // re-measure + re-render, so the spotlight + tooltip vibrated across the
  // screen. Now we (1) scroll instantly, (2) coalesce every re-measure into a
  // single rAF, and (3) only commit a new rect when it actually moved by >0.5px
  // (diff-guard), so a stable target never triggers a render at all.
  useLayoutEffect(() => {
    if (!step) { setRect(null); return; }
    let cancelled = false;
    let settleRaf = 0;

    const isCenter = step.placement === "center" || step.selector === "body";

    const commit = (r: DOMRect | null) => {
      if (cancelled) return;
      if (!r || (r.width === 0 && r.height === 0)) { setRect(null); return; }
      setRect((prev) => {
        if (
          prev &&
          Math.abs(prev.top - r.top) < 0.5 &&
          Math.abs(prev.left - r.left) < 0.5 &&
          Math.abs(prev.width - r.width) < 0.5 &&
          Math.abs(prev.height - r.height) < 0.5
        ) {
          return prev; // unchanged — no re-render, no jitter
        }
        return r;
      });
    };

    const read = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      commit(el ? el.getBoundingClientRect() : null);
    };

    const measure = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      if (isCenter) { commit(r); return; }
      // Scroll into view once per step if off-screen — INSTANT, not smooth, so
      // it can't spawn a scroll-event storm. Re-read after two frames once the
      // new scroll position has settled.
      if (!scrolled && (r.top < 80 || r.bottom > window.innerHeight - 240)) {
        el.scrollIntoView({ behavior: "auto", block: "center" });
        setScrolled(true);
        settleRaf = requestAnimationFrame(() => requestAnimationFrame(read));
        return;
      }
      commit(r);
    };

    measure();

    // Coalesce scroll/resize into one read per frame.
    let scheduled = false;
    const schedule = () => {
      if (scheduled || cancelled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; read(); });
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (settleRaf) cancelAnimationFrame(settleRaf);
    };
  }, [step?.selector, step?.placement, tick, scrolled]);

  // Late-mounting targets (just navigated, tab/sheet still rendering): watch
  // for the selector to appear instead of polling, then trigger one measure.
  // Disconnects the moment we have a rect, so it never runs in steady state.
  useEffect(() => {
    if (!step || rect || step.selector === "body") return;
    let raf = 0;
    const obs = new MutationObserver(() => {
      if (document.querySelector(step.selector)) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => setTick((t) => t + 1));
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => { obs.disconnect(); cancelAnimationFrame(raf); };
  }, [step?.id, rect, step?.selector]);

  // Reset scroll and stuck flag when step changes
  useEffect(() => {
    setScrolled(false);
    setIsStuck(false);
  }, [step?.id]);

  // Center-fallback driver: arm a grace timer whenever a non-center, non-silent
  // step has no measured rect. If the target is still missing when it fires,
  // flip to centered mode so the copy is shown rather than a black void. Clears
  // the moment a rect arrives (target mounted) or the step changes.
  useEffect(() => {
    setMissingCenter(false);
    if (!step || step.silent || step.placement === "center") return;
    if (rect) return;
    const id = window.setTimeout(() => setMissingCenter(true), 1100);
    return () => clearTimeout(id);
  }, [step?.id, step?.silent, step?.placement, rect]);

  // Advance logic & auto-skip (stuck)
  useEffect(() => {
    if (!step) return;

    let timeoutId: number;
    let stuckId: number;
    let observer: MutationObserver;
    let intervalId: number;

    const doNext = () => setStepIndex(i => (flow && i < flow.steps.length - 1 ? i + 1 : i));

    // Target-missing timeout. Only auto-skip steps that the user can't dismiss
    // themselves (navigation / action waits). A `next-button` step keeps its
    // tooltip and falls back to centre (see the center-fallback effect) if its
    // target never appears, so it must NOT auto-skip out from under the user.
    let t: number | undefined;
    if (step.advance !== "next-button") {
      t = window.setTimeout(() => {
        if (!document.querySelector(step.selector)) doNext();
      }, 8000);
    }

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
        (rect || (missingCenter && !step.silent)) &&
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
              centerFallback={!rect && missingCenter}
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
  // A guided walk through all four tabs, designed for a BRAND-NEW user with
  // zero data. We *navigate* by hand (tap the real tab to advance) and only
  // spotlight controls that are GUARANTEED to be on screen for an empty
  // account — verified against the render conditions:
  //   • hero-tracker / tracker-start ......... always on the Track tab (not tracking)
  //   • add-tasks-btn ........................ the empty-day empty-state button
  //   • checklist-pill (PlanModePill) ........ "always visible in both modes"
  //   • reports-summary / reports-period-tabs  render unconditionally (show 0m)
  //   • settings-appearance / replay-btn ..... always in Settings
  // The ⋯ "more-menu" button is intentionally NOT spotlit — it's hidden when
  // the plan is empty (planMissing), which is exactly a new user's state, so
  // it would black the screen. Its carry-forward power is taught in the
  // add-tasks copy instead. Explanatory steps use a Next button so the flow
  // can never dead-end; a center-fallback (in the provider) covers the rare
  // case of any target going missing.
  steps: [
    // ── Welcome ───────────────────────────────────────────────────
    {
      id: "welcome",
      selector: "body",
      chapter: "Welcome",
      title: "Welcome to DayDraft",
      body: "A quick tour of the four things that make DayDraft tick — tracking, planning, reports and settings. Skip or replay it anytime.",
      placement: "center",
      advance: "next-button",
      buttonLabel: "Take the tour",
    },

    // ── Track (Home — the tab we start on) ────────────────────────
    {
      id: "tracker-hero",
      selector: "[data-tour='hero-tracker']",
      chapter: "Track",
      title: "A timer that never loses count",
      body: "Home base. This timer keeps running through app-switches, a locked phone, even a reboot — and on iPhone it lives right on your Lock Screen and Dynamic Island, so you can stop it without opening the app.",
      placement: "bottom",
      advance: "next-button",
    },
    {
      id: "tracker-start",
      selector: ".tracker-start-btn",
      chapter: "Track",
      title: "Clock in, get paid",
      body: "Tap Start, tag the session with a category and an hourly rate, and DayDraft tallies your earnings as you work — per client, in any currency. No spreadsheets, no maths.",
      placement: "bottom",
      advance: "next-button",
    },

    // ── Plan (Today) ──────────────────────────────────────────────
    {
      id: "go-to-plan",
      selector: "[data-tour='tab-today']",
      chapter: "Plan",
      title: "Now let's plan",
      body: "Tap the Plan tab to open today's timeline.",
      placement: "top",
      advance: "click-target",
    },
    {
      id: "plan-arrived",
      selector: "body",
      advance: "navigate",
      nextWaitPath: "/today",
      silent: true,
    },
    {
      id: "add-tasks",
      selector: ".add-tasks-btn",
      chapter: "Plan",
      title: "Let AI plan your day",
      body: "Type a list, paste one from anywhere, or hand it to AI — it builds a realistic timeline around what's already locked in, with smart durations. Anything you don't finish rolls over to tomorrow in one tap.",
      placement: "auto",
      advance: "next-button",
    },
    {
      id: "checklist-pill",
      selector: "[data-tour='checklist-pill']",
      chapter: "Plan",
      title: "Timed or flexible",
      body: "Not everything needs a clock. Flip to Checklist for loose, untimed lists — groceries, ideas, errands — and drop any item onto your timeline whenever you're ready.",
      placement: "bottom",
      advance: "next-button",
    },

    // ── Reports ───────────────────────────────────────────────────
    {
      id: "go-to-reports",
      selector: "[data-tour='tab-reports']",
      chapter: "Reports",
      title: "See the payoff",
      body: "Now for the payoff — tap Reports to see where your hours and your earnings actually went.",
      placement: "top",
      advance: "click-target",
    },
    {
      id: "reports-arrived",
      selector: "body",
      advance: "navigate",
      nextWaitPath: "/reports",
      silent: true,
    },
    {
      id: "reports-summary",
      selector: "[data-tour='reports-summary']",
      chapter: "Reports",
      title: "Hours and income, side by side",
      body: "Every hour and every dollar for the period, split by category. Rates update live while past earnings stay locked to exactly what you billed — and Pro forecasts where you'll land by week or month end.",
      placement: "bottom",
      advance: "next-button",
    },
    {
      id: "reports-period",
      selector: ".reports-period-tabs",
      chapter: "Reports",
      title: "Slice it your way",
      body: "Switch between Day, Week and Month, filter by category, then export a billing-ready PDF or CSV with Pro.",
      placement: "bottom",
      advance: "next-button",
    },

    // ── Settings ──────────────────────────────────────────────────
    {
      id: "go-to-settings",
      selector: "[data-tour='tab-settings']",
      chapter: "Settings",
      title: "Make it yours",
      body: "Last stop — open Settings.",
      placement: "top",
      advance: "click-target",
    },
    {
      id: "settings-arrived",
      selector: "body",
      advance: "navigate",
      nextWaitPath: "/settings",
      silent: true,
    },
    {
      id: "settings-appearance",
      selector: ".settings-appearance",
      chapter: "Settings",
      title: "Make it yours",
      body: "Light, Dark or a neon accent theme — DayDraft adapts to match your vibe. Notifications and gentle daily nudges that keep your plan on track live here too.",
      placement: "bottom",
      advance: "next-button",
    },
    {
      id: "settings-replay",
      selector: ".settings-replay-btn",
      chapter: "Settings",
      title: "Replay anytime",
      body: "Want a refresher down the road? Replay this whole tour from right here.",
      placement: "bottom",
      advance: "next-button",
    },

    // ── Finish ────────────────────────────────────────────────────
    {
      id: "finish",
      selector: "body",
      chapter: "All set",
      title: "You're ready 🎉",
      body: "That's the grand tour. Plan boldly, track honestly, and have a genuinely good day.",
      placement: "center",
      advance: "next-button",
      buttonLabel: "Got it",
    },
  ],
};