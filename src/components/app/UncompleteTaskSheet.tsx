import { useEffect, useState, type CSSProperties } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { Block } from "@/lib/daydraft";
import { haptics } from "@/lib/haptics";
import { CopyPlus, RotateCcw, Clock, Timer } from "lucide-react";
import { motion } from "framer-motion";
import { DurationPicker } from "@/components/app/DurationPicker";

interface Props {
  block: Block | null;
  onCancel: () => void;
  onConfirm: (action: "revert" | "v2", newStartTime: string, newDuration: number) => void;
  /** Earliest selectable start (HH:MM). Set on TODAY so the task can't be
   *  rescheduled into the past (which would auto-mark it missed instantly). */
  minTime?: string;
}

function roundedNowHHMM(): string {
  const now = new Date();
  const m = now.getMinutes();
  const mRounded = Math.ceil(m / 15) * 15;
  now.setMinutes(mRounded);
  now.setSeconds(0);
  now.setMilliseconds(0);
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function fmtTime(hhmm: string) {
  const [h, m] = hhmm.split(":");
  const hNum = parseInt(h, 10);
  const ampm = hNum >= 12 ? "PM" : "AM";
  const h12 = hNum % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function fmtDuration(mins: number | null) {
  if (mins == null) return "Set";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
}

// Glassy card surface shared by the two picker rows — mirrors DurationPicker's
// "Custom" row so this sheet reads as part of the same family.
const cardStyle: CSSProperties = {
  background: "linear-gradient(180deg, hsl(var(--card)/0.6) 0%, hsl(var(--card)/0.35) 100%)",
  boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.05), 0 0 0 1px hsl(var(--border)/0.4)",
};

export function UncompleteTaskSheet({ block, onCancel, onConfirm, minTime }: Props) {
  const open = !!block;

  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  // Tracked time indicates whether the user logged time for this block.
  // If true, we create a v2 copy. Otherwise, we just revert the block.
  const hasTrackedTime = block ? (block.actual_minutes ?? 0) > 0 : false;

  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number | null>(30);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Initialize values when the sheet opens for a new block
  useEffect(() => {
    if (block) {
      // Default to "right now" rounded to nearest 15 mins — but never below the
      // floor (today can't reschedule into the past).
      const def = roundedNowHHMM();
      setTime(minTime && toMin(def) < toMin(minTime) ? minTime : def);
      setDuration(block.duration_min || 30);
    }
  }, [block]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPast = !!minTime && !!time && toMin(time) < toMin(minTime);

  const handleSubmit = () => {
    if (!block || !time || duration == null) {
      haptics.notify("error");
      return;
    }
    if (isPast) {
      haptics.notify("error");
      return; // parent surfaces the "can't set a time in the past" toast
    }
    haptics.selection();
    onConfirm(hasTrackedTime ? "v2" : "revert", time, duration);
  };

  const Icon = hasTrackedTime ? CopyPlus : RotateCcw;
  const canSubmit = !!time && duration != null && !isPast;

  return (
    <>
      <Sheet open={open} onOpenChange={(val) => !val && onCancel()}>
        <SheetContent
          side="bottom"
          className="rounded-t-[28px] border-border/45 bg-popover p-0 flex flex-col"
          hideClose
        >
          <SheetTitle className="sr-only">Return to timeline</SheetTitle>

          {/* Header — matches DurationPicker: icon chip · title · subtitle · close */}
          <div className="px-5 pt-6 pb-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-[12px] flex items-center justify-center bg-primary/12 border border-primary/22 shrink-0">
              <Icon className="h-[18px] w-[18px] text-primary" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[19px] font-semibold tracking-tight leading-tight">
                Return to timeline?
              </div>
              <div className="text-[12px] text-secondary-fg/70 mt-0.5 leading-snug">
                {hasTrackedTime
                  ? "Time was tracked, so we keep the original done and add a Part 2."
                  : "Pick when to put this task back on your plan."}
              </div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="h-8 w-8 rounded-full flex items-center justify-center text-secondary-fg/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors pressable shrink-0 text-[18px]"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {block && (
            <>
              {/* Task title card */}
              <div className="px-5 pb-1">
                <motion.div
                  className="rounded-2xl px-4 py-4 flex items-center gap-3"
                  style={{
                    background: "linear-gradient(180deg, hsl(var(--primary)/0.18) 0%, hsl(var(--primary)/0.08) 100%)",
                    boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1px hsl(var(--primary)/0.40), 0 8px 24px -16px hsl(var(--primary)/0.35)",
                  }}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26, delay: 0.05 }}
                >
                  <span className="text-[15px] font-semibold text-foreground/95 leading-snug line-clamp-2">
                    {block.title}
                    {hasTrackedTime && <span className="text-primary"> (Part 2)</span>}
                  </span>
                </motion.div>
              </div>

              {/* When / how long */}
              <div className="px-5 pt-4 space-y-2.5">
                {/* Start time row */}
                <label className="rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer block relative" style={cardStyle}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Clock className="h-[18px] w-[18px] text-primary/80 shrink-0" strokeWidth={2} />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-foreground/90">Start time</div>
                      <div className="text-[11.5px] text-secondary-fg/70 mt-0.5">When it goes back on the plan</div>
                    </div>
                  </div>
                  <span className={`text-[16px] font-semibold tabular-nums shrink-0 ${isPast ? "text-destructive" : "text-foreground"}`}>
                    {time ? fmtTime(time) : "Set"}
                  </span>
                  <input
                    type="time"
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    value={time}
                    min={minTime}
                    tabIndex={-1}
                    onChange={(e) => { if (e.target.value) setTime(e.target.value); }}
                    style={{ fontSize: 16 }}
                    aria-label="Start time"
                  />
                </label>

                {isPast && minTime && (
                  <p className="px-1 -mt-1 text-[11.5px] font-medium text-destructive/90 leading-snug">
                    Can't reschedule into the past — pick {fmtTime(minTime)} or later.
                  </p>
                )}

                {/* Duration row */}
                <button
                  type="button"
                  onClick={() => { haptics.selection(); setPickerOpen(true); }}
                  className="w-full rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 pressable"
                  style={cardStyle}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Timer className="h-[18px] w-[18px] text-primary/80 shrink-0" strokeWidth={2} />
                    <div className="min-w-0 text-left">
                      <div className="text-[13px] font-semibold text-foreground/90">Duration</div>
                      <div className="text-[11.5px] text-secondary-fg/70 mt-0.5">How long to block out</div>
                    </div>
                  </div>
                  <span className="text-[16px] font-semibold tabular-nums text-foreground shrink-0">
                    {fmtDuration(duration)}
                  </span>
                </button>
              </div>
            </>
          )}

          {/* Footer buttons — same shape/heights as DurationPicker */}
          <div className="px-5 pt-5 pb-3 flex gap-2.5">
            <button
              type="button"
              onClick={() => { haptics.selection(); onCancel(); }}
              className="flex-1 h-[52px] rounded-[16px] border border-border/40 bg-card/30 text-[14px] font-medium text-secondary-fg/85 hover:text-foreground hover:bg-card/50 pressable transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 h-[52px] rounded-[16px] bg-primary text-primary-foreground text-[14px] font-semibold pressable shadow-[0_10px_28px_-8px_hsl(var(--primary)/0.55)] disabled:opacity-40 disabled:pointer-events-none transition-opacity"
            >
              {hasTrackedTime ? "Create Part 2" : "Return task"}
            </button>
          </div>

          <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
        </SheetContent>
      </Sheet>

      <DurationPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={duration ?? 30}
        onChange={(v) => setDuration(v)}
      />
    </>
  );
}
