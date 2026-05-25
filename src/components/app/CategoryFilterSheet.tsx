import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { haptics } from "@/lib/haptics";

type Category = { id: string; name: string; color: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: Category[];
  /** Currently-applied filter. Empty Set = "all categories". */
  initialSelected: Set<string>;
  onApply: (next: Set<string>) => void;
};

/**
 * Bottom-sheet category multi-select. Used by Reports to scope aggregations
 * to a subset of tracker categories without changing the underlying data
 * fetch — filtering happens locally on the already-loaded rolling entries.
 */
export function CategoryFilterSheet({
  open,
  onOpenChange,
  categories,
  initialSelected,
  onApply,
}: Props) {
  // Draft selection — only committed on Apply, so flicking through options
  // doesn't disturb the background Reports page.
  const [draft, setDraft] = useState<Set<string>>(initialSelected);

  // Reseed every time the sheet opens so a Cancel-then-reopen shows the
  // applied state, not whatever was being edited last time.
  useEffect(() => {
    if (open) setDraft(new Set(initialSelected));
  }, [open, initialSelected]);

  const allSelected = draft.size === 0; // empty Set = "all"

  const toggle = (id: string) => {
    haptics.selection();
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    haptics.selection();
    setDraft(new Set()); // empty == all
  };

  const handleApply = () => {
    haptics.tap();
    onApply(draft);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/45 bg-popover max-h-[80vh] p-0 flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-[15px] text-secondary-fg hover:text-foreground pressable px-1 py-1 -ml-1 transition-colors"
          >
            Cancel
          </button>
          <p className="text-[15px] font-semibold text-foreground/95">Filter by category</p>
          <button
            type="button"
            onClick={handleApply}
            className="text-[15px] font-semibold text-primary hover:text-primary/85 pressable px-1 py-1 -mr-1 transition-colors"
          >
            Done
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 pb-6">
          {/* "All categories" row — sets draft to empty Set (sentinel for "no
              filter"). Keeps the menu's mental model simple: either show
              everything, or pick specific ones. */}
          <button
            type="button"
            onClick={selectAll}
            className="w-full flex items-center gap-3 rounded-2xl border border-border/35 bg-foreground/[0.03] hover:bg-foreground/[0.06] px-4 py-3 pressable transition-colors mb-3"
          >
            <span className="h-6 w-6 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
              {allSelected && (
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 520, damping: 22 }}
                >
                  <Check className="h-3.5 w-3.5 text-primary" strokeWidth={3} />
                </motion.span>
              )}
            </span>
            <span className="text-[14px] font-semibold text-foreground/95 flex-1 text-left">
              All categories
            </span>
            <span className="text-[11px] text-secondary-fg/65 tabular-nums">
              {categories.length}
            </span>
          </button>

          {/* Bumped from space-y-1.5 → space-y-2.5 to give iOS's gesture
              system enough physical distance between tap targets that its
              fuzzy hit-test can't snap a tap to the wrong neighbour. 6px
              gaps were inside the fuzziness window. */}
          <div className="space-y-2.5">
            {categories.map((cat) => {
              const isSelected = !allSelected && draft.has(cat.id);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggle(cat.id)}
                  className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 pressable transition-colors ${
                    isSelected
                      ? "border-primary/30 bg-primary/[0.06]"
                      : "border-border/35 bg-foreground/[0.02] hover:bg-foreground/[0.05]"
                  }`}
                >
                  <span className="h-6 w-6 rounded-full border-[1.5px] flex items-center justify-center shrink-0"
                    style={{
                      borderColor: isSelected ? "hsl(var(--primary))" : "hsl(var(--border) / 0.65)",
                      background: isSelected ? "hsl(var(--primary) / 0.18)" : "transparent",
                    }}
                  >
                    {isSelected && (
                      <motion.span
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 520, damping: 22 }}
                      >
                        <Check className="h-3.5 w-3.5 text-primary" strokeWidth={3} />
                      </motion.span>
                    )}
                  </span>
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: cat.color }}
                    aria-hidden
                  />
                  <span className="text-[14px] font-medium text-foreground/95 flex-1 text-left truncate">
                    {cat.name}
                  </span>
                </button>
              );
            })}
            {categories.length === 0 && (
              <p className="text-[13px] text-secondary-fg/70 text-center py-8">
                No categories yet. Create one in the tracker.
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
