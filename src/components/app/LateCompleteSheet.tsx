import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, RotateCcw } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { haptics } from "@/lib/haptics";
import { useSheetSwipeDown } from "@/hooks/useSheetSwipeDown";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  taskTitle: string;
  resolution: "missed" | "skipped";
  onConfirm: () => void;
  /** Bring the task back to the active list and let the user re-pick time/duration. */
  onReturn: () => void;
};

export function LateCompleteSheet({
  open,
  onOpenChange,
  taskTitle,
  resolution,
  onConfirm,
  onReturn,
}: Props) {
  const swipe = useSheetSwipeDown(() => onOpenChange(false));

  const isMissed = resolution === "missed";

  const handleConfirm = () => {
    haptics.notify("success");
    onConfirm();
    onOpenChange(false);
  };

  const handleReturn = () => {
    haptics.tap();
    onReturn();
    onOpenChange(false);
  };

  const handleCancel = () => {
    haptics.tap();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover p-0 flex flex-col overflow-hidden"
        style={swipe.sheetStyle ?? undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        <SheetTitle className="sr-only">Mark task as done</SheetTitle>

        {/* Top edge accent line */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.55) 50%, transparent 100%)",
          }}
        />
        {/* Top glow halo */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[140px]"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 0%, hsl(var(--primary) / 0.11), transparent 72%)",
          }}
        />

        {/* Drag handle */}
        <div
          className="relative shrink-0 flex justify-center pt-4 pb-2"
          {...swipe.handleProps}
          aria-label="Swipe down to close"
          role="button"
        >
          <div className="h-1 w-10 rounded-full bg-foreground/20" />
        </div>

        {/* Content */}
        <div className="relative px-6 pt-4 pb-2 flex flex-col items-center text-center">

          {/* Animated checkmark icon */}
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 22, delay: 0.05 }}
                className="relative mb-5"
              >
                {/* Outer glow ring */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.15, duration: 0.5 }}
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, hsl(var(--primary) / 0.22) 0%, transparent 70%)",
                    transform: "scale(1.7)",
                  }}
                  aria-hidden
                />
                {/* Icon container */}
                <div
                  className="relative h-[72px] w-[72px] rounded-[22px] flex items-center justify-center"
                  style={{
                    background:
                      "linear-gradient(145deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--primary) / 0.06) 100%)",
                    boxShadow:
                      "inset 0 1px 0 hsl(0 0% 100% / 0.12), inset 0 0 0 1px hsl(var(--primary) / 0.28), 0 8px 28px -8px hsl(var(--primary) / 0.45)",
                  }}
                >
                  <Check
                    className="h-8 w-8 text-primary"
                    strokeWidth={2.75}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Headline */}
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, type: "spring", bounce: 0.2, duration: 0.5 }}
            className="font-display text-[20px] font-semibold tracking-tight text-foreground/95 mb-2"
          >
            {isMissed ? "This task was missed" : "This task was skipped"}
          </motion.h2>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, type: "spring", bounce: 0.15, duration: 0.5 }}
            className="text-[13px] text-secondary-fg/70 leading-relaxed max-w-[280px] mb-5"
          >
            Did you finish it after all — or put it back on your list to reschedule?
          </motion.p>

          {/* Task title card */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, type: "spring", bounce: 0.12, duration: 0.5 }}
            className="w-full mb-6 rounded-2xl border px-4 py-4 flex items-center gap-3 text-left"
            style={{
              borderColor: "hsl(var(--border) / 0.45)",
              background:
                "linear-gradient(135deg, hsl(var(--card) / 0.6) 0%, hsl(var(--card) / 0.3) 100%)",
              boxShadow:
                "inset 0 1px 0 hsl(0 0% 100% / 0.05), 0 1px 4px hsl(0 0% 0% / 0.08)",
            }}
          >
            <span
              aria-hidden
              className="shrink-0 h-8 w-8 rounded-xl flex items-center justify-center"
              style={{
                background: "hsl(var(--muted) / 0.6)",
                boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.06)",
              }}
            >
              <Clock className="h-4 w-4 text-secondary-fg/70" strokeWidth={2} />
            </span>
            <p className="flex-1 min-w-0 text-[14px] font-semibold text-foreground/90 leading-snug line-clamp-2">
              {taskTitle}
            </p>
            {/* Resolution badge */}
            <span
              className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full"
              style={{
                color: isMissed
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--secondary-fg))",
                background: isMissed
                  ? "hsl(var(--destructive) / 0.12)"
                  : "hsl(var(--foreground) / 0.07)",
                border: isMissed
                  ? "1px solid hsl(var(--destructive) / 0.25)"
                  : "1px solid hsl(var(--border) / 0.4)",
              }}
            >
              {isMissed ? "Missed" : "Skipped"}
            </span>
          </motion.div>

          {/* Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22, type: "spring", bounce: 0.12, duration: 0.5 }}
            className="w-full flex flex-col gap-2.5"
          >
            {/* Confirm — primary */}
            <button
              type="button"
              onClick={handleConfirm}
              className="w-full h-[52px] rounded-[16px] text-[15px] font-semibold text-primary-foreground pressable flex items-center justify-center gap-2 transition-opacity"
              style={{
                background:
                  "linear-gradient(180deg, hsl(var(--primary) / 0.95) 0%, hsl(var(--primary)) 100%)",
                boxShadow:
                  "inset 0 1px 0 hsl(0 0% 100% / 0.14), 0 10px 28px -8px hsl(var(--primary) / 0.55), 0 0 0 1px hsl(var(--primary) / 0.35)",
              }}
            >
              <Check className="h-4.5 w-4.5 shrink-0" strokeWidth={2.75} style={{ width: 18, height: 18 }} />
              Yes, I completed it
            </button>

            {/* Return to task list — secondary */}
            <button
              type="button"
              onClick={handleReturn}
              className="w-full h-[50px] rounded-[16px] text-[14px] font-semibold text-foreground/90 border border-border/75 bg-card/40 hover:bg-card/70 pressable flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw className="h-4 w-4 shrink-0" strokeWidth={2.25} />
              Return to task list
            </button>

            {/* Cancel — ghost */}
            <button
              type="button"
              onClick={handleCancel}
              className="w-full h-[44px] rounded-[16px] text-[13px] font-medium text-secondary-fg/70 hover:text-foreground pressable transition-colors"
            >
              Cancel
            </button>
          </motion.div>
        </div>

        <div
          className="shrink-0"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}
        />
      </SheetContent>
    </Sheet>
  );
}
