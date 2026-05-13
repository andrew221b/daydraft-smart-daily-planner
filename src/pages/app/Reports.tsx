import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BarChart3, Download, FileText } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { downloadReportCsv, downloadReportPdf, type ReportPayload } from "@/lib/reportExport";
import { toast } from "sonner";

type Period = "day" | "week" | "month";

function periodRange(period: Period): { from: Date; to: Date; label: string; periodLabel: string } {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  if (period === "day") {
    from.setHours(0, 0, 0, 0);
  } else if (period === "week") {
    const dow = (from.getDay() + 6) % 7; // Mon = 0
    from.setDate(from.getDate() - dow);
    from.setHours(0, 0, 0, 0);
  } else {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  }
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const label = period === "day" ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
  const periodLabel = period === "day" ? "Day" : period === "week" ? "Week" : "Month";
  return { from, to, label, periodLabel };
}

const fmtHM = (sec: number) => {
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (!h) return `${mm}m`;
  return mm ? `${h}h ${mm}m` : `${h}h`;
};

export default function Reports() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("week");
  const range = useMemo(() => periodRange(period), [period]);

  const { data: cats = [] } = useQuery({
    queryKey: ["report-categories", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("time_categories")
        .select("id,name,color")
        .eq("user_id", user!.id);
      return data ?? [];
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["report-entries", user?.id, period, range.from.toISOString()],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("time_entries")
        .select("id,started_at,ended_at,category_id,note")
        .eq("user_id", user!.id)
        .gte("started_at", range.from.toISOString())
        .lte("started_at", range.to.toISOString())
        .order("started_at", { ascending: false });
      return data ?? [];
    },
  });

  const catMap = useMemo(() => new Map(cats.map((c: any) => [c.id, c])), [cats]);

  const { totalSec, byCategory, perDay } = useMemo(() => {
    const now = Date.now();
    let total = 0;
    const cMap = new Map<string, number>();
    const dMap = new Map<string, number>();
    for (const e of entries as any[]) {
      const s = new Date(e.started_at).getTime();
      const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
      const sec = Math.max(0, (en - s) / 1000);
      if (sec <= 0) continue;
      total += sec;
      const cid = e.category_id || "uncategorized";
      cMap.set(cid, (cMap.get(cid) || 0) + sec);
      const d = new Date(s);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dMap.set(key, (dMap.get(key) || 0) + sec);
    }
    const byCategory = Array.from(cMap.entries())
      .map(([id, sec]) => {
        const c: any = catMap.get(id);
        return {
          id,
          name: c?.name || "Uncategorized",
          color: c?.color || "hsl(var(--muted-foreground))",
          sec,
          pct: total > 0 ? sec / total : 0,
        };
      })
      .sort((a, b) => b.sec - a.sec);
    const perDay = Array.from(dMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, sec]) => ({
        day: k.slice(5),
        hours: Number((sec / 3600).toFixed(2)),
      }));
    return { totalSec: total, byCategory, perDay };
  }, [entries, catMap]);

  const buildPayload = (): ReportPayload => ({
    periodLabel: range.periodLabel,
    rangeLabel: range.label,
    totalSeconds: totalSec,
    categories: byCategory.map((c) => ({
      name: c.name,
      color: c.color,
      seconds: c.sec,
      pct: c.pct,
    })),
    entries: (entries as any[]).map((e) => {
      const s = new Date(e.started_at);
      const en = e.ended_at ? new Date(e.ended_at) : new Date();
      const cat: any = catMap.get(e.category_id);
      return {
        date: s.toLocaleDateString(),
        startedAt: s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        endedAt: en.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        category: cat?.name || "Uncategorized",
        durationMin: Math.max(0, Math.round((en.getTime() - s.getTime()) / 60000)),
        note: e.note ?? null,
      };
    }),
  });

  const onExport = (kind: "pdf" | "csv") => {
    if (!entries.length) {
      toast("Nothing to export for this period");
      return;
    }
    try {
      const payload = buildPayload();
      if (kind === "pdf") downloadReportPdf(payload);
      else downloadReportCsv(payload);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  };

  return (
    <Shell>
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-7 pb-6">
        <header className="mb-5 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-fg/65">
            Reports
          </p>
          <h1 className="mt-1 font-display text-[26px] font-semibold tracking-[-0.02em]">
            Time insights
          </h1>
        </header>

        {/* Period switcher */}
        <div className="shrink-0 mb-5 inline-flex p-1 rounded-2xl bg-muted/40 border border-border/30 self-start">
          {(["day", "week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-4 h-8 rounded-xl text-[12px] font-medium capitalize transition-colors pressable ${
                period === p
                  ? "bg-background shadow-sm text-foreground"
                  : "text-secondary-fg/85 hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto space-y-5 pb-4 -mx-5 px-5">
          {/* Total */}
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">
              Total tracked
            </p>
            <p className="mt-1.5 font-display text-[40px] font-semibold tabular-nums leading-none">
              {fmtHM(totalSec)}
            </p>
            <p className="mt-2 text-[12px] text-secondary-fg/80">{range.label}</p>
          </section>

          {/* Category breakdown */}
          {byCategory.length > 0 ? (
            <section className="rounded-2xl border border-border/40 bg-card/30 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70 mb-3">
                By category
              </p>
              {/* Stacked bar */}
              <div className="h-2 w-full rounded-full overflow-hidden flex bg-muted/40 mb-3">
                {byCategory.map((c) => (
                  <div
                    key={c.id}
                    style={{ width: `${c.pct * 100}%`, background: c.color }}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                  />
                ))}
              </div>
              <ul className="space-y-2">
                {byCategory.map((c) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: c.color }}
                    />
                    <span className="text-[13px] font-medium text-foreground/90 flex-1 truncate">
                      {c.name}
                    </span>
                    <span className="text-[12px] tabular-nums text-secondary-fg/85">
                      {fmtHM(c.sec)}
                    </span>
                    <span className="text-[11px] tabular-nums text-secondary-fg/65 w-10 text-right">
                      {(c.pct * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="rounded-2xl border border-dashed border-border/40 px-4 py-8 text-center">
              <BarChart3 className="h-6 w-6 mx-auto text-secondary-fg/60 mb-2" />
              <p className="text-[13px] text-secondary-fg/85">No tracked time in this period</p>
              <p className="text-[11px] text-secondary-fg/60 mt-1">
                Start a timer on the Track tab to fill this in.
              </p>
            </section>
          )}

          {/* Trend (week/month) */}
          {period !== "day" && perDay.length > 1 && (
            <section className="rounded-2xl border border-border/40 bg-card/30 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70 mb-2">
                Daily trend
              </p>
              <div className="h-32 -mx-2">
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
              </div>
            </section>
          )}

          {/* Recent entries */}
          {entries.length > 0 && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70 mb-2">
                Recent sessions
              </p>
              <ul className="rounded-2xl border border-border/40 bg-card/20 divide-y divide-border/30 overflow-hidden">
                {(entries as any[]).slice(0, 20).map((e) => {
                  const s = new Date(e.started_at);
                  const en = e.ended_at ? new Date(e.ended_at) : new Date();
                  const sec = Math.max(0, (en.getTime() - s.getTime()) / 1000);
                  const c: any = catMap.get(e.category_id);
                  return (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: c?.color || "hsl(var(--muted-foreground))" }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-foreground/90 truncate">
                          {c?.name || "Uncategorized"}
                        </p>
                        <p className="text-[11px] text-secondary-fg/70 tabular-nums">
                          {s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                          {s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <span className="text-[12px] tabular-nums text-secondary-fg/85">
                        {fmtHM(sec)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Export */}
          <section className="grid grid-cols-2 gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onExport("pdf")}
              className="h-11 rounded-2xl border-border/50 text-[13px] font-medium"
            >
              <FileText className="h-4 w-4 mr-1.5" /> PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => onExport("csv")}
              className="h-11 rounded-2xl border-border/50 text-[13px] font-medium"
            >
              <Download className="h-4 w-4 mr-1.5" /> CSV
            </Button>
          </section>
        </div>
      </div>
    </Shell>
  );
}