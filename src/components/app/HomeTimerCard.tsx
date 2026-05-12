import type { CSSProperties } from "react";
import { Play, Pause, ChevronRight } from "lucide-react";
import { useTimeTracker, useTimeTrackerElapsed, fmtHMS, fmtHM } from "@/hooks/useTimeTracker";

/**
 * Timer strip on Home — tappable shell opens detail sheet; Stop / quick-start chips stay isolated.
 */
export function HomeTimerCard({ onExpand }: { onExpand: () => void }) {
  const { active, categories, start, stop, todayTotalSec, weekTotalSec } = useTimeTracker();
  const elapsedSec = useTimeTrackerElapsed();
  const activeCat = categories.find((c) => c.id === active?.category_id);

  const topCats = [...categories].slice(0, 5);

  return (
    <div className="relative overflow-hidden rounded-[24px] border border-border/45 bg-gradient-to-b from-card/90 to-card/40 shadow-[0_20px_50px_-28px_rgba(0,0,0,0.35)] backdrop-blur-md dark:shadow-[0_24px_56px_-24px_rgba(0,0,0,0.55)]">
      <button
        type="button"
        aria-label="Open time tracker"
        onClick={onExpand}
        className="absolute inset-0 z-0 rounded-[24px]"
      />
      <div className="relative z-10 pointer-events-none">
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-fg/72">Session</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
            className="pointer-events-auto text-[12px] font-semibold text-primary/90 inline-flex items-center gap-1 pressable hover:text-primary"
          >
            Details
            <ChevronRight className="h-4 w-4 opacity-75" />
          </button>
        </div>
        <div className="px-5 pb-5 pt-0">
          {active && activeCat ? (
            <div className="flex flex-col gap-5">
              <div className="flex items-end justify-between gap-4">
                <div
                  className="flex min-w-0 flex-1 flex-col gap-2 pointer-events-none"
                  style={{ "--home-accent": activeCat.color } as CSSProperties}
                >
                  <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/50 bg-background/50 px-3 py-1 text-[13px] font-semibold text-foreground/95 backdrop-blur-sm">
                    <span className="h-2 w-2 shrink-0 rounded-full ring-2 ring-background" style={{ background: activeCat.color }} />
                    <span className="truncate">{activeCat.name}</span>
                  </span>
                  <span className="font-display text-[2.75rem] font-semibold tabular-nums leading-none tracking-tight text-foreground">
                    {fmtHMS(elapsedSec)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void stop();
                  }}
                  className="pointer-events-auto relative z-20 inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-5 py-3 text-[14px] font-semibold text-primary-foreground shadow-card pressable"
                >
                  <Pause className="h-4 w-4" fill="currentColor" />
                  Stop
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border/40 bg-background/35 px-3 py-2.5 text-center">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary-fg/75">Today</div>
                  <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-foreground/95">{fmtHM(todayTotalSec)}</div>
                </div>
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary-fg/75">Week</div>
                  <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums text-foreground/95">{fmtHM(weekTotalSec)}</div>
                </div>
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary-fg/75">Live</div>
                  <div className="mt-0.5 text-[13px] font-semibold text-primary">On</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5 pt-0.5">
              <div className="text-center">
                <p className="text-[11px] font-medium text-secondary-fg/80">Tracked today</p>
                <p className="mt-1 font-display text-[2.5rem] font-semibold tabular-nums leading-none tracking-tight text-foreground/95">
                  {fmtHM(todayTotalSec)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center rounded-2xl border border-border/40 bg-background/30 px-3 py-2.5">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary-fg/75">This week</div>
                  <div className="mt-0.5 font-mono text-[13px] font-semibold tabular-nums">{fmtHM(weekTotalSec)}</div>
                </div>
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary-fg/75">Tap play</div>
                  <div className="mt-0.5 text-[13px] font-semibold text-foreground/90">Quick start</div>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {topCats.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={!!active}
                    onClick={(e) => {
                      e.stopPropagation();
                      void start(c.id);
                    }}
                    className="pointer-events-auto relative z-20 inline-flex items-center gap-2 rounded-full border border-border/55 bg-primary py-2.5 pl-3 pr-4 text-[14px] font-semibold text-primary-foreground shadow-md transition-opacity pressable hover:opacity-95 disabled:opacity-45"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-primary-foreground/90" style={{ boxShadow: `0 0 0 2px ${c.color}` }} />
                    <Play className="h-3.5 w-3.5" fill="currentColor" />
                    <span className="max-w-[6.5rem] truncate">{c.name}</span>
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
