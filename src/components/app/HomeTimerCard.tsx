import type { CSSProperties } from "react";
import { Play, Pause, ChevronRight } from "lucide-react";
import { useTimeTracker, useTimeTrackerElapsed, fmtHMS, fmtHM } from "@/hooks/useTimeTracker";

/**
 * Timer strip on Home — tappable shell opens detail sheet; Stop / quick-start chips stay isolated.
 */
export function HomeTimerCard({ onExpand }: { onExpand: () => void }) {
  const { active, categories, start, stop, todayTotalSec } = useTimeTracker();
  const elapsedSec = useTimeTrackerElapsed();
  const activeCat = categories.find((c) => c.id === active?.category_id);

  const topCats = [...categories].slice(0, 5);

  return (
    <div className="relative overflow-hidden rounded-[22px] border border-border/40 bg-muted/[0.06] shadow-none backdrop-blur-sm">
      <button
        type="button"
        aria-label="Open time tracker details"
        onClick={onExpand}
        className="absolute inset-0 z-0 rounded-[22px]"
      />
      <div className="relative z-10">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/75">Time</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
            className="text-[12px] font-semibold text-primary/90 inline-flex items-center gap-1 pressable hover:text-primary"
          >
            Details
            <ChevronRight className="h-4 w-4 opacity-75" />
          </button>
        </div>
        <div className="px-4 pb-4 pt-0">
          {active && activeCat ? (
            <div className="flex items-center gap-4">
              <div
                className="flex min-w-0 flex-1 flex-col gap-1.5"
                style={{ "--home-accent": activeCat.color } as CSSProperties}
              >
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/70">
                  Recording
                </span>
                <span className="font-display text-[2.25rem] font-semibold tabular-nums leading-none tracking-tight text-foreground/95">
                  {fmtHMS(elapsedSec)}
                </span>
                <span className="truncate text-[16px] font-semibold text-foreground/90">{activeCat.name}</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  stop();
                }}
                className="relative z-20 inline-flex shrink-0 items-center gap-2 rounded-full bg-foreground/[0.92] px-6 py-3 text-[14px] font-semibold text-background shadow-sm pressable"
              >
                <Pause className="h-4 w-4" fill="currentColor" />
                Stop
              </button>
            </div>
          ) : (
            <div className="space-y-4 pt-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium text-secondary-fg/80">Tracked today</span>
                <span className="font-display text-[1.625rem] font-semibold tabular-nums text-foreground/95">
                  {fmtHM(todayTotalSec)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {topCats.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={!!active}
                    onClick={(e) => {
                      e.stopPropagation();
                      start(c.id);
                    }}
                    className="relative z-20 inline-flex items-center gap-2 rounded-full border border-border/55 bg-background/55 py-2.5 pl-2.5 pr-4 text-[14px] font-semibold transition-colors hover:bg-background/85 pressable disabled:opacity-45"
                    style={{ borderColor: `${c.color}55` }}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full opacity-90" style={{ background: c.color }} />
                    <Play className="h-3.5 w-3.5 text-secondary-fg/80" />
                    <span className="max-w-[7.5rem] truncate text-foreground/95">{c.name}</span>
                  </button>
                ))}
              </div>
              {categories.length === 0 && (
                <p className="text-[13px] leading-relaxed text-secondary-fg/75">
                  Open details once to set up categories.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
