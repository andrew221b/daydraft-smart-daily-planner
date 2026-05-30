import { useMemo, useRef, useEffect, useState } from "react";
import { CalendarDays, LayoutList, ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { dateStr, parseDateStr, todayDateStr } from "@/lib/daydraft";
import { buildMonthGrid, firstOfMonth, WEEKDAY_NARROW_LABELS } from "@/lib/calendarGrid";
import { haptics } from "@/lib/haptics";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: string;
  onPick: (next: string) => void;
  pastDays?: number;
  futureDays?: number;
  title?: string;
  subtitle?: string;
};

type DayCell = {
  ymd: string;
  date: Date;
  isToday: boolean;
  isPast: boolean;
  isSelected: boolean;
  weekday: string;
  day: number;
  month: string;
};

const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: "short" });
const MONTH_LONG_FMT = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const DATE_LONG_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

// Shared "selected day" surface — glassy primary gradient with a glow ring.
// Reused by both the compact scroller pill and the expanded grid pill so the
// two views read as one design.
const SELECTED_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, hsl(var(--primary)/0.92) 0%, hsl(var(--primary)) 100%)",
  boxShadow:
    "inset 0 1px 0 hsl(0 0% 100% / 0.18), 0 8px 24px -8px hsl(var(--primary)/0.65), 0 0 0 1.5px hsl(var(--primary)/0.55)",
};

export function DayPickerSheet({
  open,
  onOpenChange,
  value,
  onPick,
  pastDays = 3,
  futureDays = 28,
  title = "Pick a day",
  subtitle,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  const todayYmd = todayDateStr();

  // Allowed window, derived from pastDays / futureDays. Days outside are
  // disabled in the expanded grid (the compact scroller simply doesn't list them).
  const minDate = useMemo(() => {
    const d = parseDateStr(todayYmd);
    d.setDate(d.getDate() - pastDays);
    return d;
  }, [todayYmd, pastDays]);
  const maxDate = useMemo(() => {
    const d = parseDateStr(todayYmd);
    d.setDate(d.getDate() + futureDays);
    return d;
  }, [todayYmd, futureDays]);
  const minMs = minDate.getTime();
  const maxMs = maxDate.getTime();

  const cells = useMemo<DayCell[]>(() => {
    const today = parseDateStr(todayYmd);
    const todayMs = today.getTime();
    const list: DayCell[] = [];
    for (let i = -pastDays; i <= futureDays; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const ymd = dateStr(d);
      list.push({
        ymd, date: d,
        isToday: d.getTime() === todayMs,
        isPast: d.getTime() < todayMs,
        isSelected: ymd === value,
        weekday: WEEKDAY_FMT.format(d),
        day: d.getDate(),
        month: MONTH_FMT.format(d),
      });
    }
    return list;
  }, [pastDays, futureDays, value, todayYmd]);

  // ── Expanded month-grid state ─────────────────────────────────────────────
  const [viewMonth, setViewMonth] = useState(() => firstOfMonth(parseDateStr(value || todayYmd)));
  const monthDirRef = useRef<1 | -1>(1);

  // On open: collapse back to the compact scroller and re-seed the month view
  // on the selected day, so reopening is always predictable.
  useEffect(() => {
    if (!open) return;
    setExpanded(false);
    setViewMonth(firstOfMonth(parseDateStr(value || todayYmd)));
  }, [open, value, todayYmd]);

  const grid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const minMonthMs = useMemo(() => firstOfMonth(minDate).getTime(), [minDate]);
  const maxMonthMs = useMemo(() => firstOfMonth(maxDate).getTime(), [maxDate]);
  const canPrev = viewMonth.getTime() > minMonthMs;
  const canNext = viewMonth.getTime() < maxMonthMs;

  const goPrevMonth = () => {
    if (!canPrev) return;
    monthDirRef.current = -1;
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
    haptics.selection();
  };
  const goNextMonth = () => {
    if (!canNext) return;
    monthDirRef.current = 1;
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
    haptics.selection();
  };

  // Centre selected pill on open (compact mode only).
  useEffect(() => {
    if (!open || expanded) return;
    const id = requestAnimationFrame(() => {
      const el = scrollerRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
      if (!el || !scrollerRef.current) return;
      const scroller = scrollerRef.current;
      const target = el.offsetLeft - scroller.clientWidth / 2 + el.clientWidth / 2;
      scroller.scrollTo({ left: Math.max(0, target), behavior: "instant" as ScrollBehavior });
    });
    return () => cancelAnimationFrame(id);
  }, [open, expanded]);

  // Intercept horizontal swipes so Radix Sheet doesn't dismiss on pan-x.
  useEffect(() => {
    if (expanded) return;
    const el = scrollerRef.current;
    if (!el) return;
    let startX = 0, startY = 0, decided = false, isHoriz = false;
    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      decided = false; isHoriz = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!decided) {
        const dx = Math.abs(e.touches[0].clientX - startX);
        const dy = Math.abs(e.touches[0].clientY - startY);
        if (dx > 4 || dy > 4) { decided = true; isHoriz = dx > dy; }
      }
      if (isHoriz) e.stopPropagation();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, [open, expanded]);

  const groups = useMemo(() => {
    const out: { month: string; cells: DayCell[] }[] = [];
    cells.forEach((c) => {
      const last = out[out.length - 1];
      if (last && last.month === c.month) last.cells.push(c);
      else out.push({ month: c.month, cells: [c] });
    });
    return out;
  }, [cells]);

  const isValueToday = value === todayYmd;
  const monthLabel = MONTH_LONG_FMT.format(viewMonth);

  const pick = (ymd: string) => {
    haptics.selection();
    onPick(ymd);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/45 bg-popover max-h-[90vh] p-0 flex flex-col"
        hideClose
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>

        {/* Header */}
        <div className="shrink-0 px-5 pt-6 pb-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-[12px] flex items-center justify-center bg-primary/12 border border-primary/20 shrink-0">
            <CalendarDays className="text-primary" strokeWidth={2} style={{ width: 18, height: 18 }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[18px] font-semibold tracking-tight leading-tight">{title}</div>
            {subtitle && (
              <p className="text-[12px] text-secondary-fg/75 mt-0.5 leading-snug">{subtitle}</p>
            )}
          </div>

          {/* Expand / collapse toggle */}
          <button
            type="button"
            onClick={() => { haptics.selection(); setExpanded((e) => !e); }}
            aria-label={expanded ? "Compact view" : "Full calendar"}
            aria-pressed={expanded}
            className={[
              "h-8 px-2.5 rounded-full inline-flex items-center gap-1.5 text-[12px] font-semibold pressable transition-colors shrink-0",
              expanded
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : "bg-foreground/[0.04] text-secondary-fg/85 hover:text-foreground ring-1 ring-border/40",
            ].join(" ")}
          >
            <AnimatePresence mode="wait" initial={false}>
              {expanded ? (
                <motion.span
                  key="days"
                  initial={{ opacity: 0, rotate: -30, scale: 0.7 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 30, scale: 0.7 }}
                  transition={{ duration: 0.18 }}
                  className="inline-flex"
                >
                  <LayoutList style={{ width: 15, height: 15 }} />
                </motion.span>
              ) : (
                <motion.span
                  key="month"
                  initial={{ opacity: 0, rotate: 30, scale: 0.7 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: -30, scale: 0.7 }}
                  transition={{ duration: 0.18 }}
                  className="inline-flex"
                >
                  <CalendarDays style={{ width: 15, height: 15 }} />
                </motion.span>
              )}
            </AnimatePresence>
            {expanded ? "Days" : "Month"}
          </button>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 w-8 rounded-full flex items-center justify-center text-secondary-fg/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors pressable shrink-0 text-[16px] font-medium"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body — compact scroller ⇄ expanded month grid */}
        <AnimatePresence mode="wait" initial={false}>
          {expanded ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0, y: 10, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.985 }}
              transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.85 }}
              className="flex-1 min-h-0 flex flex-col"
            >
              {/* Month navigation */}
              <div className="shrink-0 px-5 pb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={goPrevMonth}
                  disabled={!canPrev}
                  className="h-9 w-9 rounded-full flex items-center justify-center text-foreground/85 pressable hover:bg-foreground/[0.06] transition-colors disabled:opacity-25 disabled:pointer-events-none"
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
                  disabled={!canNext}
                  className="h-9 w-9 rounded-full flex items-center justify-center text-foreground/85 pressable hover:bg-foreground/[0.06] transition-colors disabled:opacity-25 disabled:pointer-events-none"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>

              {/* Weekday header */}
              <div className="shrink-0 px-5 pb-1.5 grid grid-cols-7 gap-1">
                {WEEKDAY_NARROW_LABELS.map((w, i) => (
                  <div key={i} className="h-6 flex items-center justify-center text-[11px] font-semibold uppercase tracking-[0.1em] text-secondary-fg/55">
                    {w}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="px-5 flex-1 overflow-y-auto" style={{ paddingBottom: 8 }}>
                <div className="relative">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={`${viewMonth.getFullYear()}-${viewMonth.getMonth()}`}
                      initial={{ opacity: 0, x: monthDirRef.current * 26 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -monthDirRef.current * 26 }}
                      transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.95 }}
                      className="grid grid-cols-7 gap-1"
                    >
                      {grid.map((day, i) => {
                        const ymd = dateStr(day);
                        const dayMs = day.getTime();
                        const inMonth = day.getMonth() === viewMonth.getMonth();
                        const isToday = ymd === todayYmd;
                        const isSelected = ymd === value;
                        const isDisabled = dayMs < minMs || dayMs > maxMs;

                        return (
                          <div key={i} className="relative h-11 flex items-center justify-center">
                            <motion.button
                              type="button"
                              onClick={() => { if (!isDisabled) pick(ymd); }}
                              disabled={isDisabled}
                              whileTap={!isDisabled ? { scale: 0.86 } : undefined}
                              transition={{ type: "spring", stiffness: 500, damping: 24 }}
                              style={isSelected ? SELECTED_STYLE : undefined}
                              className={[
                                "relative h-9 w-9 rounded-full text-[14px] font-semibold tabular-nums transition-[background-color,box-shadow,color] duration-150 flex items-center justify-center",
                                isSelected
                                  ? "text-primary-foreground"
                                  : isToday
                                    ? "ring-1 ring-primary/55 text-primary"
                                    : inMonth
                                      ? isDisabled
                                        ? "text-secondary-fg/25"
                                        : "text-foreground/90 hover:bg-foreground/[0.06]"
                                      : isDisabled
                                        ? "text-secondary-fg/15"
                                        : "text-secondary-fg/40 hover:bg-foreground/[0.04]",
                              ].join(" ")}
                              aria-label={DATE_LONG_FMT.format(day)}
                              aria-pressed={isSelected}
                            >
                              {day.getDate()}
                              {/* Today dot — only when not selected */}
                              {isToday && !isSelected && (
                                <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 h-[3px] w-[3px] rounded-full bg-primary" aria-hidden />
                              )}
                            </motion.button>
                          </div>
                        );
                      })}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="scroller"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.85 }}
              className="shrink-0"
            >
              <div
                ref={scrollerRef}
                className="overflow-x-scroll no-scrollbar"
                style={{
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-x",
                  overscrollBehaviorX: "contain",
                } as React.CSSProperties}
              >
                <div className="flex items-stretch gap-2 px-5 pt-2 pb-2">
                  {groups.map((g, gi) => (
                    <div key={`${g.month}-${gi}`} className="flex items-stretch gap-2">
                      {/* Month label separator */}
                      <div className="flex flex-col items-center justify-center px-1 shrink-0">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-secondary-fg/50">
                          {g.month}
                        </span>
                      </div>
                      {g.cells.map((c) => (
                        <motion.button
                          key={c.ymd}
                          type="button"
                          data-selected={c.isSelected}
                          onClick={() => pick(c.ymd)}
                          whileTap={{ scale: 0.94 }}
                          transition={{ type: "spring", stiffness: 500, damping: 24 }}
                          style={{
                            touchAction: "pan-x",
                            ...(c.isSelected ? SELECTED_STYLE
                              : c.isToday ? {
                                background: "linear-gradient(180deg, hsl(var(--primary)/0.12) 0%, hsl(var(--primary)/0.06) 100%)",
                                boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1.5px hsl(var(--primary)/0.35)",
                              } : c.isPast ? {
                                background: "linear-gradient(180deg, hsl(var(--foreground)/0.03) 0%, transparent 100%)",
                                boxShadow: "0 0 0 1px hsl(var(--border)/0.3)",
                              } : {
                                background: "linear-gradient(180deg, hsl(var(--card)/0.7) 0%, hsl(var(--card)/0.4) 100%)",
                                boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1px hsl(var(--border)/0.45), 0 2px 6px -3px hsl(0 0% 0% / 0.15)",
                              }),
                          }}
                          className={[
                            "shrink-0 w-[60px] py-3 rounded-2xl pressable flex flex-col items-center gap-1 transition-[transform,box-shadow]",
                            c.isSelected ? "text-primary-foreground"
                              : c.isToday ? "text-primary"
                                : c.isPast ? "text-secondary-fg/45"
                                  : "text-foreground/90",
                          ].join(" ")}
                        >
                          <span className={`text-[9.5px] font-bold uppercase tracking-[0.16em] ${c.isSelected ? "opacity-80" : c.isToday ? "text-primary/80" : "opacity-60"}`}>
                            {c.weekday}
                          </span>
                          <span className="font-display text-[22px] font-bold tabular-nums leading-none">
                            {c.day}
                          </span>
                          <span className={`h-[4px] w-[4px] rounded-full transition-opacity ${c.isToday && !c.isSelected ? "opacity-100 bg-primary" : "opacity-0 bg-transparent"}`} aria-hidden />
                        </motion.button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action buttons */}
        <div className="shrink-0 px-5 pt-4 pb-2 flex gap-2.5">
          <button
            type="button"
            onClick={() => { haptics.selection(); onPick(todayYmd); onOpenChange(false); }}
            disabled={isValueToday}
            className="flex-1 h-[50px] rounded-[16px] bg-primary text-primary-foreground text-[14px] font-semibold pressable shadow-[0_8px_22px_-8px_hsl(var(--primary)/0.55)] disabled:opacity-40 disabled:pointer-events-none transition-opacity"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 h-[50px] rounded-[16px] border border-border/40 bg-card/30 text-[14px] font-medium text-secondary-fg/80 hover:text-foreground pressable transition-colors"
          >
            Cancel
          </button>
        </div>

        <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
      </SheetContent>
    </Sheet>
  );
}
