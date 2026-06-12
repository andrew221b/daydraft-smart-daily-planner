import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Clock, AlertTriangle, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { haptics } from "@/lib/haptics";

/** Minimal shape the editor needs about a tracked session. Times are epoch ms;
 *  `endedAtMs = null` means the session is still running. */
export type EditableEntry = {
  id: string;
  startedAtMs: number;
  endedAtMs: number | null;
  categoryName?: string | null;
  categoryColor?: string | null;
};

/** "How much earlier did I really start" presets (minutes added to tracked time). */
const ADD_PRESETS = [15, 30, 60, 120];

const fmtDur = (ms: number): string => {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

const presetLabel = (mins: number) =>
  mins < 60 ? `+${mins}m` : mins % 60 === 0 ? `+${mins / 60}h` : `+${Math.floor(mins / 60)}h ${mins % 60}m`;

const toHHMM = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const fmtClock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/* ──────────────────────────────────────────────────────────────────────────
 * EntryStartSheet — adjust a tracked session's start time.
 *
 * Styled after DurationPicker but with an amber "warning" accent (this edits
 * real recorded data). Presets move the start EARLIER from the original by a
 * fixed amount (adds to tracked time); the custom input sets an exact start
 * clock on the original session's day.
 * ──────────────────────────────────────────────────────────────────────── */
export function EntryStartSheet({
  open,
  onClose,
  entry,
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  entry: EditableEntry | null;
  onCommit: (newStartedAt: Date) => void;
}) {
  const originalStartMs = entry?.startedAtMs ?? 0;
  const endMs = entry?.endedAtMs ?? null;

  const [draftStartMs, setDraftStartMs] = useState(originalStartMs);

  useEffect(() => {
    if (open) setDraftStartMs(originalStartMs);
  }, [open, originalStartMs]);

  // The deadline the start must stay before: the recorded end, or "now" while running.
  const ceilingMs = endMs ?? Date.now();
  const newDurationMs = Math.max(0, ceilingMs - draftStartMs);
  const oldDurationMs = Math.max(0, ceilingMs - originalStartMs);
  const addedMs = draftStartMs <= originalStartMs ? originalStartMs - draftStartMs : -(draftStartMs - originalStartMs);

  const invalid = draftStartMs >= ceilingMs;

  const setPreset = (mins: number) => {
    haptics.selection();
    setDraftStartMs(originalStartMs - mins * 60_000);
  };

  const setCustom = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    const base = new Date(originalStartMs);
    base.setHours(h, m, 0, 0);
    setDraftStartMs(base.getTime());
  };

  const activePreset = useMemo(() => {
    const delta = Math.round((originalStartMs - draftStartMs) / 60_000);
    return ADD_PRESETS.includes(delta) ? delta : null;
  }, [originalStartMs, draftStartMs]);

  const commit = () => {
    if (invalid) return;
    onCommit(new Date(draftStartMs));
    haptics.notify("success");
    onClose();
  };

  const presetOnStyle: CSSProperties = {
    background: "linear-gradient(180deg, hsl(38 92% 52% / 0.95) 0%, hsl(35 92% 47%) 100%)",
    boxShadow:
      "inset 0 1px 0 hsl(0 0% 100% / 0.22), 0 8px 24px -8px hsl(38 92% 50% / 0.55), 0 0 0 1.5px hsl(38 92% 50% / 0.55)",
    color: "hsl(30 60% 12%)",
  };
  const presetOffStyle: CSSProperties = {
    background: "linear-gradient(180deg, hsl(var(--card)/0.6) 0%, hsl(var(--card)/0.35) 100%)",
    boxShadow:
      "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1px hsl(var(--border)/0.45), 0 2px 6px -3px hsl(0 0% 0% / 0.18)",
    color: "hsl(var(--foreground) / 0.9)",
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover p-0 flex flex-col" hideClose>
        <SheetTitle className="sr-only">Adjust start time</SheetTitle>

        {/* Header */}
        <div className="px-5 pt-6 pb-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-[12px] flex items-center justify-center bg-amber-500/12 border border-amber-500/25 shrink-0">
            <Clock className="h-[18px] w-[18px] text-amber-500" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] font-semibold tracking-tight leading-tight">Adjust start time</div>
            <div className="text-[12px] text-secondary-fg/70 mt-0.5">Set when you actually started</div>
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

        {/* Warning note */}
        <div className="px-5">
          <div className="flex items-start gap-2.5 rounded-2xl px-3.5 py-2.5 border border-amber-500/25 bg-amber-500/[0.07]">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-px" strokeWidth={2.2} />
            <p className="text-[12px] leading-snug text-amber-700 dark:text-amber-300/90">
              Moving the start earlier adds that time to this session. The end stays the same.
            </p>
          </div>
        </div>

        {/* Hero value display */}
        <div className="px-5 pt-3">
          <motion.div
            className="rounded-2xl px-5 py-4 flex flex-col items-center gap-1"
            style={{
              background: "linear-gradient(180deg, hsl(38 92% 50% / 0.16) 0%, hsl(38 92% 50% / 0.06) 100%)",
              boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1px hsl(38 92% 50% / 0.35), 0 8px 24px -16px hsl(38 92% 50% / 0.3)",
            }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[40px] font-bold tabular-nums tracking-tight leading-none text-foreground">
                {fmtClock(draftStartMs)}
              </span>
            </div>
            <div className="text-[12px] tabular-nums text-secondary-fg/75 mt-1">
              {invalid ? (
                <span className="text-destructive font-medium">Start must be before {fmtClock(ceilingMs)}</span>
              ) : (
                <>
                  Tracked <span className="font-semibold text-foreground/90">{fmtDur(newDurationMs)}</span>
                  {Math.abs(addedMs) >= 60_000 && (
                    <span className={addedMs >= 0 ? "text-amber-600 dark:text-amber-400" : "text-secondary-fg/70"}>
                      {" "}
                      ({addedMs >= 0 ? "+" : "−"}
                      {fmtDur(Math.abs(addedMs))})
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="text-[11px] text-secondary-fg/50 tabular-nums">
              was {fmtClock(originalStartMs)} · {fmtDur(oldDurationMs)}
            </div>
          </motion.div>
        </div>

        {/* Presets */}
        <div className="px-5 pt-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80 mb-2.5 px-0.5">
            Add time
          </div>
          <div className="grid grid-cols-4 gap-2">
            {ADD_PRESETS.map((p) => {
              const on = activePreset === p;
              return (
                <motion.button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  style={on ? presetOnStyle : presetOffStyle}
                  whileTap={{ scale: 0.95 }}
                  className="h-[48px] rounded-[14px] text-[13px] font-semibold tabular-nums transition-[box-shadow,background-color] duration-150"
                >
                  {presetLabel(p)}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Custom exact start */}
        <div className="px-5 pt-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80 mb-2.5 px-0.5">
            Exact start
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
              <div className="text-[11.5px] text-secondary-fg/70 mt-0.5">When the work really began</div>
            </div>
            <input
              type="time"
              step={60}
              value={toHHMM(draftStartMs)}
              onChange={(e) => setCustom(e.target.value)}
              className="h-11 px-3 rounded-xl bg-background/60 text-[16px] font-mono font-semibold tabular-nums text-foreground focus:outline-none transition-colors"
              style={{ boxShadow: "inset 0 1px 2px hsl(0 0% 0% / 0.1), inset 0 0 0 1px hsl(var(--border)/0.5)" }}
              aria-label="Pick exact start time"
            />
          </label>
        </div>

        {/* Footer */}
        <div className="px-5 pt-5 pb-3 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-[52px] rounded-[16px] border border-border/40 bg-card/30 text-[14px] font-medium text-secondary-fg/85 hover:text-foreground hover:bg-card/50 pressable transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={invalid}
            className="flex-1 h-[52px] rounded-[16px] text-[14px] font-semibold pressable shadow-[0_10px_28px_-8px_hsl(38_92%_50%/0.55)] disabled:opacity-40 disabled:pointer-events-none transition-opacity"
            style={{
              background: "linear-gradient(180deg, hsl(38 92% 52%) 0%, hsl(35 92% 47%) 100%)",
              color: "hsl(30 60% 12%)",
            }}
          >
            Save start
          </button>
        </div>

        <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
      </SheetContent>
    </Sheet>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * EntryDeleteDialog — destructive confirm before removing a tracked session.
 * ──────────────────────────────────────────────────────────────────────── */
export function EntryDeleteDialog({
  open,
  onOpenChange,
  entry,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: EditableEntry | null;
  onConfirm: () => void;
}) {
  const durMs = entry ? Math.max(0, (entry.endedAtMs ?? Date.now()) - entry.startedAtMs) : 0;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-48px)] max-w-[340px] rounded-3xl border-border/40 bg-surface/95 p-0 backdrop-blur-2xl">
        <AlertDialogHeader className="px-6 pt-6 pb-0 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/12 border border-destructive/20">
            <Trash2 className="h-5 w-5 text-destructive" />
          </div>
          <AlertDialogTitle className="text-[17px] font-semibold">Delete tracked time?</AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] text-secondary-fg/80 mt-1">
            {entry?.categoryName ? (
              <>
                This {fmtDur(durMs)} session in{" "}
                <span className="font-medium text-foreground/80">{entry.categoryName}</span> will be permanently removed.
              </>
            ) : (
              <>This {fmtDur(durMs)} session will be permanently removed.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col gap-2 px-6 py-5 sm:flex-col sm:space-x-0">
          <AlertDialogAction
            onClick={() => { haptics.impact("medium"); onConfirm(); }}
            className="h-11 w-full rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold text-[15px] border-0 pressable"
          >
            Delete
          </AlertDialogAction>
          <AlertDialogCancel className="h-11 w-full rounded-2xl border-border/35 bg-foreground/[0.05] text-foreground font-semibold text-[15px] hover:bg-foreground/[0.09] mt-0 pressable">
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
