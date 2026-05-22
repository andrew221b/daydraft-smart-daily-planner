import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Hand-rolled SVG area sparkline.
 *
 * Replaces the recharts dependency (~100 kB gzipped) for the one chart in
 * Reports. The previous component used `AreaChart` + `Area` + `XAxis` +
 * `Tooltip` + `ResponsiveContainer`; nothing else in the app pulled
 * recharts, so dropping it saves the entire charts vendor chunk.
 *
 * Features kept:
 *  - smooth (catmull-rom-style) curve through the data points
 *  - gradient fill below the curve, primary stroke on top
 *  - per-day labels on the x-axis
 *  - tap/hover tooltip showing "{N}h Tracked" on the nearest point
 *
 * Renders at the container's actual width via ResizeObserver, matching
 * recharts' `<ResponsiveContainer>` behaviour.
 */

type Point = { day: string; hours: number };

export default function ReportsTrendChart({ perDay }: { perDay: Point[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

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

  // Mouse leave clears tooltip; pointer outside the SVG handles it via the
  // svg-level onPointerLeave below.
  useEffect(() => {
    if (hoverIndex === null) return;
    const onTouchEnd = () => setHoverIndex(null);
    window.addEventListener("touchend", onTouchEnd);
    return () => window.removeEventListener("touchend", onTouchEnd);
  }, [hoverIndex]);

  const geometry = useMemo(() => {
    if (!perDay.length || width <= 0) {
      return { points: [] as { x: number; y: number; pt: Point }[], path: "", fill: "", height: 0, padX: 0, padTop: 0, axisY: 0 };
    }
    // Visual constants (kept inline — used only here).
    const height = 128; // matches the surrounding h-32 wrapper
    const padX = 12;
    const padTop = 10;
    const axisH = 16; // space reserved for the day labels under the curve
    const plotH = height - padTop - axisH;
    const max = Math.max(1, ...perDay.map((p) => p.hours));
    const innerW = Math.max(1, width - padX * 2);
    const step = perDay.length > 1 ? innerW / (perDay.length - 1) : 0;
    const axisY = padTop + plotH;

    const points = perDay.map((pt, i) => {
      const x = padX + (perDay.length === 1 ? innerW / 2 : i * step);
      const y = axisY - (pt.hours / max) * plotH;
      return { x, y, pt };
    });

    // Smooth curve via Catmull-Rom → Bezier conversion. Reads nicer than a
    // hard polyline and avoids the visual jaggedness on flat days.
    let path = "";
    if (points.length === 1) {
      path = `M ${points[0].x} ${points[0].y}`;
    } else {
      path = `M ${points[0].x} ${points[0].y}`;
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
    }
    const fill = `${path} L ${points[points.length - 1].x} ${axisY} L ${points[0].x} ${axisY} Z`;
    return { points, path, fill, height, padX, padTop, axisY };
  }, [perDay, width]);

  const handlePointer = (clientX: number, rect: DOMRect) => {
    if (!geometry.points.length) return;
    const x = clientX - rect.left;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < geometry.points.length; i++) {
      const dx = Math.abs(geometry.points[i].x - x);
      if (dx < best) {
        best = dx;
        nearest = i;
      }
    }
    setHoverIndex(nearest);
  };

  // Sparse axis labels — show every Nth label so a 30-day month doesn't
  // crowd into illegible text.
  const labelStride = perDay.length > 10 ? Math.ceil(perDay.length / 7) : 1;

  return (
    <div ref={wrapRef} className="relative h-full w-full select-none">
      {width > 0 && (
        <svg
          width={width}
          height={geometry.height}
          className="block"
          role="img"
          aria-label="Daily hours tracked"
          onPointerMove={(e) => handlePointer(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => handlePointer(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="ddTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.32} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          {geometry.points.length > 1 && (
            <path d={geometry.fill} fill="url(#ddTrendFill)" />
          )}
          {geometry.points.length > 0 && (
            <path
              d={geometry.path}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {hoverIndex !== null && geometry.points[hoverIndex] && (
            <g>
              <line
                x1={geometry.points[hoverIndex].x}
                x2={geometry.points[hoverIndex].x}
                y1={geometry.padTop}
                y2={geometry.axisY}
                stroke="hsl(var(--border))"
                strokeWidth={1}
              />
              <circle
                cx={geometry.points[hoverIndex].x}
                cy={geometry.points[hoverIndex].y}
                r={3.5}
                fill="hsl(var(--primary))"
                stroke="hsl(var(--background))"
                strokeWidth={2}
              />
            </g>
          )}
          {geometry.points.map((p, i) =>
            i % labelStride === 0 || i === geometry.points.length - 1 ? (
              <text
                key={i}
                x={p.x}
                y={geometry.height - 2}
                textAnchor="middle"
                fontSize={10}
                fill="hsl(var(--muted-foreground))"
              >
                {p.pt.day}
              </text>
            ) : null,
          )}
        </svg>
      )}
      {hoverIndex !== null && geometry.points[hoverIndex] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
          style={{
            left: geometry.points[hoverIndex].x,
            top: geometry.points[hoverIndex].y - 6,
          }}
        >
          <span className="font-medium">{geometry.points[hoverIndex].pt.hours}h</span>
          <span className="text-secondary-fg ml-1">Tracked</span>
        </div>
      )}
    </div>
  );
}
