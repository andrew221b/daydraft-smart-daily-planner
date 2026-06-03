import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Block } from "@/lib/daydraft";
import { haptics } from "@/lib/haptics";
import { CopyPlus, RotateCcw } from "lucide-react";

interface Props {
  block: Block | null;
  onClose: () => void;
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

export function UncompleteTaskSheet({ block, onClose, onConfirm }: Props) {
  const open = !!block;
  
  // Tracked time indicates whether the user logged time for this block.
  // If true, we create a v2 copy. Otherwise, we just revert the block.
  const hasTrackedTime = block ? (block.actual_minutes ?? 0) > 0 : false;

  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);

  // Initialize values when the sheet opens for a new block
  useEffect(() => {
    if (block) {
      // Default to "right now" rounded to nearest 15 mins for rescheduling
      setTime(roundedNowHHMM());
      setDuration(block.duration_min || 30);
    }
  }, [block]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!block || !time) return;
    haptics.selection();
    onConfirm(hasTrackedTime ? "v2" : "revert", time, duration);
  };

  return (
    <Sheet open={open} onOpenChange={(val) => !val && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] px-0 pb-0 bg-background sm:max-w-md sm:mx-auto border-x sm:border-t-border sm:border-x-border"
        style={{
          boxShadow: "0 -24px 64px -16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 rounded-full bg-border/40" />

        <form onSubmit={handleSubmit} className="px-6 pt-10 pb-[env(safe-area-inset-bottom,24px)] flex flex-col h-full max-h-[85vh]">
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
              <div className="p-3 rounded-2xl border border-border/50 bg-card shadow-sm flex flex-col gap-1">
                <span className="text-[12px] font-bold text-secondary-fg/50 uppercase tracking-wider">Task</span>
                <span className="text-[15px] font-semibold text-foreground/90 truncate">
                  {block.title} {hasTrackedTime ? "(Part 2)" : ""}
                </span>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[13px] font-bold text-secondary-fg/70 ml-1">Start Time</label>
                <div className="relative">
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full h-12 px-4 rounded-2xl border border-border/50 bg-card text-[16px] font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/50 transition-shadow appearance-none"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-end px-1">
                  <label className="text-[13px] font-bold text-secondary-fg/70">Duration</label>
                  <span className="text-[14px] font-bold text-foreground">
                    {duration < 60 ? `${duration}m` : `${Math.floor(duration / 60)}h ${duration % 60 > 0 ? `${duration % 60}m` : ''}`}
                  </span>
                </div>
                <div className="h-12 px-1 flex items-center">
                  <input
                    type="range"
                    min="5"
                    max="240"
                    step="5"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 flex gap-3 shrink-0">
            <button
              type="button"
              onClick={() => { haptics.selection(); onClose(); }}
              className="flex-1 h-14 rounded-[18px] border border-border/40 bg-card/30 text-[15px] font-semibold text-secondary-fg/80 pressable hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 h-14 rounded-[18px] bg-primary text-primary-foreground text-[15px] font-bold pressable shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.55)] hover:brightness-110 transition-all"
            >
              {hasTrackedTime ? "Create Part 2" : "Return Task"}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
