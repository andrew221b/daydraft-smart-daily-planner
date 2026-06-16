import { useMemo, useRef, useEffect, useState } from "react";
import { CalendarDays, LayoutList, ChevronLeft, ChevronRight, Clock, ListChecks, Flag, ArrowRight, Info, ChevronDown, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { dateStr, parseDateStr, todayDateStr } from "@/lib/daydraft";
import { buildMonthGrid, firstOfMonth, WEEKDAY_NARROW_LABELS } from "@/lib/calendarGrid";
import { haptics } from "@/lib/haptics";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const AMBER = "hsl(38 92% 52%)";

// Remember whether the user prefers the full month calendar over the day
// scroller, so picking via the calendar doesn't bounce them back to the
// scroller every time they reopen the picker.
const CALENDAR_PREF_KEY = "dd_daypicker_calendar";
const readCalendarPref = (): boolean => {
  try { return localStorage.getItem(CALENDAR_PREF_KEY) === "1"; } catch { return false; }
};
const writeCalendarPref = (on: boolean) => {
  try { localStorage.setItem(CALENDAR_PREF_KEY, on ? "1" : "0"); } catch { /* ignore */ }
};

/** Per-day open-work summary.
 *  `tTasks`/`cTasks` hold up to 8 titles each (for the info expand).
 *  `prio` holds the priority-flagged subset shown in the Priority section. */
type DayMarks = {
  t: number;
  c: number;
  prio: { title: string; kind: "t" | "c" }[];
  tTasks: string[];
  cTasks: string[];
};

/** Count chip: mode-coloured icon + count. White on the selected primary pill. */
function CountChip({ kind, n, selected, size }: { kind: "t" | "c"; n: number; selected: boolean; size: number }) {
  const color = selected
    ? "hsl(0 0% 100% / 0.95)"
    : kind === "t"
      ? "hsl(var(--primary))"
      : "hsl(var(--checklist-accent))";
  const Icon = kind === "t" ? Clock : ListChecks;
  return (
    <span className="inline-flex items-center gap-[2px] font-bold tabular-nums leading-none" style={{ color }}>
      <Icon style={{ width: size, height: size }} strokeWidth={2.5} />
      {n}
    </span>
  );
}

/** Marker strip: timeline + checklist counts (flag moved inside the circle for the grid). */
function DayMarkers({
  marks,
  selected,
  size = 10,
  showFlag = false,
}: {
  marks: DayMarks;
  selected: boolean;
  size?: number;
  showFlag?: boolean;
}) {
  const hasPrio = marks.prio.length > 0;
  if (!marks.t && !marks.c && !(showFlag && hasPrio)) return null;
  return (
    <span className="flex items-center justify-center gap-[3px]" style={{ fontSize: size }}>
      {showFlag && hasPrio && (
        <Flag
          style={{ width: size, height: size, color: selected ? "hsl(0 0% 100% / 0.95)" : AMBER }}
          fill="currentColor"
          aria-hidden
        />
      )}
      {marks.t > 0 && <CountChip kind="t" n={marks.t} selected={selected} size={size} />}
      {marks.c > 0 && <CountChip kind="c" n={marks.c} selected={selected} size={size} />}
    </span>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: string;
  onPick: (next: string) => void;
  pastDays?: number;
  futureDays?: number;
  title?: string;
  subtitle?: string;
  /** When true, tapping a day opens an inline preview card instead of navigating
   *  immediately; a second tap (or the "Open this day" button) commits. */
  preview?: boolean;
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
  preview = false,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(readCalendarPref);
  const [previewYmd, setPreviewYmd] = useState<string | null>(null);
  // Which count row is currently expanded ("t" | "c" | null).
  const [expandedInfo, setExpandedInfo] = useState<"t" | "c" | null>(null);

  const todayYmd = todayDateStr();

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

  const { user } = useAuth();
  const [marks, setMarks] = useState<Map<string, DayMarks>>(new Map());
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    const minYmd = dateStr(minDate);
    const maxYmd = dateStr(maxDate);
    (async () => {
      const [planRes, clRes] = await Promise.all([
        supabase
          .from("plans")
          .select("date, blocks(title, kind, completed, resolution, is_calendar_event, priority)")
          .eq("user_id", user.id)
          .gte("date", minYmd)
          .lte("date", maxYmd),
        supabase
          .from("checklist_items")
          .select("plan_date, done, title, priority")
          .eq("user_id", user.id)
          .gte("plan_date", minYmd)
          .lte("plan_date", maxYmd),
      ]);
      if (cancelled) return;
      const next = new Map<string, DayMarks>();
      const at = (ymd: string): DayMarks => {
        let cur = next.get(ymd);
        if (!cur) { cur = { t: 0, c: 0, prio: [], tTasks: [], cTasks: [] }; next.set(ymd, cur); }
        return cur;
      };
      for (const p of (planRes.data ?? []) as Array<{ date: string; blocks: Array<{ title: string; kind: string; completed: boolean; resolution: string | null; is_calendar_event: boolean | null; priority: boolean | null }> | null }>) {
        for (const b of p.blocks ?? []) {
          if (b.kind !== "task" || b.is_calendar_event || b.completed || b.resolution) continue;
          const m = at(p.date);
          m.t += 1;
          if (m.tTasks.length < 8) m.tTasks.push(b.title);
          if (b.priority) m.prio.push({ title: b.title, kind: "t" });
        }
      }
      for (const it of (clRes.data ?? []) as Array<{ plan_date: string; done: boolean; title: string; priority: boolean | null }>) {
        if (it.done) continue;
        const m = at(it.plan_date);
        m.c += 1;
        if (m.cTasks.length < 8) m.cTasks.push(it.title);
        if (it.priority) m.prio.push({ title: it.title, kind: "c" });
      }
      setMarks(next);
    })();
    return () => { cancelled = true; };
  }, [open, user, minDate, maxDate]);

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

  const [viewMonth, setViewMonth] = useState(() => firstOfMonth(parseDateStr(value || todayYmd)));
  const monthDirRef = useRef<1 | -1>(1);

  useEffect(() => {
    if (!open) return;
    setExpanded(readCalendarPref()); // restore the user's last-used picker mode
    setPreviewYmd(null);
    setExpandedInfo(null);
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
  const selectedYmd = preview && previewYmd ? previewYmd : value;

  const commit = (ymd: string) => {
    haptics.selection();
    onPick(ymd);
    onOpenChange(false);
  };

  const pick = (ymd: string) => {
    if (!preview) {
      if (ymd === value) { onOpenChange(false); return; }
      commit(ymd);
      return;
    }
    if (ymd === previewYmd) { commit(ymd); return; }
    haptics.selection();
    setPreviewYmd(ymd);
    setExpandedInfo(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover max-h-[90vh] p-0 flex flex-col"
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

          <button
            type="button"
            onClick={() => { haptics.selection(); setExpanded((e) => { writeCalendarPref(!e); return !e; }); }}
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

        {/* Body */}
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
              {/* Month nav */}
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
                        const isSelected = ymd === selectedYmd;
                        const isDisabled = dayMs < minMs || dayMs > maxMs;
                        const mk = marks.get(ymd);
                        const hasPrio = !isDisabled && (mk?.prio.length ?? 0) > 0;

                        return (
                          <div key={i} className="relative h-[52px] flex flex-col items-center justify-start gap-[2px] pt-[2px]">
                            {/* Date circle — flag badge lives inside */}
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
                                    : hasPrio
                                      ? "text-amber-500 dark:text-amber-400 ring-1 ring-amber-400/40 hover:bg-amber-400/[0.06]"
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
                              {/* Priority flag badge — bottom-right corner of the circle */}
                              {hasPrio && (
                                <span
                                  className="absolute bottom-[1px] right-[0px] pointer-events-none"
                                  aria-hidden
                                >
                                  <Flag
                                    style={{
                                      width: 9,
                                      height: 9,
                                      color: isSelected ? "hsl(0 0% 100% / 0.82)" : AMBER,
                                      display: "block",
                                    }}
                                    fill="currentColor"
                                  />
                                </span>
                              )}
                            </motion.button>

                            {/* Marker strip — counts only (flag is in the circle) */}
                            <span className="h-[12px] flex items-center justify-center max-w-full overflow-hidden" aria-hidden>
                              {mk && (mk.t || mk.c) ? (
                                <DayMarkers marks={mk} selected={false} size={9.5} showFlag={false} />
                              ) : isToday ? (
                                <span className="h-[3px] w-[3px] rounded-full bg-primary" />
                              ) : null}
                            </span>
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
                      <div className="flex flex-col items-center justify-center px-1 shrink-0">
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-secondary-fg/50">
                          {g.month}
                        </span>
                      </div>
                      {g.cells.map((c) => {
                        const sel = c.ymd === selectedYmd;
                        const mk = marks.get(c.ymd);
                        const hasPrio = (mk?.prio.length ?? 0) > 0;
                        return (
                          <motion.button
                            key={c.ymd}
                            type="button"
                            data-selected={sel}
                            onClick={() => pick(c.ymd)}
                            whileTap={{ scale: 0.94 }}
                            transition={{ type: "spring", stiffness: 500, damping: 24 }}
                            style={{
                              touchAction: "pan-x",
                              ...(sel ? SELECTED_STYLE
                                : c.isToday ? {
                                  background: "linear-gradient(180deg, hsl(var(--primary)/0.12) 0%, hsl(var(--primary)/0.06) 100%)",
                                  boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1.5px hsl(var(--primary)/0.35)",
                                } : hasPrio ? {
                                  background: "linear-gradient(180deg, hsl(38 92% 52% / 0.13) 0%, hsl(38 92% 52% / 0.05) 100%)",
                                  boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1.5px hsl(38 92% 52% / 0.42)",
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
                              sel ? "text-primary-foreground"
                                : c.isToday ? "text-primary"
                                  : hasPrio ? "text-amber-600 dark:text-amber-300"
                                    : c.isPast ? "text-secondary-fg/45"
                                      : "text-foreground/90",
                            ].join(" ")}
                          >
                            <span className={`text-[9.5px] font-bold uppercase tracking-[0.16em] ${sel ? "opacity-80" : c.isToday ? "text-primary/80" : hasPrio ? "text-amber-600/80 dark:text-amber-300/80" : "opacity-60"}`}>
                              {c.weekday}
                            </span>
                            <span className="font-display text-[22px] font-bold tabular-nums leading-none">
                              {c.day}
                            </span>
                            {/* Scroller marker row — includes flag since there's no circle badge here */}
                            <span className="h-[13px] flex items-center justify-center max-w-full overflow-hidden" aria-hidden>
                              {mk && (mk.t || mk.c || mk.prio.length) ? (
                                <DayMarkers marks={mk} selected={sel} size={10} showFlag />
                              ) : c.isToday && !sel ? (
                                <span className="h-[4px] w-[4px] rounded-full bg-primary" />
                              ) : null}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Preview card ──────────────────────────────────────────────────────
             Stable key="preview-card" — the card mounts once when previewYmd
             becomes non-null and only unmounts when it returns to null.
             Content updates in-place; the card uses `layout` to animate its
             own height change when switching between days with different amounts
             of content. No exit/enter cycle on every date tap = no jump. */}
        <AnimatePresence initial={false}>
          {preview && previewYmd && (() => {
            const mk = marks.get(previewYmd) ?? { t: 0, c: 0, prio: [] as DayMarks["prio"], tTasks: [] as string[], cTasks: [] as string[] };
            const isEmpty = !mk.t && !mk.c;
            const d = parseDateStr(previewYmd);
            return (
              <motion.div
                key="preview-card"
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.8 }}
                className="shrink-0 px-5 pt-3"
              >
                {/* layout animates height when content changes between days */}
                <motion.div
                  layout="size"
                  transition={{ type: "spring", stiffness: 360, damping: 32, mass: 0.9 }}
                  className="rounded-[20px] border border-border/75 bg-card/50 overflow-hidden"
                >
                  <div className="p-4">
                    {/* Date header — × dismisses the preview card (clears previewYmd)
                        without navigating or closing the whole sheet. */}
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="text-[14.5px] font-semibold tracking-tight truncate">{DATE_LONG_FMT.format(d)}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {previewYmd === todayYmd && (
                          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary bg-primary/12 rounded-full px-2 py-0.5">Today</span>
                        )}
                        <button
                          type="button"
                          onClick={() => { haptics.tap(); setPreviewYmd(null); setExpandedInfo(null); }}
                          className="h-7 w-7 -mr-1.5 rounded-full flex items-center justify-center text-secondary-fg/55 hover:text-foreground hover:bg-foreground/[0.07] transition-colors pressable"
                          aria-label="Close day preview"
                        >
                          <X className="h-4 w-4" strokeWidth={2.25} />
                        </button>
                      </div>
                    </div>

                    {isEmpty ? (
                      <p className="text-[13px] text-secondary-fg/70">Nothing planned yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {/* Timeline row */}
                        {mk.t > 0 && (
                          <div>
                            <button
                              type="button"
                              onClick={() => { haptics.tap(); setExpandedInfo(expandedInfo === "t" ? null : "t"); }}
                              className="w-full flex items-center gap-1.5 text-[13px] text-foreground/85 py-1.5 pressable rounded-lg"
                            >
                              <Clock className="h-3.5 w-3.5 text-primary shrink-0" strokeWidth={2.5} />
                              <span className="flex-1 text-left font-medium">
                                {mk.t} timeline {mk.t === 1 ? "task" : "tasks"}
                              </span>
                              <span className="flex items-center gap-1 text-secondary-fg/45">
                                <Info className="h-3 w-3" />
                                <motion.span
                                  animate={{ rotate: expandedInfo === "t" ? 180 : 0 }}
                                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                  className="inline-flex"
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </motion.span>
                              </span>
                            </button>
                            <AnimatePresence initial={false}>
                              {expandedInfo === "t" && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.85 }}
                                  className="overflow-hidden"
                                >
                                  <div className="pl-[22px] pb-1 space-y-0.5">
                                    {mk.tTasks.map((t, idx) => (
                                      <div key={idx} className="flex items-center gap-1.5 py-[3px]">
                                        <span className="h-[4px] w-[4px] rounded-full bg-primary/50 shrink-0" />
                                        <span className="text-[12.5px] text-foreground/72 truncate">{t}</span>
                                      </div>
                                    ))}
                                    {mk.t > mk.tTasks.length && (
                                      <div className="text-[12px] text-secondary-fg/50 py-[3px]">+{mk.t - mk.tTasks.length} more</div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}

                        {/* Checklist row */}
                        {mk.c > 0 && (
                          <div>
                            <button
                              type="button"
                              onClick={() => { haptics.tap(); setExpandedInfo(expandedInfo === "c" ? null : "c"); }}
                              className="w-full flex items-center gap-1.5 text-[13px] text-foreground/85 py-1.5 pressable rounded-lg"
                            >
                              <ListChecks className="h-3.5 w-3.5 shrink-0" style={{ color: "hsl(var(--checklist-accent))" }} strokeWidth={2.5} />
                              <span className="flex-1 text-left font-medium">
                                {mk.c} checklist {mk.c === 1 ? "item" : "items"}
                              </span>
                              <span className="flex items-center gap-1 text-secondary-fg/45">
                                <Info className="h-3 w-3" />
                                <motion.span
                                  animate={{ rotate: expandedInfo === "c" ? 180 : 0 }}
                                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                  className="inline-flex"
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </motion.span>
                              </span>
                            </button>
                            <AnimatePresence initial={false}>
                              {expandedInfo === "c" && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.85 }}
                                  className="overflow-hidden"
                                >
                                  <div className="pl-[22px] pb-1 space-y-0.5">
                                    {mk.cTasks.map((t, idx) => (
                                      <div key={idx} className="flex items-center gap-1.5 py-[3px]">
                                        <span className="h-[4px] w-[4px] rounded-full shrink-0" style={{ background: "hsl(var(--checklist-accent) / 0.5)" }} />
                                        <span className="text-[12.5px] text-foreground/72 truncate">{t}</span>
                                      </div>
                                    ))}
                                    {mk.c > mk.cTasks.length && (
                                      <div className="text-[12px] text-secondary-fg/50 py-[3px]">+{mk.c - mk.cTasks.length} more</div>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Priority section */}
                    {mk.prio.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-border/60">
                        <p
                          className="text-[11px] font-bold uppercase tracking-[0.12em] mb-1.5 inline-flex items-center gap-1"
                          style={{ color: AMBER }}
                        >
                          <Flag className="h-3 w-3" fill="currentColor" /> Priority
                        </p>
                        <div className="space-y-1">
                          {mk.prio.slice(0, 4).map((p, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 text-[13px] text-foreground/85 min-w-0">
                              {p.kind === "t"
                                ? <Clock className="h-3 w-3 text-primary shrink-0" strokeWidth={2.5} />
                                : <ListChecks className="h-3 w-3 shrink-0" style={{ color: "hsl(var(--checklist-accent))" }} strokeWidth={2.5} />}
                              <span className="truncate">{p.title}</span>
                            </div>
                          ))}
                          {mk.prio.length > 4 && (
                            <p className="text-[12px] text-secondary-fg/60 pl-[18px]">+{mk.prio.length - 4} more</p>
                          )}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => commit(previewYmd)}
                      className="mt-3.5 w-full h-11 rounded-2xl bg-primary text-primary-foreground text-[14px] font-semibold pressable inline-flex items-center justify-center gap-1.5 shadow-[0_8px_22px_-8px_hsl(var(--primary)/0.55)]"
                    >
                      Open this day <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* Action buttons */}
        <div className="shrink-0 px-5 pt-4 pb-2 flex gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (isValueToday) return;
              haptics.selection();
              onOpenChange(false);
              setTimeout(() => { onPick(todayYmd); }, 280);
            }}
            disabled={isValueToday}
            className="flex-1 h-[50px] rounded-[16px] bg-primary text-primary-foreground text-[14px] font-semibold pressable shadow-[0_8px_22px_-8px_hsl(var(--primary)/0.55)] disabled:opacity-40 disabled:pointer-events-none transition-opacity"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 h-[50px] rounded-[16px] border border-border/70 bg-card/30 text-[14px] font-medium text-secondary-fg/80 hover:text-foreground pressable transition-colors"
          >
            Cancel
          </button>
        </div>

        <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
      </SheetContent>
    </Sheet>
  );
}
