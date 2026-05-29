import { useMemo, useRef, useEffect } from "react";
import { CalendarDays } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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

  // Intercept horizontal swipes so Radix Sheet doesn't dismiss on pan-x.
  useEffect(() => {
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

  const isValueToday = value === todayDateStr();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/45 bg-popover p-0 flex flex-col"
        hideClose
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>

        {/* Header */}
        <div className="px-5 pt-6 pb-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-[12px] flex items-center justify-center bg-primary/12 border border-primary/20 shrink-0">
            <CalendarDays className="h-4.5 w-4.5 text-primary" strokeWidth={2} style={{ width: 18, height: 18 }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[18px] font-semibold tracking-tight leading-tight">{title}</div>
            {subtitle && (
              <p className="text-[12px] text-secondary-fg/75 mt-0.5 leading-snug">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 w-8 rounded-full flex items-center justify-center text-secondary-fg/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors pressable shrink-0 text-[16px] font-medium"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Horizontal date scroller */}
        <div
          ref={scrollerRef}
          className="overflow-x-scroll no-scrollbar"
          style={{
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-x",
            overscrollBehaviorX: "contain",
          } as React.CSSProperties}
        >
          <div className="flex items-stretch gap-2 px-5 pb-1">
            {groups.map((g, gi) => (
              <div key={`${g.month}-${gi}`} className="flex items-stretch gap-2">
                {/* Month label separator */}
                <div className="flex flex-col items-center justify-center px-1 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-secondary-fg/50">
                    {g.month}
                  </span>
                </div>
                {g.cells.map((c) => (
                  <button
                    key={c.ymd}
                    type="button"
                    data-selected={c.isSelected}
                    onClick={() => { haptics.selection(); onPick(c.ymd); onOpenChange(false); }}
                    style={{
                      touchAction: "pan-x",
                      ...(c.isSelected ? {
                        background: "linear-gradient(180deg, hsl(var(--primary)/0.92) 0%, hsl(var(--primary)) 100%)",
                        boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.18), 0 8px 24px -8px hsl(var(--primary)/0.65), 0 0 0 1.5px hsl(var(--primary)/0.55)",
                      } : c.isToday ? {
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
                    {/* Today dot */}
                    <span className={`h-[4px] w-[4px] rounded-full transition-opacity ${c.isToday && !c.isSelected ? "opacity-100 bg-primary" : "opacity-0 bg-transparent"}`} aria-hidden />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-5 pt-4 pb-2 flex gap-2.5">
          <button
            type="button"
            onClick={() => { haptics.selection(); onPick(todayDateStr()); onOpenChange(false); }}
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
