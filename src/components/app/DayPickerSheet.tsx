import { useMemo, useRef, useEffect } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { dateStr, parseDateStr, todayDateStr } from "@/lib/daydraft";
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

  const cells = useMemo<DayCell[]>(() => {
    const today = parseDateStr(todayDateStr());
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
  }, [pastDays, futureDays, value]);

  // Centre selected pill on open.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const el = scrollerRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
      if (!el || !scrollerRef.current) return;
      const scroller = scrollerRef.current;
      const target = el.offsetLeft - scroller.clientWidth / 2 + el.clientWidth / 2;
      scroller.scrollTo({ left: Math.max(0, target), behavior: "instant" as ScrollBehavior });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Native touch handlers: intercept horizontal swipes before the Radix Sheet
  // overlay or any parent can absorb them. stopPropagation on touchmove when
  // the gesture is clearly horizontal so the underlying scroll container gets
  // the event and the Sheet doesn't try to dismiss.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let startX = 0, startY = 0, decided = false, isHoriz = false;

    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
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
  }, [open]);

  const groups = useMemo(() => {
    const out: { month: string; cells: DayCell[] }[] = [];
    cells.forEach((c) => {
      const last = out[out.length - 1];
      if (last && last.month === c.month) last.cells.push(c);
      else out.push({ month: c.month, cells: [c] });
    });
    return out;
  }, [cells]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/45 bg-popover px-0 pt-5 pb-6"
      >
        <div className="px-6">
          <h3 className="font-display text-[17px] font-semibold tracking-tight">{title}</h3>
          {subtitle && (
            <p className="text-[12.5px] text-secondary-fg/85 mt-1 leading-relaxed">{subtitle}</p>
          )}
        </div>

        <div
          ref={scrollerRef}
          className="mt-4 overflow-x-scroll no-scrollbar"
          style={{
            WebkitOverflowScrolling: "touch",
            // touch-action: pan-x is resolved at the browser gesture level,
            // before any JS event dispatch, so Radix capture-phase listeners
            // cannot intercept horizontal swipes on this element.
            touchAction: "pan-x",
            overscrollBehaviorX: "contain",
          } as React.CSSProperties}
        >
          <div className="flex items-stretch gap-3 px-6 pb-1">
            {groups.map((g, gi) => (
              <div key={`${g.month}-${gi}`} className="flex items-stretch gap-2">
                {gi > 0 && (
                  <div className="flex items-center pr-1">
                    <span className="eyebrow text-secondary-fg/60">{g.month}</span>
                  </div>
                )}
                {g.cells.map((c) => (
                  <button
                    key={c.ymd}
                    type="button"
                    data-selected={c.isSelected}
                    onClick={() => { haptics.selection(); onPick(c.ymd); onOpenChange(false); }}
                    style={{ touchAction: "pan-x" }}
                    className={[
                      "shrink-0 w-[58px] py-2.5 rounded-2xl border pressable flex flex-col items-center gap-0.5 transition-colors",
                      c.isSelected
                        ? "border-primary/60 bg-primary text-primary-foreground shadow-[0_8px_22px_-12px_hsl(var(--primary)/0.6)]"
                        : c.isToday
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : c.isPast
                            ? "border-border/35 bg-transparent text-secondary-fg/65"
                            : "border-border/40 bg-card/60 text-foreground/90",
                    ].join(" ")}
                  >
                    <span className={`text-[9.5px] font-semibold uppercase tracking-[0.14em] ${c.isSelected ? "text-primary-foreground/85" : "text-secondary-fg/75"}`}>
                      {c.weekday}
                    </span>
                    <span className="font-display text-[18px] font-semibold tabular-nums leading-none">
                      {c.day}
                    </span>
                    {c.isToday && !c.isSelected && (
                      <span className="mt-0.5 h-[3px] w-[3px] rounded-full bg-primary" aria-hidden />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => { haptics.selection(); onPick(todayDateStr()); onOpenChange(false); }}
            className="flex-1 h-11 rounded-2xl border border-border/40 bg-card/60 text-[13px] font-medium text-foreground/90 pressable"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 h-11 rounded-2xl text-[13px] font-medium text-secondary-fg/85 pressable"
          >
            Cancel
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
