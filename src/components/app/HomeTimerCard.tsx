import { Play, Pause, ChevronRight } from "lucide-react";
import { useTimeTracker, useTimeTrackerElapsed, fmtHMS, fmtHM } from "@/hooks/useTimeTracker";

/**
 * Quiet timer strip for Home — airy layout, expandable detail in a sheet.
 */
export function HomeTimerCard({ onExpand }: { onExpand: () => void }) {
  const { active, categories, start, stop, todayTotalSec } = useTimeTracker();
  const elapsedSec = useTimeTrackerElapsed();
  const activeCat = categories.find((c) => c.id === active?.category_id);

  const topCats = [...categories].slice(0, 5);

  return (
    <div className="rounded-[22px] border border-border/40 bg-muted/[0.06] backdrop-blur-sm overflow-hidden shadow-none">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-secondary-fg/65">Time</span>
        <button
          type="button"
          onClick={onExpand}
          className="text-[11px] font-medium text-primary/88 inline-flex items-center gap-1 pressable hover:text-primary"
        >
          Details
          <ChevronRight className="h-3.5 w-3.5 opacity-70" />
        </button>
      </div>
      <div className="px-4 pb-5 pt-1">
        {active && activeCat ? (
          <div className="flex items-center gap-5">
            <div
              className="flex flex-col gap-2 min-w-0 flex-1"
              style={{ "--home-accent": activeCat.color } as React.CSSProperties}
            >
              <span className="text-[10px] uppercase tracking-[0.16em] text-secondary-fg/65">Recording</span>
              <span className="font-display tabular-nums text-[2.125rem] font-medium tracking-tight text-foreground/95 leading-none">
                {fmtHMS(elapsedSec)}
              </span>
              <span className="text-[14px] truncate text-foreground/85">{activeCat.name}</span>
            </div>
            <button
              type="button"
              onClick={() => stop()}
              className="shrink-0 h-12 px-6 rounded-full bg-foreground/[0.92] text-background text-[13px] font-medium pressable inline-flex items-center gap-2 shadow-sm"
            >
              <Pause className="h-4 w-4" fill="currentColor" />
              Stop
            </button>
          </div>
        ) : (
          <div className="space-y-5 pt-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-secondary-fg/75">Tracked today</span>
              <span className="font-display text-xl tabular-nums font-medium text-foreground/95">{fmtHM(todayTotalSec)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {topCats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={!!active}
                  onClick={() => start(c.id)}
                  className="inline-flex items-center gap-2 pl-2.5 pr-4 py-2 rounded-full border border-border/55 bg-background/50 text-[13px] font-medium pressable disabled:opacity-45 transition-colors hover:bg-background/80"
                  style={{ borderColor: `${c.color}55` }}
                >
                  <span className="h-2 w-2 rounded-full shrink-0 opacity-90" style={{ background: c.color }} />
                  <Play className="h-3 w-3 text-secondary-fg/80" />
                  <span className="truncate max-w-[7rem] text-foreground/90">{c.name}</span>
                </button>
              ))}
            </div>
            {categories.length === 0 && (
              <p className="text-[12px] text-secondary-fg/70 leading-relaxed">Open the timer details once to seed categories.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
