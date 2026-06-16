import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Reports activity chart — a hand-rolled, dependency-free SVG chart with two
 * switchable views. Replaces the old single recharts area chart (~100 kB) and,
 * more importantly, stays useful on a single day of data:
 *
 *  • "Hours"  — area/line of hours tracked per day (needs ≥2 days).
 *  • "Rhythm" — bars of when you actually work, by hour of day. Reads like an
 *               activity fingerprint and is meaningful even with one day.
 *
 * Both views have real axes (Y gridlines + value labels, non-clipped X labels)
 * and a headline insight line, so it's always obvious what's being measured.
 */

type TrendPoint = { date: string; day: string; hours: number };

type View = "hours" | "rhythm";

type HoursGeo = {
  points: { x: number; y: number; pt: TrendPoint }[];
  path: string;
  fill: string;
  grid: { v: number; y: number }[];
  top: number;
  avg: number;
  bestIdx: number;
  labelStride: number;
};

type RhythmGeo = {
  bars: { h: number; sec: number; cx: number; bh: number; x: number }[];
  barW: number;
  maxSec: number;
  peakHour: number;
};

// ── Layout constants (shared by both views) ─────────────────────────────────
const H = 150;          // svg height
const PAD_L = 30;       // left gutter for Y labels
const PAD_R = 12;
const PAD_T = 14;
const AXIS_H = 22;      // bottom band reserved for X labels (no clipping)
const PLOT_BOTTOM = H - AXIS_H;
const PLOT_H = PLOT_BOTTOM - PAD_T;

const fmtH = (h: number): string => {
  if (h <= 0) return "0";
  if (h >= 10) return `${Math.round(h)}h`;
  return `${Math.round(h * 10) / 10}h`;
};

const fmtMin = (sec: number): string => {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
};

const fmtHour12 = (h: number): string => {
  const period = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${period}`;
};

/** "6 AM" / "Noon" / "6 PM" style — clear on first read. */
const fmtHourAxis = (h: number): string => {
  if (h === 0) return "12 AM";
  if (h === 6) return "6 AM";
  if (h === 12) return "Noon";
  if (h === 18) return "6 PM";
  const period = h < 12 ? " AM" : " PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${period}`;
};

/** Round a max value up to a clean gridline ceiling (1,2,3,4,5,6,8,10,12,…). */
const niceCeil = (v: number): number => {
  if (v <= 1) return 1;
  if (v <= 6) return Math.ceil(v);
  return Math.ceil(v / 2) * 2;
};

/** Short weekday / date label from a 'YYYY-MM-DD' key.
 *  ≤4 days  → "Jun 13"  (unambiguous when dates are close together)
 *  ≤9 days  → "Mon"     (3-letter weekday — no duplicate letters)
 *  longer   → "13"      (day number only for dense ranges)
 */
const labelForDate = (date: string, count: number): string => {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return date.slice(5);
  const dt = new Date(y, m - 1, d);
  if (count <= 4) {
    const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
    return `${mon} ${d}`;
  }
  if (count <= 9) return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dt.getDay()];
  return String(d);
};

/** "Tue" style weekday for the headline best-day callout. */
const weekdayShort = (date: string): string => {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return date.slice(5);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(y, m - 1, d).getDay()];
};

export default function ReportsTrendChart({
  perDay,
  perHour,
  totalSec,
}: {
  perDay: TrendPoint[];
  perHour: number[];
  totalSec: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const canHours = perDay.length >= 2;
  const [view, setView] = useState<View>(canHours ? "hours" : "rhythm");

  // If the data shape changes (period switch) and Hours is no longer available,
  // fall back to Rhythm so we never render an empty Hours view.
  useEffect(() => {
    if (!canHours && view === "hours") setView("rhythm");
  }, [canHours, view]);

  // Clear any tooltip when switching views.
  useEffect(() => { setActive(null); }, [view]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (active === null) return;
    const onTouchEnd = () => setActive(null);
    window.addEventListener("touchend", onTouchEnd);
    return () => window.removeEventListener("touchend", onTouchEnd);
  }, [active]);

  const innerW = Math.max(1, width - PAD_L - PAD_R);

  // ── Hours geometry ────────────────────────────────────────────────────────
  const hours = useMemo(() => {
    if (view !== "hours" || !perDay.length || width <= 0) return null;
    const maxH = Math.max(...perDay.map((p) => p.hours), 0);
    const top = niceCeil(maxH);
    const step = perDay.length > 1 ? innerW / (perDay.length - 1) : 0;
    const points = perDay.map((pt, i) => {
      const x = PAD_L + (perDay.length === 1 ? innerW / 2 : i * step);
      const y = PLOT_BOTTOM - (pt.hours / top) * PLOT_H;
      return { x, y, pt };
    });
    // Catmull-Rom → bezier for a smooth line.
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    const fill = `${path} L ${points[points.length - 1].x} ${PLOT_BOTTOM} L ${points[0].x} ${PLOT_BOTTOM} Z`;
    // Gridlines at 0, mid, top.
    const grid = [0, top / 2, top].map((v) => ({
      v,
      y: PLOT_BOTTOM - (v / top) * PLOT_H,
    }));
    const totalH = perDay.reduce((s, p) => s + p.hours, 0);
    const avg = totalH / perDay.length;
    const bestIdx = perDay.reduce((bi, p, i, arr) => (p.hours > arr[bi].hours ? i : bi), 0);
    const labelStride = perDay.length > 10 ? Math.ceil(perDay.length / 7) : 1;
    return { points, path, fill, grid, top, avg, bestIdx, labelStride };
  }, [view, perDay, width, innerW]);

  // ── Rhythm geometry ───────────────────────────────────────────────────────
  const rhythm = useMemo(() => {
    if (view !== "rhythm" || width <= 0) return null;
    const maxSec = Math.max(...perHour, 1);
    const slot = innerW / 24;
    const barW = Math.max(3, slot * 0.62);
    const bars = perHour.map((sec, h) => {
      const cx = PAD_L + h * slot + slot / 2;
      const bh = sec > 0 ? Math.max(2, (sec / maxSec) * PLOT_H) : 0;
      return { h, sec, cx, bh, x: cx - barW / 2 };
    });
    const peakHour = perHour.reduce((bi, s, i, arr) => (s > arr[bi] ? i : bi), 0);
    return { bars, barW, maxSec, peakHour };
  }, [view, perHour, width, innerW]);

  // ── Headline ──────────────────────────────────────────────────────────────
  const headline =
    view === "hours" && hours
      ? `Avg ${fmtH(hours.avg)}/day · Busiest ${weekdayShort(perDay[hours.bestIdx].date)} ${fmtH(perDay[hours.bestIdx].hours)}`
      : view === "rhythm" && rhythm
        ? rhythm.maxSec > 60
          ? `Most active around ${fmtHour12(rhythm.peakHour)} · ${fmtMin(totalSec)} total`
          : `${fmtMin(totalSec)} tracked`
        : "";

  return (
    <div ref={wrapRef} className="w-full select-none">
      {/* Header: title + segmented switcher */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">
          {view === "hours" ? "Daily hours" : "When you focus"}
        </p>
        {canHours && (
          <div className="inline-flex items-center rounded-full bg-foreground/[0.06] p-0.5">
            <SegBtn label="Hours" active={view === "hours"} onClick={() => setView("hours")} />
            <SegBtn label="Rhythm" active={view === "rhythm"} onClick={() => setView("rhythm")} />
          </div>
        )}
      </div>

      {/* Headline insight */}
      <p className="text-[12px] text-secondary-fg/80 mb-1.5 leading-snug tabular-nums truncate">
        {headline}
      </p>

      <div className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={H}
            className="block overflow-visible"
            role="img"
            aria-label={view === "hours" ? "Hours tracked per day" : "Activity by hour of day"}
            onPointerMove={(e) => handlePointer(e.clientX)}
            onPointerDown={(e) => handlePointer(e.clientX)}
            onPointerLeave={() => setActive(null)}
          >
            <defs>
              <linearGradient id="ddTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* ── Hours view ── */}
            {view === "hours" && hours && (
              <>
                {/* Y gridlines + labels — baseline has no label (line speaks for itself) */}
                {hours.grid.map((g, i) => (
                  <g key={i}>
                    <line
                      x1={PAD_L}
                      x2={width - PAD_R}
                      y1={g.y}
                      y2={g.y}
                      stroke="hsl(var(--border))"
                      strokeWidth={1}
                      strokeOpacity={i === 0 ? 0.45 : 0.25}
                      strokeDasharray={i === 0 ? undefined : "3 4"}
                    />
                    {g.v > 0 && (
                      <text
                        x={PAD_L - 6}
                        y={g.y + 3}
                        textAnchor="end"
                        fontSize={9.5}
                        fill="hsl(var(--muted-foreground))"
                        fillOpacity={0.75}
                        className="tabular-nums"
                      >
                        {fmtH(g.v)}
                      </text>
                    )}
                  </g>
                ))}

                {hours.points.length > 1 && <path d={hours.fill} fill="url(#ddTrendFill)" />}
                <path
                  d={hours.path}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Dots */}
                {hours.points.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={active === i ? 4 : 2.4}
                    fill={active === i ? "hsl(var(--primary))" : "hsl(var(--background))"}
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                  />
                ))}

                {/* X labels — first/last pinned flush to the plot edges. */}
                {hours.points.map((p, i) => {
                  const last = hours.points.length - 1;
                  if (!(i % hours.labelStride === 0 || i === last)) return null;
                  const anchor = i === 0 ? "start" : i === last ? "end" : "middle";
                  const x = i === 0 ? PAD_L : i === last ? width - PAD_R : p.x;
                  return (
                    <text
                      key={i}
                      x={x}
                      y={H - 6}
                      textAnchor={anchor}
                      fontSize={10}
                      fill="hsl(var(--muted-foreground))"
                    >
                      {labelForDate(p.pt.date, perDay.length)}
                    </text>
                  );
                })}

                {/* Hover guide */}
                {active !== null && hours.points[active] && (
                  <line
                    x1={hours.points[active].x}
                    x2={hours.points[active].x}
                    y1={PAD_T}
                    y2={PLOT_BOTTOM}
                    stroke="hsl(var(--primary))"
                    strokeWidth={1}
                    strokeOpacity={0.35}
                  />
                )}
              </>
            )}

            {/* ── Rhythm view ── */}
            {view === "rhythm" && rhythm && (
              <>
                {/* baseline */}
                <line
                  x1={PAD_L}
                  x2={width - PAD_R}
                  y1={PLOT_BOTTOM}
                  y2={PLOT_BOTTOM}
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                  strokeOpacity={0.5}
                />
                {/* peak gridline — no Y label (value shown in tooltip on tap) */}
                {rhythm.maxSec > 60 && (
                  <line
                    x1={PAD_L}
                    x2={width - PAD_R}
                    y1={PAD_T}
                    y2={PAD_T}
                    stroke="hsl(var(--border))"
                    strokeWidth={1}
                    strokeOpacity={0.25}
                    strokeDasharray="3 4"
                  />
                )}

                {rhythm.bars.map((b) =>
                  b.bh > 0 ? (
                    <rect
                      key={b.h}
                      x={b.x}
                      y={PLOT_BOTTOM - b.bh}
                      width={rhythm.barW}
                      height={b.bh}
                      rx={Math.min(2.5, rhythm.barW / 2)}
                      fill="hsl(var(--primary))"
                      fillOpacity={
                        active === b.h ? 1 : b.h === rhythm.peakHour ? 0.95 : 0.42
                      }
                    />
                  ) : null,
                )}

                {/* X ticks: 12 AM · 6 AM · Noon · 6 PM
                    First pinned to left edge, last to right edge. */}
                {[0, 6, 12, 18].map((h, ti) => {
                  const slot = innerW / 24;
                  const anchor = ti === 0 ? "start" : ti === 3 ? "end" : "middle";
                  const x = ti === 0 ? PAD_L : ti === 3 ? width - PAD_R : PAD_L + h * slot + slot / 2;
                  return (
                    <text
                      key={h}
                      x={x}
                      y={H - 6}
                      textAnchor={anchor}
                      fontSize={9.5}
                      fill="hsl(var(--muted-foreground))"
                      fillOpacity={0.75}
                    >
                      {fmtHourAxis(h)}
                    </text>
                  );
                })}
              </>
            )}
          </svg>
        )}

        {/* Tooltip */}
        {active !== null && (
          <Tooltip view={view} hours={hours} rhythm={rhythm} active={active} />
        )}
      </div>
    </div>
  );

  function handlePointer(clientX: number) {
    const el = wrapRef.current?.querySelector("svg");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    if (view === "hours" && hours) {
      let nearest = 0;
      let best = Infinity;
      hours.points.forEach((p, i) => {
        const dx = Math.abs(p.x - x);
        if (dx < best) { best = dx; nearest = i; }
      });
      setActive(nearest);
    } else if (view === "rhythm" && rhythm) {
      const slot = innerW / 24;
      const h = Math.max(0, Math.min(23, Math.floor((x - PAD_L) / slot)));
      setActive(rhythm.bars[h]?.sec > 0 ? h : null);
    }
  }
}

function SegBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 h-[24px] rounded-full text-[11px] font-semibold transition-colors pressable ${
        active
          ? "bg-primary text-primary-foreground shadow-[0_1px_4px_-1px_hsl(var(--primary)/0.6)]"
          : "text-secondary-fg/70 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function Tooltip({
  view,
  hours,
  rhythm,
  active,
}: {
  view: View;
  hours: HoursGeo | null;
  rhythm: RhythmGeo | null;
  active: number;
}) {
  if (view === "hours" && hours && hours.points[active]) {
    const p = hours.points[active];
    return (
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md whitespace-nowrap"
        style={{ left: p.x, top: p.y - 8 }}
      >
        <span className="font-semibold tabular-nums">{fmtH(p.pt.hours)}</span>
        <span className="text-secondary-fg ml-1">{p.pt.day}</span>
      </div>
    );
  }
  if (view === "rhythm" && rhythm && rhythm.bars[active]) {
    const b = rhythm.bars[active];
    return (
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md whitespace-nowrap"
        style={{ left: b.cx, top: PLOT_BOTTOM - b.bh - 8 }}
      >
        <span className="font-semibold tabular-nums">{fmtMin(b.sec)}</span>
        <span className="text-secondary-fg ml-1 tabular-nums">{fmtHour12(b.h)}</span>
      </div>
    );
  }
  return null;
}
