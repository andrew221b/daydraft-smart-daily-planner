import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Block } from "@/lib/daydraft";
import { haptics } from "@/lib/haptics";
import { CopyPlus, RotateCcw, Clock, Timer, X } from "lucide-react";
import { DurationPicker } from "@/components/app/DurationPicker";

interface Props {
  block: Block | null;
  onCancel: () => void;
  onConfirm: (action: "revert" | "v2", newStartTime: string, newDuration: number) => void;
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

export function UncompleteTaskSheet({ block, onCancel, onConfirm }: Props) {
  const open = !!block;
  
  // Tracked time indicates whether the user logged time for this block.
  // If true, we create a v2 copy. Otherwise, we just revert the block.
  const hasTrackedTime = block ? (block.actual_minutes ?? 0) > 0 : false;

  const [time, setTime] = useState("");
  const [duration, setDuration] = useState<number | null>(30);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Initialize values when the sheet opens for a new block
  useEffect(() => {
    if (block) {
      // Default to "right now" rounded to nearest 15 mins for rescheduling
      setTime(roundedNowHHMM());
      setDuration(block.duration_min || 30);
    }
  }, [block]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!block || !time || duration == null) {
      haptics.notify("error");
      return;
    }
    haptics.selection();
    onConfirm(hasTrackedTime ? "v2" : "revert", time, duration);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(val) => !val && onCancel()}>
        <SheetContent
          side="bottom"
          className="rounded-t-[32px] px-0 pb-0 bg-background sm:max-w-md sm:mx-auto border-x sm:border-t-border sm:border-x-border"
          style={{
            boxShadow: "0 -24px 64px -16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 rounded-full bg-border/40" />

          <div className="px-6 pt-10 pb-[env(safe-area-inset-bottom,24px)] flex flex-col h-full max-h-[85vh]">
            <SheetHeader className="mb-6 text-left">
              <SheetTitle className="text-[22px] font-bold text-foreground flex items-center gap-2">
                {hasTrackedTime ? <CopyPlus className="h-5 w-5 text-accent" /> : <RotateCcw className="h-5 w-5 text-accent" />}
                Return to timeline?
              </SheetTitle>
              <p className="text-[14px] text-secondary-fg/80 mt-1 leading-relaxed">
                {hasTrackedTime 
                  ? "Time was tracked for this task. To keep your reports accurate, the original will stay completed, and we'll create a new continuation task (Part 2)."
                  : "This task will be marked as uncompleted. Pick a new time to schedule it."}
              </p>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto space-y-6">
              {block && (
                <div className="flex flex-col gap-2 rounded-[18px] border border-border/60 bg-foreground/[0.04] dark:bg-foreground/[0.06] px-4 py-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-8 bg-transparent border-0 text-[15px] font-semibold text-foreground truncate leading-8">
                      {block.title} {hasTrackedTime ? "(Part 2)" : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <div className="relative inline-flex items-center">
                      <label
                        className={`relative flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] font-medium pressable transition-colors cursor-pointer select-none ${time ? "pr-8" : ""} ${
                          !time
                            ? "border-border/45 bg-muted/40 text-secondary-fg/55 italic"
                            : "border-border/45 bg-muted/40 text-secondary-fg hover:text-foreground"
                        }`}
                      >
                        <Clock className="h-3.5 w-3.5 opacity-70 pointer-events-none" />
                        <span className="pointer-events-none">{time ? fmtTime(time) : "Set time"}</span>
                        <input
                          type="time"
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                          value={time}
                          tabIndex={-1}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            setTime(e.target.value);
                          }}
                          style={{ fontSize: 16 }}
                        />
                      </label>
                      {time && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTime("");
                          }}
                          className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full flex items-center justify-center text-secondary-fg hover:bg-foreground/10"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <button type="button" onClick={() => setPickerOpen(true)}
                      className={`flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] font-medium tabular-nums pressable transition-colors ${
                        duration == null
                          ? "border-border/45 bg-muted/40 text-secondary-fg/45 italic"
                          : "border-border/45 bg-muted/40 text-secondary-fg hover:text-foreground"
                      }`}
                    >
                      <Timer className="h-3.5 w-3.5 opacity-70" />
                      {duration == null
                        ? "Set"
                        : duration < 60
                          ? `${duration}m`
                          : `${Math.floor(duration / 60)}h${duration % 60 ? ` ${duration % 60}m` : ""}`}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 flex gap-3 shrink-0">
              <button
                type="button"
                onClick={() => { haptics.selection(); onCancel(); }}
                className="flex-1 h-14 rounded-[18px] border border-border/40 bg-card/30 text-[15px] font-semibold text-secondary-fg/80 pressable hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSubmit()}
                className={`flex-1 h-14 rounded-[18px] text-primary-foreground text-[15px] font-bold pressable transition-all ${(!time || duration == null) ? "bg-primary/50 pointer-events-none" : "bg-primary shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.55)] hover:brightness-110"}`}
              >
                {hasTrackedTime ? "Create Part 2" : "Return Task"}
              </button>
            </div>
          </div>
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
