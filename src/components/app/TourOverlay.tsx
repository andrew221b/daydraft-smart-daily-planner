import { X, ArrowRight } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

type OverlayStep = {
  title: string;
  body: string;
  placement?: "top" | "bottom" | "auto";
};

const PADDING = 8;
const GAP = 14;

export default function TourOverlay({
  rect,
  step,
  index,
  total,
  onNext,
  onSkip,
}: {
  rect: DOMRect;
  step: OverlayStep;
  index: number;
  total: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const isLast = index === total - 1;
  const padX = PADDING,
    padY = PADDING;
  const x = Math.max(8, rect.left - padX);
  const y = Math.max(8, rect.top - padY);
  const w = rect.width + padX * 2;
  const h = rect.height + padY * 2;
  const radius = 16;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tipH, setTipH] = useState(180);
  useLayoutEffect(() => {
    if (tooltipRef.current) setTipH(tooltipRef.current.getBoundingClientRect().height);
  }, [step.title, step.body, vw, vh]);

  const spaceBelow = vh - (y + h) - 16;
  const spaceAbove = y - 16;
  // Prefer requested placement, but flip if it doesn't fit. Avoid overlapping the highlight.
  let placeBelow: boolean;
  if (step.placement === "bottom") placeBelow = spaceBelow >= tipH + GAP || spaceBelow >= spaceAbove;
  else if (step.placement === "top") placeBelow = !(spaceAbove >= tipH + GAP || spaceAbove >= spaceBelow);
  else placeBelow = spaceBelow >= spaceAbove;

  const tooltipTop = placeBelow
    ? Math.min(vh - tipH - 16, y + h + GAP)
    : Math.max(16, y - GAP - tipH);

  const tooltipWidth = Math.min(340, vw - 32);
  const targetCenter = x + w / 2;
  const tooltipLeft = Math.max(16, Math.min(vw - tooltipWidth - 16, targetCenter - tooltipWidth / 2));

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none" aria-live="polite">
      <svg width="100%" height="100%" className="absolute inset-0 pointer-events-auto" onClick={onSkip}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={x} y={y} width={w} height={h} rx={radius} ry={radius} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(5, 6, 18, 0.78)" mask="url(#tour-mask)" />
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={radius}
          ry={radius}
          fill="none"
          stroke="hsl(230 100% 71%)"
          strokeWidth="2"
          opacity="0.95"
          style={{ filter: "drop-shadow(0 0 12px hsl(230 100% 71% / 0.6))" }}
        />
      </svg>

      <div
        ref={tooltipRef}
        className="absolute pointer-events-auto rounded-xl bg-surface-elevated border border-soft shadow-card p-4 page-enter"
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
            className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium pressable"
          >
            {isLast ? (
              "Got it"
            ) : (
              <>
                Next <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
