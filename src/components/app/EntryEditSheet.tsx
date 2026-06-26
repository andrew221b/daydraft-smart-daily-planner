import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Clock, AlertTriangle, Trash2, Tag, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
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
  /** Existing free-text note on the session (user-editable, separate from the
   *  adjustment audit). */
  note?: string | null;
  /** Cumulative manually-added seconds (signed). Immutable audit field. */
  adjustmentSeconds?: number | null;
  /** Append-only audit log of start-time adjustments. View-only. */
  adjustmentReason?: string | null;
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
 *
 * A reason is REQUIRED before saving. It is stored as an IMMUTABLE audit
 * record (adjustment_seconds + adjustment_reason), separate from the editable
 * session note — so the justification can never be deleted while the added
 * time stays. View it later (read-only) from the session's action menu.
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
  onCommit: (newStartedAt: Date, reason: string) => void;
}) {
  const originalStartMs = entry?.startedAtMs ?? 0;
  const endMs = entry?.endedAtMs ?? null;

  const [draftStartMs, setDraftStartMs] = useState(originalStartMs);
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setDraftStartMs(originalStartMs);
      setReason("");
    }
  }, [open, originalStartMs]);

  const ceilingMs = endMs ?? Date.now();
  const newDurationMs = Math.max(0, ceilingMs - draftStartMs);
  const oldDurationMs = Math.max(0, ceilingMs - originalStartMs);
  const addedMs = draftStartMs <= originalStartMs ? originalStartMs - draftStartMs : -(draftStartMs - originalStartMs);

  const invalid = draftStartMs >= ceilingMs;
  const reasonFilled = reason.trim().length > 0;
  const canCommit = !invalid && reasonFilled;

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
    if (!canCommit) return;
    onCommit(new Date(draftStartMs), reason.trim());
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
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover p-0 flex flex-col transition-[padding-bottom] duration-200"
        style={{ maxHeight: "92vh", paddingBottom: "var(--keyboard-inset, 0px)" }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        <SheetTitle className="sr-only">Adjust start time</SheetTitle>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 overscroll-contain">

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
                        {" "}({addedMs >= 0 ? "+" : "−"}{fmtDur(Math.abs(addedMs))})
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

          {/* ── Reason (required, stored as immutable audit) ──────────────── */}
          <div className="px-5 pt-5 pb-6">
            <div className="flex items-baseline justify-between mb-2.5 px-0.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80">
                Reason
              </div>
              <div className="text-[10px] font-medium text-amber-600/70 dark:text-amber-400/60">Required · permanent</div>
            </div>

            <textarea
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Started earlier but forgot to tap the timer"
              rows={2}
              className="w-full rounded-2xl border bg-black/[0.04] dark:bg-white/[0.04] p-3.5 text-[15px] text-foreground outline-none transition-colors placeholder:text-secondary-fg/40 resize-none"
              style={{
                fontSize: 16,
                borderColor: reasonFilled
                  ? "hsl(38 92% 50% / 0.5)"
                  : "hsl(var(--border) / 0.55)",
                boxShadow: reasonFilled
                  ? "inset 0 1px 0 hsl(0 0% 100% / 0.05), 0 0 0 3px hsl(38 92% 50% / 0.1)"
                  : "inset 0 1px 0 hsl(0 0% 100% / 0.05)",
              }}
              aria-label="Reason for adjustment"
              aria-required
            />
            <p className="mt-2 text-[11px] leading-snug text-secondary-fg/55 px-0.5">
              Saved with this session and can't be edited later — it's the record of why time was added.
            </p>
          </div>

        </div>{/* end scrollable */}

        {/* Footer — sticky outside scroll */}
        <div className="px-5 pt-3 pb-3 flex gap-2.5 shrink-0 border-t border-foreground/[0.05]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-[52px] rounded-[16px] border border-border/70 bg-card/30 text-[14px] font-medium text-secondary-fg/85 hover:text-foreground hover:bg-card/50 pressable transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!canCommit}
            className="flex-[1.4] h-[52px] rounded-[16px] text-[13.5px] font-semibold pressable disabled:pointer-events-none transition-all duration-200"
            style={{
              background: canCommit
                ? "linear-gradient(180deg, hsl(38 92% 52%) 0%, hsl(35 92% 47%) 100%)"
                : "hsl(var(--card)/0.55)",
              color: canCommit ? "hsl(30 60% 12%)" : "hsl(var(--secondary-fg)/0.75)",
              boxShadow: canCommit
                ? "0 10px 28px -8px hsl(38 92% 50% / 0.45)"
                : "inset 0 0 0 1px hsl(var(--border)/0.5)",
            }}
          >
            {reasonFilled ? "Save start" : "Add a reason first"}
          </button>
        </div>

        <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
      </SheetContent>
    </Sheet>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * SessionTaskSheet — name the task you worked on (`task_title`).
 * ──────────────────────────────────────────────────────────────────────── */
export function SessionTaskSheet({
  open,
  onClose,
  initialTitle,
  categoryName,
  categoryColor,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initialTitle: string;
  categoryName?: string | null;
  categoryColor?: string | null;
  onSave: (title: string) => void;
}) {
  const [draft, setDraft] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initialTitle);
    const id = window.setTimeout(() => inputRef.current?.focus(), 130);
    return () => window.clearTimeout(id);
  }, [open, initialTitle]);

  const commit = () => {
    onSave(draft.trim());
    haptics.notify("success");
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover p-0 flex flex-col transition-[padding-bottom] duration-200"
        style={{ maxHeight: "86vh", paddingBottom: "var(--keyboard-inset, 0px)" }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        <SheetTitle className="sr-only">Name this task</SheetTitle>

        {/* Header */}
        <div className="px-5 pt-6 pb-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-[12px] flex items-center justify-center bg-primary/12 border border-primary/25 shrink-0">
            <Tag className="h-[18px] w-[18px] text-primary" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] font-semibold tracking-tight leading-tight">Name this task</div>
            <div className="text-[12px] text-secondary-fg/70 mt-0.5 truncate">
              {categoryName ? (
                <>What you worked on in{" "}
                  <span className="font-semibold" style={{ color: categoryColor || undefined }}>{categoryName}</span>
                </>
              ) : (
                "Give it a short, recognisable name"
              )}
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

        {/* Input */}
        <div className="px-5 pt-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
            placeholder="e.g. Layout work, Frontend tasks"
            maxLength={120}
            className="w-full h-12 rounded-2xl border border-black/[0.08] dark:border-white/[0.09] bg-black/[0.04] dark:bg-white/[0.04] px-4 text-[15px] font-medium text-foreground outline-none focus:border-primary/55 transition-colors placeholder:text-secondary-fg/55 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06)] dark:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.05)]"
            style={{ fontSize: 16 }}
            aria-label="Task name"
          />
        </div>

        {/* Footer */}
        <div className="px-5 pt-4 pb-3 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-[52px] rounded-[16px] border border-border/70 bg-card/30 text-[14px] font-medium text-secondary-fg/85 hover:text-foreground hover:bg-card/50 pressable transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            className="flex-[1.6] h-[52px] rounded-[16px] bg-primary text-primary-foreground text-[14px] font-semibold pressable cta-glow transition-opacity"
          >
            {draft.trim() ? "Save name" : initialTitle ? "Clear name" : "Save"}
          </button>
        </div>

        <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
      </SheetContent>
    </Sheet>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * SessionNoteSheet — add long text notes (`note`).
 * ──────────────────────────────────────────────────────────────────────── */
export function SessionNoteSheet({
  open,
  onClose,
  initialNote,
  categoryName,
  categoryColor,
  onSave,
  saveLabel,
}: {
  open: boolean;
  onClose: () => void;
  initialNote: string;
  categoryName?: string | null;
  categoryColor?: string | null;
  onSave: (note: string) => void;
  saveLabel?: string;
}) {
  const [draft, setDraft] = useState(initialNote);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initialNote);
    const id = window.setTimeout(() => inputRef.current?.focus(), 130);
    return () => window.clearTimeout(id);
  }, [open, initialNote]);

  const commit = () => {
    const trimmed = draft.trim();
    // Nothing to write: no prior note, and the user typed nothing (or only
    // whitespace). Saving that would silently persist an empty value — tell
    // them instead of writing a no-op.
    if (!trimmed && !initialNote.trim()) {
      toast("Note was empty", { description: "Nothing was saved" });
      onClose();
      return;
    }
    onSave(trimmed);
    haptics.notify("success");
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover p-0 flex flex-col transition-[padding-bottom] duration-200"
        style={{ maxHeight: "86vh", paddingBottom: "var(--keyboard-inset, 0px)" }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        <SheetTitle className="sr-only">Add notes</SheetTitle>

        {/* Header */}
        <div className="px-5 pt-6 pb-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-[12px] flex items-center justify-center bg-violet-500/12 border border-violet-500/25 shrink-0">
            <FileText className="h-[18px] w-[18px] text-violet-500" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] font-semibold tracking-tight leading-tight">Session notes</div>
            <div className="text-[12px] text-secondary-fg/70 mt-0.5 truncate">
              {categoryName ? (
                <>Add details for your session in{" "}
                  <span className="font-semibold" style={{ color: categoryColor || undefined }}>{categoryName}</span>
                </>
              ) : (
                "Add details about what you accomplished"
              )}
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

        {/* Input */}
        <div className="px-5 pt-2 flex-1 flex flex-col min-h-[60px]">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Fixed the navbar layout, reviewed PRs..."
            className="w-full flex-1 min-h-[60px] rounded-2xl border border-black/[0.08] dark:border-white/[0.09] bg-black/[0.04] dark:bg-white/[0.04] p-4 text-[15px] font-medium text-foreground outline-none focus:border-violet-500/55 transition-colors placeholder:text-secondary-fg/55 resize-none shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06)] dark:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.05)]"
            style={{ fontSize: 16 }}
            aria-label="Notes"
          />
        </div>

        {/* Footer */}
        <div className="px-5 pt-4 pb-3 flex gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-[52px] rounded-[16px] border border-border/70 bg-card/30 text-[14px] font-medium text-secondary-fg/85 hover:text-foreground hover:bg-card/50 pressable transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            className="flex-[1.6] h-[52px] rounded-[16px] bg-violet-600 text-white text-[14px] font-semibold pressable shadow-[0_10px_28px_-8px_hsl(var(--violet-600)/0.55)] transition-opacity"
          >
            {saveLabel || (draft.trim() ? "Save notes" : initialNote ? "Clear notes" : "Save")}
          </button>
        </div>

        <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
      </SheetContent>
    </Sheet>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * ReportsActionSheet — A premium grid menu for session actions in Reports.
 * ──────────────────────────────────────────────────────────────────────── */
export function ReportsActionSheet({
  open,
  onClose,
  entry,
  onEditTask,
  onEditNote,
  onEditTime,
  onViewReason,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  entry: EditableEntry | null;
  onEditTask: () => void;
  onEditNote: () => void;
  onEditTime: () => void;
  onViewReason: () => void;
  onDelete: () => void;
}) {
  const hasAdjustment = !!(entry && (entry.adjustmentSeconds ?? 0) !== 0 && (entry.adjustmentReason ?? "").trim());

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover p-0 flex flex-col"
        hideClose
      >
        <SheetTitle className="sr-only">Session Actions</SheetTitle>

        <div className="px-5 pt-6 pb-2 flex items-center justify-between">
          <div className="min-w-0">
            <div className="font-display text-[19px] font-semibold tracking-tight leading-tight">Session Options</div>
            {entry?.categoryName && (
              <div className="text-[12px] text-secondary-fg/70 mt-0.5 truncate">
                <span className="font-semibold" style={{ color: entry.categoryColor || undefined }}>{entry.categoryName}</span> session
              </div>
            )}
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

        <div className="px-5 py-4">
          <div className="grid grid-cols-4 gap-2.5">
            <button
              onClick={() => { haptics.selection(); onClose(); setTimeout(onEditTask, 150); }}
              className="flex flex-col items-center justify-center gap-1.5 rounded-[18px] py-4 px-1 border border-black/[0.08] dark:border-white/[0.09] bg-black/[0.05] dark:bg-white/[0.04] shadow-sm pressable transition-[border-color,background-color] hover:bg-black/[0.08] hover:border-black/[0.14] dark:hover:bg-white/[0.08] dark:hover:border-white/[0.14]"
            >
              <div className="flex h-[22px] items-center justify-center text-primary/90">
                <Tag className="h-5 w-5" />
              </div>
              <span className="text-[10.5px] font-medium text-secondary-fg/70 leading-none tracking-wide">Task</span>
            </button>
            <button
              onClick={() => { haptics.selection(); onClose(); setTimeout(onEditNote, 150); }}
              className="flex flex-col items-center justify-center gap-1.5 rounded-[18px] py-4 px-1 border border-black/[0.08] dark:border-white/[0.09] bg-black/[0.05] dark:bg-white/[0.04] shadow-sm pressable transition-[border-color,background-color] hover:bg-black/[0.08] hover:border-black/[0.14] dark:hover:bg-white/[0.08] dark:hover:border-white/[0.14]"
            >
              <div className="flex h-[22px] items-center justify-center text-violet-500/90">
                <FileText className="h-5 w-5" />
              </div>
              <span className="text-[10.5px] font-medium text-secondary-fg/70 leading-none tracking-wide">Notes</span>
            </button>
            <button
              onClick={() => { haptics.selection(); onClose(); setTimeout(onEditTime, 150); }}
              className="flex flex-col items-center justify-center gap-1.5 rounded-[18px] py-4 px-1 border border-black/[0.08] dark:border-white/[0.09] bg-black/[0.05] dark:bg-white/[0.04] shadow-sm pressable transition-[border-color,background-color] hover:bg-black/[0.08] hover:border-black/[0.14] dark:hover:bg-white/[0.08] dark:hover:border-white/[0.14]"
            >
              <div className="flex h-[22px] items-center justify-center text-amber-500/90">
                <Clock className="h-5 w-5" />
              </div>
              <span className="text-[10.5px] font-medium text-secondary-fg/70 leading-none tracking-wide">Time</span>
            </button>
            <button
              onClick={() => { haptics.selection(); onClose(); setTimeout(onDelete, 150); }}
              className="flex flex-col items-center justify-center gap-1.5 rounded-[18px] py-4 px-1 border border-destructive/15 bg-destructive/[0.06] shadow-sm pressable transition-[border-color,background-color] hover:bg-destructive/[0.11] hover:border-destructive/25"
            >
              <div className="flex h-[22px] items-center justify-center text-destructive/80">
                <Trash2 className="h-5 w-5" />
              </div>
              <span className="text-[10.5px] font-medium text-destructive/80 leading-none tracking-wide">Delete</span>
            </button>
          </div>

          {/* Read-only audit: visible only when time was manually added. */}
          {hasAdjustment && (
            <button
              onClick={() => { haptics.selection(); onClose(); setTimeout(onViewReason, 150); }}
              className="mt-2.5 w-full flex items-center gap-2.5 rounded-[16px] px-4 py-3 border border-amber-500/20 bg-amber-500/[0.07] pressable transition-colors hover:bg-amber-500/[0.11]"
            >
              <Clock className="h-[18px] w-[18px] text-amber-500 shrink-0" strokeWidth={2} />
              <div className="min-w-0 flex-1 text-left">
                <div className="text-[13px] font-semibold text-foreground/90 leading-tight">
                  {fmtSignedMin(entry?.adjustmentSeconds ?? 0)} added manually
                </div>
                <div className="text-[11px] text-secondary-fg/65 leading-tight mt-0.5">Tap to view the reason</div>
              </div>
              <span className="text-secondary-fg/35 text-[15px] shrink-0">›</span>
            </button>
          )}
        </div>

        <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
      </SheetContent>
    </Sheet>
  );
}

/** "+1h 30m" / "−15m" from a signed seconds value. */
const fmtSignedMin = (sec: number): string => {
  const mins = Math.round(Math.abs(sec) / 60);
  const sign = sec >= 0 ? "+" : "−";
  if (mins < 60) return `${sign}${mins}m`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return r ? `${sign}${h}h ${r}m` : `${sign}${h}h`;
};

/* ──────────────────────────────────────────────────────────────────────────
 * AdjustmentInfoSheet — READ-ONLY view of a session's manual-time audit.
 * Reached from the session action menu. Shows the cumulative added time and
 * the append-only reason log. No edit / delete affordance by design — this is
 * the permanent record of why time was added.
 * ──────────────────────────────────────────────────────────────────────── */
export function AdjustmentInfoSheet({
  open,
  onClose,
  entry,
}: {
  open: boolean;
  onClose: () => void;
  entry: EditableEntry | null;
}) {
  const sec = entry?.adjustmentSeconds ?? 0;
  const lines = (entry?.adjustmentReason ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover p-0 flex flex-col"
        hideClose
      >
        <SheetTitle className="sr-only">Manual time adjustment</SheetTitle>

        {/* Header */}
        <div className="px-5 pt-6 pb-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-[12px] flex items-center justify-center bg-amber-500/12 border border-amber-500/25 shrink-0">
            <Clock className="h-[18px] w-[18px] text-amber-500" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] font-semibold tracking-tight leading-tight">Time added manually</div>
            <div className="text-[12px] text-secondary-fg/70 mt-0.5">Permanent record · view only</div>
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

        {/* Total badge */}
        <div className="px-5 pt-1">
          <div
            className="rounded-2xl px-5 py-4 flex items-baseline justify-center gap-2"
            style={{
              background: "linear-gradient(180deg, hsl(38 92% 50% / 0.14) 0%, hsl(38 92% 50% / 0.05) 100%)",
              boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1px hsl(38 92% 50% / 0.3)",
            }}
          >
            <span className="font-display text-[32px] font-bold tabular-nums tracking-tight leading-none text-amber-600 dark:text-amber-400">
              {fmtSignedMin(sec)}
            </span>
            <span className="text-[12px] text-secondary-fg/70">{sec >= 0 ? "added in total" : "removed in total"}</span>
          </div>
        </div>

        {/* Reason log */}
        <div className="px-5 pt-4 pb-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80 mb-2.5 px-0.5">
            {lines.length > 1 ? "Reasons" : "Reason"}
          </div>
          <div className="space-y-2">
            {lines.length ? lines.map((line, i) => {
              // Each line is "+30m — reason". Split off the delta tag for emphasis.
              const m = line.match(/^([+−][\dhm\s]+)\s*—\s*(.*)$/);
              const tag = m?.[1]?.trim();
              const body = m?.[2]?.trim() ?? line;
              return (
                <div
                  key={i}
                  className="px-3.5 py-2.5 rounded-[14px] border border-foreground/[0.07]"
                  style={{ background: "hsl(var(--card)/0.45)" }}
                >
                  {tag && (
                    <span className="inline-block mb-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold tabular-nums bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      {tag}
                    </span>
                  )}
                  <p className="text-[13.5px] text-foreground/85 leading-relaxed">{body}</p>
                </div>
              );
            }) : (
              <p className="text-[13px] text-secondary-fg/60 italic">No reason recorded.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pt-3 pb-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full h-[52px] rounded-[16px] border border-border/70 bg-card/30 text-[14px] font-medium text-secondary-fg/85 hover:text-foreground hover:bg-card/50 pressable transition-colors"
          >
            Done
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
      <AlertDialogContent className="w-[calc(100vw-48px)] max-w-[340px] rounded-3xl border-border/70 bg-surface/95 p-0 backdrop-blur-2xl">
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
          <AlertDialogCancel className="h-11 w-full rounded-2xl border-border/65 bg-foreground/[0.05] text-foreground font-semibold text-[15px] hover:bg-foreground/[0.09] mt-0 pressable">
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
