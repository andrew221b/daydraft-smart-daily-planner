import { createContext, useContext, useEffect, useState, useCallback, ReactNode, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useProfile } from "@/hooks/useProfile";
import { X, ArrowRight } from "lucide-react";

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
};

const TourCtx = createContext<Ctx | null>(null);

const PADDING = 8; // spotlight padding around target

export function TourProvider({ children }: { children: ReactNode }) {
  const { profile, update } = useProfile();
  const [flow, setFlow] = useState<TourFlow | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [tick, setTick] = useState(0); // re-measure trigger

  const step = flow?.steps[stepIndex] || null;

  // Measure target on step change / window resize / scroll
  useLayoutEffect(() => {
    if (!step) { setRect(null); return; }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (!el) { setRect(null); return; }
      // Scroll into view if off-screen
      const r = el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > window.innerHeight - 200) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
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
  }, [step?.selector, tick]);

  // Re-measure 200ms after step changes (give DOM time to settle)
  useEffect(() => {
    if (!step) return;
    const t = setTimeout(() => setTick(v => v + 1), 200);
    return () => clearTimeout(t);
  }, [step?.id]);

  const markSeen = useCallback(async (key: string) => {
    const next = { ...(profile?.tour_seen || {}), [key]: true };
    await update({ tour_seen: next } as any);
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
    setFlow(f);
    setStepIndex(0);
  }, [profile?.tour_seen]);

  const resetAll = useCallback(async () => {
    await update({ tour_seen: {} } as any);
  }, [update]);

  const value: Ctx = { start, stop, resetAll };

  return (
    <TourCtx.Provider value={value}>
      {children}
      {step && rect && createPortal(<TourOverlay rect={rect} step={step} index={stepIndex} total={flow!.steps.length} onNext={next} onSkip={stop} />, document.body)}
    </TourCtx.Provider>
  );
}

function TourOverlay({ rect, step, index, total, onNext, onSkip }: {
  rect: DOMRect; step: TourStep; index: number; total: number;
  onNext: () => void; onSkip: () => void;
}) {
  const isLast = index === total - 1;
  const padX = PADDING, padY = PADDING;
  const x = Math.max(8, rect.left - padX);
  const y = Math.max(8, rect.top - padY);
  const w = rect.width + padX * 2;
  const h = rect.height + padY * 2;
  const radius = 16;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Decide tooltip placement: prefer below, fallback above if not enough room.
  const spaceBelow = vh - (y + h);
  const placeBelow = step.placement === "bottom" || (step.placement !== "top" && spaceBelow > 200);
  const tooltipTop = placeBelow ? y + h + 14 : Math.max(16, y - 14 - 180);

  // Center horizontally relative to spotlight, but clamp inside viewport (with margins).
  const tooltipWidth = Math.min(340, vw - 32);
  const targetCenter = x + w / 2;
  const tooltipLeft = Math.max(16, Math.min(vw - tooltipWidth - 16, targetCenter - tooltipWidth / 2));

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none" aria-live="polite">
      {/* Dim layer with cut-out using SVG mask */}
      <svg width="100%" height="100%" className="absolute inset-0 pointer-events-auto" onClick={onNext}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={x} y={y} width={w} height={h} rx={radius} ry={radius} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(5, 6, 18, 0.78)" mask="url(#tour-mask)" />
        {/* Glowing border around spotlight */}
        <rect
          x={x} y={y} width={w} height={h} rx={radius} ry={radius}
          fill="none"
          stroke="hsl(230 100% 71%)"
          strokeWidth="2"
          opacity="0.95"
          style={{ filter: "drop-shadow(0 0 12px hsl(230 100% 71% / 0.6))" }}
        />
      </svg>

      {/* Tooltip card */}
      <div
        className="absolute pointer-events-auto rounded-2xl bg-surface-elevated border border-border shadow-card p-4 page-enter"
        style={{ top: tooltipTop, left: tooltipLeft, width: tooltipWidth }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] uppercase tracking-wider text-secondary-fg">
            Tip {index + 1} of {total}
          </div>
          <button onClick={onSkip} className="text-secondary-fg hover:text-foreground pressable" aria-label="Skip tour">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="text-base font-semibold mt-2 leading-tight">{step.title}</h3>
        <p className="text-sm text-secondary-fg mt-1.5 leading-relaxed">{step.body}</p>

        <div className="flex items-center gap-2 mt-4">
          <div className="flex gap-1 flex-1">
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-primary" : "bg-border"}`} />
            ))}
          </div>
          <button
            onClick={onNext}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium pressable shadow-glow"
          >
            {isLast ? "Got it" : <>Next <ArrowRight className="h-3.5 w-3.5" /></>}
          </button>
        </div>
      </div>
    </div>
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
      id: "input",
      selector: "[data-tour='today-input']",
      title: "Brain-dump your day",
      body: "Just type tasks however they come — comma-separated, line-by-line, half-thoughts. AI cleans it up.",
      placement: "bottom",
    },
    {
      id: "inbox",
      selector: "[data-tour='today-inbox']",
      title: "Inbox for stray thoughts",
      body: "Got an idea mid-day? Tap here. It'll show up automatically on tomorrow's plan.",
      placement: "top",
    },
    {
      id: "plan",
      selector: "[data-tour='today-plan']",
      title: "Then plan your day",
      body: "AI estimates time for each task, asks you to confirm, then auto-schedules around your peak hours.",
      placement: "top",
    },
    {
      id: "tracker",
      selector: "[data-tour='tracker']",
      title: "Track time when you work",
      body: "Optional. One tap to start a timer for any category — handy if you bill clients or report hours.",
      placement: "top",
    },
  ],
};

export const TOUR_DAYVIEW: TourFlow = {
  key: "dayview",
  steps: [
    {
      id: "block",
      selector: "[data-tour='dayview-block']",
      title: "Your blocks for today",
      body: "Each block has a start time and duration. Tap one to enter Focus mode — it auto-starts the timer for you.",
      placement: "bottom",
    },
    {
      id: "complete",
      selector: "[data-tour='dayview-complete']",
      title: "Check off as you go",
      body: "Tap the circle to mark done. Skipped tasks roll over to tomorrow automatically.",
      placement: "bottom",
    },
  ],
};