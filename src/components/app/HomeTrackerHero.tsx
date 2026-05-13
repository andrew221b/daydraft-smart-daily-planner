import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Check, Play, Square, Plus, Search, ChevronDown } from "lucide-react";
import { useTimeTracker, useTimeTrackerElapsed, fmtHMS, fmtHM } from "@/hooks/useTimeTracker";
import { Sheet, SheetContent } from "@/components/ui/sheet";

/**
 * HomeTrackerHero — the bold, primary surface of the app.
 * Tracker-first design: a luminous halo around the running timer,
 * a single hero CTA when idle, and quick category chips below.
 */
export function HomeTrackerHero({ onOpenDetails }: { onOpenDetails: () => void }) {
  const { active, categories, start, stop, switchCategory, addCategory, todayTotalSec } = useTimeTracker();
  const elapsedSec = useTimeTrackerElapsed();
  const activeCat = categories.find((c) => c.id === active?.category_id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [focusNewCategory, setFocusNewCategory] = useState(false);
  const newCategoryInputRef = useRef<HTMLInputElement | null>(null);

  const accent = activeCat?.color || "hsl(var(--primary))";
  const topCats = categories.slice(0, 4);
  const moreCats = categories.slice(4);
  const filteredCategories = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, categoryQuery]);

  useEffect(() => {
    if (!pickerOpen || !focusNewCategory) return;
    const id = window.setTimeout(() => newCategoryInputRef.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, [pickerOpen, focusNewCategory]);

  const openCategoryPicker = (opts?: { focusAdd?: boolean }) => {
    setPickerOpen(true);
    setFocusNewCategory(!!opts?.focusAdd);
    if (opts?.focusAdd) {
      setCategoryQuery("");
      setNewCategoryName("");
    }
  };

  const chooseCategory = async (id: string) => {
    setPickerOpen(false);
    if (active) {
      await switchCategory(id);
      return;
    }
    await start(id);
  };

  const handleAddCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name || addingCategory) return;
    setAddingCategory(true);
    try {
      const cat = await addCategory(name);
      if (cat) {
        setNewCategoryName("");
        setCategoryQuery("");
      }
    } finally {
      setAddingCategory(false);
    }
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
              {categories.length > 1 && (
                <button
                  type="button"
                  onClick={() => openCategoryPicker()}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/45 bg-background/45 px-4 py-2 text-[12px] font-semibold text-secondary-fg/90 pressable hover:text-foreground"
                >
                  Switch category
                  <ChevronDown className="h-3 w-3" />
                </button>
              )}
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
                    openCategoryPicker({ focusAdd: true });
                    return;
                  }
                  if (categories.length === 1) {
                    void start(categories[0].id);
                    return;
                  }
                  openCategoryPicker();
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
                onClick={() => openCategoryPicker()}
                className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/40 py-1.5 px-2.5 text-[12px] font-medium text-secondary-fg/85 hover:text-foreground pressable"
              >
                <ChevronDown className="h-3 w-3" />
                More
              </button>
            )}
            <button
              type="button"
              onClick={() => openCategoryPicker({ focusAdd: true })}
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
            <button onClick={() => openCategoryPicker({ focusAdd: true })} className="font-semibold text-primary underline-offset-4 hover:underline">
              set up
            </button>{" "}
            to add your first category.
          </p>
        )}
      </div>

      <Sheet
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setFocusNewCategory(false);
        }}
      >
        <SheetContent side="bottom" className="rounded-t-[28px] p-0 max-h-[84vh] overflow-hidden bg-background border-border/45">
          <div className="flex max-h-[84vh] flex-col">
            <div className="px-5 pt-7 pb-4 border-b border-border/35">
              <h3 className="font-display text-[20px] font-semibold tracking-tight">
                {active ? "Switch category" : "Start tracking"}
              </h3>
              <p className="text-[13px] text-secondary-fg/80 mt-1">
                {active ? "Pick a category and the current session will continue there." : "Pick what you're working on."}
              </p>
              {categories.length > 6 && (
                <label className="mt-4 flex items-center gap-2 rounded-2xl border border-border/45 bg-card/55 px-3 py-2.5">
                  <Search className="h-4 w-4 text-secondary-fg shrink-0" />
                  <input
                    value={categoryQuery}
                    onChange={(event) => setCategoryQuery(event.target.value)}
                    placeholder="Search categories"
                    className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-secondary-fg/65"
                  />
                </label>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {filteredCategories.length > 0 ? (
                <div className="grid grid-cols-1 gap-2.5">
                  {filteredCategories.map((c) => {
                    const isCurrent = active?.category_id === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => chooseCategory(c.id)}
                        disabled={isCurrent}
                        className={`flex items-center gap-3 rounded-2xl border border-border/45 bg-card/60 px-3.5 py-3.5 text-left pressable transition-colors ${
                          isCurrent ? "opacity-70" : "hover:bg-card/90"
                        }`}
                        style={{ borderColor: `${c.color}55` }}
                      >
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground/95">{c.name}</span>
                        {isCurrent && <span className="text-[11px] font-semibold text-primary">Current</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/45 px-4 py-6 text-center text-[13px] text-secondary-fg/80">
                  No categories match your search.
                </div>
              )}
            </div>

            <form onSubmit={handleAddCategory} className="border-t border-border/35 px-5 py-4">
              <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border/45 bg-card/35 px-3 py-2.5">
                <Plus className="h-4 w-4 text-secondary-fg shrink-0" />
                <input
                  ref={newCategoryInputRef}
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="New category name"
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-secondary-fg/65"
                  autoFocus={categories.length === 0 || focusNewCategory}
                />
                {newCategoryName.trim() && (
                  <button
                    type="submit"
                    disabled={addingCategory}
                    className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground pressable disabled:opacity-60"
                  >
                    <Check className="h-3 w-3" />
                    Add
                  </button>
                )}
              </div>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
