import { useState, type CSSProperties } from "react";
import { Play, Square, Plus, ChevronDown } from "lucide-react";
import { useTimeTracker, useTimeTrackerElapsed, fmtHMS, fmtHM } from "@/hooks/useTimeTracker";
import { Sheet, SheetContent } from "@/components/ui/sheet";

/**
 * HomeTrackerHero — the bold, primary surface of the app.
 * Tracker-first design: a luminous halo around the running timer,
 * a single hero CTA when idle, and quick category chips below.
 */
export function HomeTrackerHero({ onOpenDetails }: { onOpenDetails: () => void }) {
  const { active, categories, start, stop, todayTotalSec } = useTimeTracker();
  const elapsedSec = useTimeTrackerElapsed();
  const activeCat = categories.find((c) => c.id === active?.category_id);
  const [pickerOpen, setPickerOpen] = useState(false);

  const accent = activeCat?.color || "hsl(var(--primary))";
  const topCats = categories.slice(0, 4);
  const moreCats = categories.slice(4);

  const startWith = async (id: string) => {
    setPickerOpen(false);
    await start(id);
  };

  return (
    <section
      className="relative overflow-hidden rounded-[28px] border border-border/35 bg-card/40 px-5 pt-6 pb-5"
      style={{ "--hero-accent": accent } as CSSProperties}
    >
      {/* Subtle accent wash — only when recording */}
      {active && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(80% 50% at 50% 0%, color-mix(in oklab, var(--hero-accent) 18%, transparent), transparent 70%)",
          }}
        />
      )}

      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-fg/70">
            {active ? "Recording" : "Time tracker"}
          </span>
          <button
            type="button"
            onClick={onOpenDetails}
            className="text-[12px] font-medium text-secondary-fg/80 hover:text-foreground transition-colors pressable"
          >
            All stats →
          </button>
        </div>

        {/* Hero timer */}
        <div className="mt-4 flex flex-col items-center text-center">
          {active && activeCat ? (
            <>
              <div className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.05] px-3 py-1">
                <span
                  className="h-1.5 w-1.5 rounded-full animate-pulse"
                  style={{ background: accent }}
                />
                <span className="text-[12px] font-medium text-foreground/85 truncate max-w-[14rem]">
                  {activeCat.name}
                </span>
              </div>
              <div className="mt-3 font-display text-[3.4rem] font-semibold tabular-nums leading-none tracking-[-0.04em] text-foreground">
                {fmtHMS(elapsedSec)}
              </div>
              <button
                type="button"
                onClick={() => stop()}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-7 py-3 text-[14px] font-semibold pressable active:scale-[0.97] transition-transform"
              >
                <Square className="h-3.5 w-3.5" fill="currentColor" />
                Stop
              </button>
            </>
          ) : (
            <>
              <span className="text-[11px] font-medium text-secondary-fg/70">Tracked today</span>
              <div className="mt-1 font-display text-[3.4rem] font-semibold tabular-nums leading-none tracking-[-0.04em] text-foreground">
                {fmtHM(todayTotalSec)}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (categories.length === 0) {
                    onOpenDetails();
                    return;
                  }
                  if (categories.length === 1) {
                    void start(categories[0].id);
                    return;
                  }
                  setPickerOpen(true);
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-8 py-3.5 text-[14px] font-semibold pressable active:scale-[0.97] transition-transform"
              >
                <Play className="h-3.5 w-3.5" fill="currentColor" />
                Start tracking
              </button>
            </>
          )}
        </div>

        {/* Quick category chips when idle */}
        {!active && topCats.length > 0 && (
          <div className="mt-4 -mx-1 flex gap-1.5 overflow-x-auto pb-1 px-1 scrollbar-none">
            {topCats.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => start(c.id)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background/50 py-1.5 pl-2 pr-3 text-[12px] font-medium text-foreground/90 hover:bg-background/80 transition-colors pressable"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                <span className="max-w-[8rem] truncate">{c.name}</span>
              </button>
            ))}
            {moreCats.length > 0 && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/40 py-1.5 px-2.5 text-[12px] font-medium text-secondary-fg/85 hover:text-foreground pressable"
              >
                <ChevronDown className="h-3 w-3" />
                More
              </button>
            )}
            <button
              type="button"
              onClick={onOpenDetails}
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-dashed border-border/40 bg-transparent py-1.5 px-2.5 text-[12px] font-medium text-secondary-fg/80 hover:text-foreground pressable"
            >
              <Plus className="h-3 w-3" />
              New
            </button>
          </div>
        )}
        {!active && topCats.length === 0 && (
          <p className="mt-4 text-center text-[13px] text-secondary-fg/75">
            Tap{" "}
            <button onClick={onOpenDetails} className="font-semibold text-primary underline-offset-4 hover:underline">
              set up
            </button>{" "}
            to add your first category.
          </p>
        )}
      </div>

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent side="bottom" className="rounded-t-[28px] p-0 max-h-[80vh] overflow-y-auto bg-background border-border/45">
          <div className="px-5 pt-7 pb-8">
            <h3 className="font-display text-[20px] font-semibold tracking-tight">Start tracking</h3>
            <p className="text-[13px] text-secondary-fg/80 mt-1">Pick what you’re working on.</p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => startWith(c.id)}
                  className="flex items-center gap-2.5 rounded-2xl border border-border/45 bg-card/60 px-3.5 py-3.5 text-left pressable hover:bg-card/90 transition-colors"
                  style={{ borderColor: `${c.color}55` }}
                >
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="truncate text-[14px] font-semibold text-foreground/95">{c.name}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  onOpenDetails();
                }}
                className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border/45 bg-transparent px-3.5 py-3.5 text-[14px] font-semibold text-secondary-fg/85 hover:text-foreground pressable"
              >
                <Plus className="h-4 w-4" />
                New category
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
