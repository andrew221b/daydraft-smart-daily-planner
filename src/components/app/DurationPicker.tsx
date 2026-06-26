import { useEffect, useState, type CSSProperties } from "react";
import { Clock } from "lucide-react";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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

const presetLabel = (mins: number) =>
  mins < 60 ? `${mins} min` : mins === 60 ? "1 hr" : mins % 60 === 0 ? `${mins / 60} hr` : `${Math.floor(mins / 60)}h ${mins % 60}m`;

export function DurationPicker({ open, onClose, value, onChange, title = "Duration" }: Props) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const setPreset = (mins: number) => {
    haptics.selection();
    setDraft(mins);
  };

  const commit = (mins: number) => {
    // Floor at 1 minute (was 5) — short tasks like a 1-min reminder are valid.
    // 0 stays reserved for frameless/untimed tasks, handled by the caller.
    const clamped = Math.max(1, Math.min(480, mins));
    onChange(clamped);
    haptics.notify("success");
    onClose();
  };

  const draftH = Math.floor(draft / 60);
  const draftM = draft % 60;

  // Selected pill style — glassy primary gradient with glow.
  const presetOnStyle: CSSProperties = {
    background: "linear-gradient(180deg, hsl(var(--primary)/0.92) 0%, hsl(var(--primary)) 100%)",
    boxShadow:
      "inset 0 1px 0 hsl(0 0% 100% / 0.18), 0 8px 24px -8px hsl(var(--primary)/0.55), 0 0 0 1.5px hsl(var(--primary)/0.55)",
    color: "hsl(var(--primary-foreground))",
  };

  const presetOffStyle: CSSProperties = {
    background: "linear-gradient(180deg, hsl(var(--card)/0.6) 0%, hsl(var(--card)/0.35) 100%)",
    boxShadow:
      "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1px hsl(var(--border)/0.45), 0 2px 6px -3px hsl(0 0% 0% / 0.18)",
    color: "hsl(var(--foreground) / 0.9)",
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover p-0 flex flex-col"
        hideClose
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>

        {/* Header */}
        <div className="px-5 pt-6 pb-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-[12px] flex items-center justify-center bg-primary/12 border border-primary/22 shrink-0">
            <Clock className="h-[18px] w-[18px] text-primary" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] font-semibold tracking-tight leading-tight">{title}</div>
            <div className="text-[12px] text-secondary-fg/70 mt-0.5">
              How long should this task take?
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center text-secondary-fg/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors pressable shrink-0 text-[18px]"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Hero value display */}
        <div className="px-5 pb-1">
          <motion.div
            className="rounded-2xl px-5 py-5 flex items-baseline justify-center gap-1.5"
            style={{
              background: "linear-gradient(180deg, hsl(var(--primary)/0.18) 0%, hsl(var(--primary)/0.08) 100%)",
              boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1px hsl(var(--primary)/0.40), 0 8px 24px -16px hsl(var(--primary)/0.35)",
            }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26, delay: 0.05 }}
          >
            {draftH > 0 && (
              <>
                <motion.span
                  key={`h-${draftH}`}
                  initial={{ opacity: 0.4, scale: 0.85, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 480, damping: 24, mass: 0.6 }}
                  className="font-display text-[48px] font-bold tabular-nums tracking-tight leading-none text-foreground"
                >
                  {draftH}
                </motion.span>
                <span className="text-[14px] font-semibold text-secondary-fg/75 mr-1">h</span>
              </>
            )}
            {(draftM > 0 || draftH === 0) && (
              <>
                <motion.span
                  key={`m-${draftM}`}
                  initial={{ opacity: 0.4, scale: 0.85, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 480, damping: 24, mass: 0.6 }}
                  className="font-display text-[48px] font-bold tabular-nums tracking-tight leading-none text-foreground"
                >
                  {draftM}
                </motion.span>
                <span className="text-[14px] font-semibold text-secondary-fg/75">min</span>
              </>
            )}
          </motion.div>
        </div>

        {/* Preset grid */}
        <div className="px-5 pt-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80 mb-2.5 px-0.5">
            Quick pick
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p, i) => {
              const on = draft === p;
              return (
                <motion.button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  style={on ? presetOnStyle : presetOffStyle}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 360, damping: 26, delay: 0.08 + i * 0.04 }}
                  whileTap={{ scale: 0.95 }}
                  className="h-[52px] rounded-[14px] text-[14px] font-semibold tabular-nums transition-[box-shadow,background-color] duration-150"
                >
                  {presetLabel(p)}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Custom input */}
        <div className="px-5 pt-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80 mb-2.5 px-0.5">
            Custom
          </div>
          <label
            className="rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer block"
            style={{
              background: "linear-gradient(180deg, hsl(var(--card)/0.6) 0%, hsl(var(--card)/0.35) 100%)",
              boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.05), 0 0 0 1px hsl(var(--border)/0.4)",
            }}
          >
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-foreground/90">Pick exact time</div>
              <div className="text-[11.5px] text-secondary-fg/70 mt-0.5 tabular-nums">
                Hours : minutes
              </div>
            </div>
            <input
              type="time"
              step={60}
              value={toTimeStr(draft)}
              onChange={(e) => setDraft(fromTimeStr(e.target.value))}
              lang="en-GB"
              className="h-11 px-3 rounded-xl bg-background/60 text-[16px] font-mono font-semibold tabular-nums text-foreground focus:outline-none transition-colors"
              style={{ boxShadow: "inset 0 1px 2px hsl(0 0% 0% / 0.1), inset 0 0 0 1px hsl(var(--border)/0.5)" }}
              aria-label="Pick duration (hours and minutes)"
            />
          </label>
        </div>

        {/* Footer buttons */}
        <div className="px-5 pt-5 pb-3 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-[52px] rounded-[16px] border border-border/70 bg-card/30 text-[14px] font-medium text-secondary-fg/85 hover:text-foreground hover:bg-card/50 pressable transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => commit(draft)}
            disabled={draft <= 0}
            className="flex-1 h-[52px] rounded-[16px] bg-primary text-primary-foreground text-[14px] font-semibold pressable cta-glow disabled:opacity-40 disabled:pointer-events-none transition-opacity"
          >
            Set duration
          </button>
        </div>

        <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
      </SheetContent>
    </Sheet>
  );
}
