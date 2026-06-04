import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { dateStr, parseDateStr, todayDateStr } from "@/lib/daydraft";
import { haptics } from "@/lib/haptics";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Currently-applied range in YYYY-MM-DD. The sheet seeds its draft from this on open. */
  initialFrom: string;
  initialTo: string;
  /** Earliest YYYY-MM-DD the user is allowed to pick (e.g. data retention window). */
  minDate: string;
  /** Called with the committed range when the user taps Apply. */
  onApply: (from: string, to: string) => void;
  title?: string;
};

const MONTH_LONG_FMT = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const DATE_LONG_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const WEEKDAY_INITIAL_FMT = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

/** Returns the YYYY-MM-DD ymd of `date` shifted to the first of its month. */
const firstOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const lastOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);

/** Build a 6×7 grid of days for the displayed month, padded with neighbouring months. */
function buildMonthGrid(viewMonth: Date): Date[] {
  const first = firstOfMonth(viewMonth);
  // ISO-style week (Monday-first). Adjust to your preferred locale if needed.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - lead);
  // Always 6 rows × 7 cols so the grid height never jitters when months change.
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

const WEEKDAY_LABELS = (() => {
  // Generate from a known Monday so locale order matches the grid above.
  const monday = new Date(2024, 0, 1); // Mon Jan 1, 2024
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return WEEKDAY_INITIAL_FMT.format(d);
  });
})();

export function DateRangePickerSheet({
  open,
  onOpenChange,
  initialFrom,
  initialTo,
  minDate,
  onApply,
  title = "Select range",
}: Props) {
  const todayYmd = todayDateStr();

  // Draft state — only committed to caller on Apply. While the sheet is open,
  // changing dates here doesn't disturb the background page.
  const [draftFrom, setDraftFrom] = useState(initialFrom);
  const [draftTo, setDraftTo] = useState(initialTo);
  // Which endpoint the next tap should set. "from" → next tap moves the start
  // of the range; "to" → next tap moves the end. Re-tapping a day already
  // chosen as `from` jumps back into from-mode and clears `to`.
  const [editingEnd, setEditingEnd] = useState<"from" | "to">("from");
  const [viewMonth, setViewMonth] = useState(() => firstOfMonth(parseDateStr(initialFrom || todayYmd)));
  // Direction of the month-change animation: 1 = forward, -1 = back.
  const monthDirRef = useRef<1 | -1>(1);

  // Reseed draft + view month every time the sheet opens, so reopening
  // doesn't show whatever was being edited last time.
  useEffect(() => {
    if (!open) return;
    setDraftFrom(initialFrom);
    setDraftTo(initialTo);
    setEditingEnd("from");
    setViewMonth(firstOfMonth(parseDateStr(initialFrom || todayYmd)));
  }, [open, initialFrom, initialTo, todayYmd]);

  const grid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  const minDateMs = useMemo(() => parseDateStr(minDate).getTime(), [minDate]);
  const todayMs = useMemo(() => parseDateStr(todayYmd).getTime(), [todayYmd]);
  const fromMs = useMemo(() => parseDateStr(draftFrom).getTime(), [draftFrom]);
  const toMs = useMemo(() => parseDateStr(draftTo).getTime(), [draftTo]);

  const goPrevMonth = () => {
    monthDirRef.current = -1;
    setViewMonth((m) => {
      const next = new Date(m);
      next.setMonth(m.getMonth() - 1);
      return next;
    });
    haptics.selection();
  };
  const goNextMonth = () => {
    monthDirRef.current = 1;
    setViewMonth((m) => {
      const next = new Date(m);
      next.setMonth(m.getMonth() + 1);
      return next;
    });
    haptics.selection();
  };

  const tapDay = (day: Date) => {
    const ymd = dateStr(day);
    const dayMs = day.getTime();
    if (dayMs < minDateMs || dayMs > todayMs) return; // disabled, ignore
    haptics.selection();

    if (editingEnd === "from") {
      setDraftFrom(ymd);
      // If the new from is after the current to, also bump to forward so the
      // range stays valid. Otherwise leave to as-is.
      if (dayMs > toMs) setDraftTo(ymd);
      setEditingEnd("to");
    } else {
      // editingEnd === "to"
      if (dayMs < fromMs) {
        // User tapped a day before the current from — reinterpret as a fresh
        // selection (most natural: "I'm starting over from here").
        setDraftFrom(ymd);
        setDraftTo(ymd);
        setEditingEnd("to");
      } else {
        setDraftTo(ymd);
      }
    }
  };

  const handleApply = () => {
    haptics.tap();
    onApply(draftFrom, draftTo);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleQuick = (preset: "today" | "yesterday" | "last7" | "last30") => {
    const today = parseDateStr(todayYmd);
    let from = today;
    let to = today;
    if (preset === "yesterday") {
      const y = new Date(today);
      y.setDate(today.getDate() - 1);
      from = y;
      to = y;
    } else if (preset === "last7") {
      from = new Date(today);
      from.setDate(today.getDate() - 6);
    } else if (preset === "last30") {
      from = new Date(today);
      from.setDate(today.getDate() - 29);
    }
    const fromYmd = dateStr(from);
    const toYmd = dateStr(to);
    setDraftFrom(fromYmd);
    setDraftTo(toYmd);
    setEditingEnd("to");
    setViewMonth(firstOfMonth(from));
    haptics.selection();
  };

  const monthLabel = MONTH_LONG_FMT.format(viewMonth);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/45 bg-popover max-h-[88vh] p-0 flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        <SheetTitle className="sr-only">Select date range</SheetTitle>
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={handleCancel}
            className="text-[15px] text-secondary-fg hover:text-foreground pressable px-1 py-1 -ml-1 transition-colors"
          >
            Cancel
          </button>
          <p className="text-[15px] font-semibold text-foreground/95">{title}</p>
          <button
            type="button"
            onClick={handleApply}
            className="text-[15px] font-semibold text-primary hover:text-primary/85 pressable px-1 py-1 -mr-1 transition-colors"
          >
            Done
          </button>
        </div>

        {/* Range summary chip */}
        <div className="shrink-0 px-5 pb-3">
          <div className="hero-glass border border-border/35 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setEditingEnd("from")}
              className={`flex-1 min-w-0 text-left rounded-xl px-3 py-2 pressable transition-colors ${
                editingEnd === "from" ? "bg-primary/15 ring-1 ring-primary/30" : "hover:bg-foreground/[0.04]"
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/65 mb-0.5">From</p>
              <p className="text-[15px] font-semibold text-foreground/95 truncate">
                {DATE_LONG_FMT.format(parseDateStr(draftFrom))}
              </p>
            </button>
            <div className="h-8 w-px bg-border/40 shrink-0" aria-hidden />
            <button
              type="button"
              onClick={() => setEditingEnd("to")}
              className={`flex-1 min-w-0 text-left rounded-xl px-3 py-2 pressable transition-colors ${
                editingEnd === "to" ? "bg-primary/15 ring-1 ring-primary/30" : "hover:bg-foreground/[0.04]"
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/65 mb-0.5">To</p>
              <p className="text-[15px] font-semibold text-foreground/95 truncate">
                {DATE_LONG_FMT.format(parseDateStr(draftTo))}
              </p>
            </button>
          </div>
        </div>

        {/* Quick presets — one-tap common ranges so users don't have to
            scrub the calendar for "yesterday" / "last 7 days". */}
        <div className="shrink-0 px-5 pb-3 flex gap-2 overflow-x-auto no-scrollbar">
          {[
            { id: "today", label: "Today" },
            { id: "yesterday", label: "Yesterday" },
            { id: "last7", label: "Last 7 days" },
            { id: "last30", label: "Last 30 days" },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleQuick(p.id as "today" | "yesterday" | "last7" | "last30")}
              className="shrink-0 h-8 px-3 rounded-full border border-border/40 bg-foreground/[0.03] hover:bg-foreground/[0.06] text-[12px] font-medium text-foreground/85 pressable transition-colors whitespace-nowrap"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Month navigation */}
        <div className="shrink-0 px-5 pb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={goPrevMonth}
            className="h-9 w-9 rounded-full flex items-center justify-center text-foreground/85 pressable hover:bg-foreground/[0.06] transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="relative h-7 overflow-hidden flex-1 mx-2">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={monthLabel}
                initial={{ opacity: 0, x: monthDirRef.current * 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -monthDirRef.current * 12 }}
                transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.9 }}
                className="absolute inset-0 flex items-center justify-center text-[15px] font-semibold text-foreground/95 tracking-tight"
              >
                {monthLabel}
              </motion.p>
            </AnimatePresence>
          </div>
          <button
            type="button"
            onClick={goNextMonth}
            className="h-9 w-9 rounded-full flex items-center justify-center text-foreground/85 pressable hover:bg-foreground/[0.06] transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Weekday header */}
        <div className="shrink-0 px-5 pb-1.5 grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((w, i) => (
            <div key={i} className="h-6 flex items-center justify-center text-[11px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/55">
              {w}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="px-5 flex-1 overflow-y-auto" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}>
          <div className="relative">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={`${viewMonth.getFullYear()}-${viewMonth.getMonth()}`}
                initial={{ opacity: 0, x: monthDirRef.current * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -monthDirRef.current * 24 }}
                transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.95 }}
                className="grid grid-cols-7 gap-1"
              >
                {grid.map((day, i) => {
                  const ymd = dateStr(day);
                  const dayMs = day.getTime();
                  const inMonth = day.getMonth() === viewMonth.getMonth();
                  const isToday = ymd === todayYmd;
                  const isDisabled = dayMs < minDateMs || dayMs > todayMs;
                  const isFrom = ymd === draftFrom;
                  const isTo = ymd === draftTo;
                  const isEndpoint = isFrom || isTo;
                  // Strictly between from and to (exclusive of endpoints).
                  const isInRange = !isEndpoint && dayMs > fromMs && dayMs < toMs;
                  // Round the range-band only at the actual endpoints.
                  const isRangeStart = isFrom && draftFrom !== draftTo;
                  const isRangeEnd = isTo && draftFrom !== draftTo;

                  return (
                    <div key={i} className="relative h-10 flex items-center justify-center">
                      {/* Range band — sits behind the day pill, only on
                          in-range / endpoint cells. */}
                      {(isInRange || isRangeStart || isRangeEnd) && (
                        <div
                          className={`absolute inset-y-1 left-0 right-0 bg-primary/15 ${
                            isRangeStart ? "rounded-l-full ml-1" : ""
                          } ${isRangeEnd ? "rounded-r-full mr-1" : ""}`}
                          aria-hidden
                        />
                      )}
                      <motion.button
                        type="button"
                        onClick={() => tapDay(day)}
                        disabled={isDisabled}
                        whileTap={!isDisabled ? { scale: 0.88 } : undefined}
                        transition={{ type: "spring", stiffness: 500, damping: 24 }}
                        className={`relative z-[1] h-9 w-9 rounded-full text-[14px] font-semibold tabular-nums transition-colors duration-150 ${
                          isEndpoint
                            ? "bg-primary text-primary-foreground shadow-[0_4px_14px_-2px_hsl(var(--primary)/0.55)]"
                            : isToday
                              ? "ring-1 ring-primary/55 text-primary"
                              : inMonth
                                ? isDisabled
                                  ? "text-secondary-fg/30"
                                  : "text-foreground/90 hover:bg-foreground/[0.06]"
                                : "text-secondary-fg/35"
                        }`}
                        aria-label={DATE_LONG_FMT.format(day)}
                        aria-pressed={isEndpoint}
                      >
                        {day.getDate()}
                      </motion.button>
                    </div>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
