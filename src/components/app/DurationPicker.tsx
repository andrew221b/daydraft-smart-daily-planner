import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { haptics } from "@/lib/haptics";

const PRESETS = [15, 30, 45, 60, 90, 120];

type Props = {
  open: boolean;
  onClose: () => void;
  value: number;
  onChange: (minutes: number) => void;
  title?: string;
};

const toTimeStr = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const fromTimeStr = (s: string): number => {
  const [h, m] = String(s || "").split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.max(0, h * 60 + m);
};

export function DurationPicker({ open, onClose, value, onChange, title = "Duration" }: Props) {
  // Local draft so the user can scrub the native wheel without each tick
  // round-tripping through the parent. Committed on "Set".
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const commit = (mins: number) => {
    const clamped = Math.max(5, Math.min(480, mins));
    onChange(clamped);
    haptics.selection();
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover pb-8">
        <SheetHeader className="text-left">
          <SheetTitle className="text-[16px]">{title}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Quick presets */}
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => commit(p)}
                className={`h-12 rounded-[14px] border pressable text-[14px] font-medium tabular-nums transition-colors ${
                  value === p
                    ? "bg-primary text-primary-foreground border-primary shadow-card"
                    : "surface-card border-soft text-foreground hover:border-primary/40"
                }`}
              >
                {p < 60 ? `${p} min` : p === 60 ? "1 hr" : p === 90 ? "1h 30m" : `${p / 60} hr`}
              </button>
            ))}
          </div>

          {/* Native HH:MM picker — iOS / Android show the system wheel/spinner,
              matching the start-time editor elsewhere in the app. */}
          <div className="rounded-[18px] border border-soft surface-card px-4 py-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/70">
                Custom
              </div>
              <div className="mt-0.5 text-[13px] text-foreground/85 tabular-nums">
                {Math.floor(draft / 60)}h {draft % 60}m
              </div>
            </div>
            <input
              type="time"
              step={60}
              value={toTimeStr(draft)}
              onChange={(e) => setDraft(fromTimeStr(e.target.value))}
              // 24h, no AM/PM, native wheel on touch devices.
              lang="en-GB"
              className="h-11 px-3 rounded-[12px] bg-background/60 border border-border/50 text-[15px] tabular-nums text-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
              aria-label="Pick duration (hours and minutes)"
            />
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1 h-12 rounded-[14px]" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1 h-12 rounded-[14px] bg-primary text-primary-foreground hover:bg-primary/92 font-semibold"
              onClick={() => commit(draft)}
              disabled={draft <= 0}
            >
              Set
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
