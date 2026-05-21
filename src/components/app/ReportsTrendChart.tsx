import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

/**
 * Recharts is ~100kB gzipped — too heavy to ship with the first paint of
 * Reports. This component lives in its own chunk so `React.lazy` lets the
 * page render text + numbers immediately while the chart streams in
 * underneath. Imported as the default export so `lazy()` consumes it
 * directly.
 */
export default function ReportsTrendChart({
  perDay,
}: {
  perDay: { day: string; hours: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={perDay} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(v: any) => [`${v}h`, "Tracked"]}
        />
        <Area
          type="monotone"
          dataKey="hours"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#trendFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
