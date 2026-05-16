import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BarChart3, ChevronDown, Download, FileText } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { downloadReportCsv, downloadReportPdf, type ReportPaymentDetails, type ReportPayload, type ReportPaymentSection } from "@/lib/reportExport";
import { mergeCategoryPayment, paymentDetailsHasContent, type CategoryBillingRow } from "@/lib/categoryBilling";
import { toast } from "sonner";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";

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
const REPORT_CATEGORY_SELECT =
  "id,name,color,hourly_rate,currency,payment_method,billing_display_name,billing_bank_name,billing_iban,billing_crypto_network,billing_crypto_wallet,billing_payment_link,billing_notes";

function paymentFingerprint(d: ReportPaymentDetails): string {
  return [
    d.currency ?? "",
    d.paymentMethod ?? "",
    d.displayName ?? "",
    d.bankName ?? "",
    d.iban ?? "",
    d.cryptoNetwork ?? "",
    d.cryptoWallet ?? "",
    d.paymentLink ?? "",
    d.notes ?? "",
  ].join("\u0001");
}

const fmtMoney = (amount: number, currency = "USD") => {
  const code = String(currency || "USD").trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: Math.abs(amount) >= 100 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${Math.abs(amount) >= 100 ? amount.toFixed(0) : amount.toFixed(2)} ${code}`;
  }
};

export default function Reports() {
  const { user } = useAuth();
  const { isPro } = useEntitlement();
  const [period, setPeriod] = useState<Period>("week");
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set());
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const range = useMemo(() => periodRange(period), [period]);

  const { data: cats = [] } = useQuery({
    queryKey: ["report-categories", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_categories")
        .select(REPORT_CATEGORY_SELECT)
        .eq("user_id", user!.id);
      if (!error) return data ?? [];

      // Some deployments may not have the billing migration applied yet.
      // Falling back keeps history/category names readable instead of showing
      // every session as Uncategorized.
      const { data: fallback, error: fallbackError } = await supabase
        .from("time_categories")
        .select("id,name,color")
        .eq("user_id", user!.id);
      if (fallbackError) throw fallbackError;
      return (fallback ?? []).map((c: any) => ({ ...c, hourly_rate: null }));
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

  const { data: paymentDetails = null } = useQuery({
    queryKey: ["billing-payment-details", user?.id],
    enabled: !!user?.id && isPro,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("billing_payment_details")
        .select("display_name,bank_name,iban,crypto_network,crypto_wallet,payment_link,notes")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) return null;
      if (!data) return null;
      return {
        displayName: data.display_name,
        bankName: data.bank_name,
        iban: data.iban,
        cryptoNetwork: data.crypto_network,
        cryptoWallet: data.crypto_wallet,
        paymentLink: data.payment_link,
        notes: data.notes,
      } satisfies ReportPaymentDetails;
    },
  });

  const catMap = useMemo(() => new Map(cats.map((c: any) => [c.id, c])), [cats]);

  const { totalSec, totalEarnings, byCategory, perDay } = useMemo(() => {
    const now = Date.now();
    let total = 0;
    let earnedTotal = 0;
    const cMap = new Map<string, number>();
    const eMap = new Map<string, number>();
    const dMap = new Map<string, number>();
    for (const e of entries as any[]) {
      const s = new Date(e.started_at).getTime();
      const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
      const sec = Math.max(0, (en - s) / 1000);
      if (sec <= 0) continue;
      total += sec;
      const cid = e.category_id || "uncategorized";
      const cat: any = catMap.get(e.category_id);
      const earned = ((cat?.hourly_rate || 0) * sec) / 3600;
      earnedTotal += earned;
      cMap.set(cid, (cMap.get(cid) || 0) + sec);
      eMap.set(cid, (eMap.get(cid) || 0) + earned);
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
          currency: c?.currency || "USD",
          hourlyRate: c?.hourly_rate ?? null,
          sec,
          earnings: eMap.get(id) || 0,
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
    return { totalSec: total, totalEarnings: earnedTotal, byCategory, perDay };
  }, [entries, catMap]);

  const categoryGroups = useMemo(() => {
    const now = Date.now();
    const groups = new Map<string, {
      id: string;
      name: string;
      color: string;
      currency: string;
      hourlyRate: number | null;
      sec: number;
      earnings: number;
      entries: any[];
    }>();

    for (const e of entries as any[]) {
      const s = new Date(e.started_at);
      const en = e.ended_at ? new Date(e.ended_at) : new Date();
      const sec = Math.max(0, ((e.ended_at ? en.getTime() : now) - s.getTime()) / 1000);
      if (sec <= 0) continue;
      const id = e.category_id || "uncategorized";
      const cat: any = catMap.get(e.category_id);
      const rate = cat?.hourly_rate ?? null;
      const earned = ((rate || 0) * sec) / 3600;
      const group = groups.get(id) || {
        id,
        name: cat?.name || "Uncategorized",
        color: cat?.color || "hsl(var(--muted-foreground))",
        currency: cat?.currency || "USD",
        hourlyRate: rate,
        sec: 0,
        earnings: 0,
        entries: [],
      };
      group.sec += sec;
      group.earnings += earned;
      group.entries.push(e);
      groups.set(id, group);
    }

    return Array.from(groups.values()).sort((a, b) => b.sec - a.sec);
  }, [entries, catMap]);

  const toggleCategoryExpanded = (id: string) => {
    setExpandedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildPayload = (categoryIds?: string[], scopeLabel = "All categories"): ReportPayload => {
    const idSet = categoryIds?.length ? new Set(categoryIds) : null;
    const filteredEntries = (entries as any[]).filter((e) => {
      if (!idSet) return true;
      return idSet.has(e.category_id || "uncategorized");
    });
    const filteredCategories = idSet ? byCategory.filter((c) => idSet.has(c.id)) : byCategory;
    const filteredTotal = filteredCategories.reduce((sum, c) => sum + c.sec, 0);
    const filteredEarnings = filteredCategories.reduce((sum, c) => sum + c.earnings, 0);

    const globalPayment = isPro ? paymentDetails : null;
    const paymentBuckets = new Map<string, { details: ReportPaymentDetails; names: string[] }>();
    for (const c of filteredCategories) {
      const row = c.id === "uncategorized" ? undefined : (catMap.get(c.id) as CategoryBillingRow | undefined);
      const merged = mergeCategoryPayment(row, globalPayment);
      if (!paymentDetailsHasContent(merged)) continue;
      const key = paymentFingerprint(merged!);
      const cur = paymentBuckets.get(key);
      if (cur) {
        if (!cur.names.includes(c.name)) cur.names.push(c.name);
      } else {
        paymentBuckets.set(key, { details: merged!, names: [c.name] });
      }
    }
    const paymentSections: ReportPaymentSection[] = Array.from(paymentBuckets.values()).map(({ details, names }) => ({
      title: names.length === 1 ? `Payment — ${names[0]}` : `Payment — ${names.join(", ")}`,
      details,
    }));

    const paymentBlock =
      paymentSections.length === 0
        ? { paymentDetails: null as ReportPaymentDetails | null, paymentSections: null as ReportPaymentSection[] | null }
        : paymentSections.length === 1
          ? { paymentDetails: paymentSections[0].details, paymentSections: null as ReportPaymentSection[] | null }
          : { paymentDetails: null as ReportPaymentDetails | null, paymentSections: paymentSections };

    return {
      periodLabel: range.periodLabel,
      rangeLabel: range.label,
      scopeLabel,
      totalSeconds: filteredTotal,
      totalEarnings: filteredEarnings,
      ...paymentBlock,
      categories: filteredCategories.map((c) => ({
        name: c.name,
        color: c.color,
        seconds: c.sec,
        hourlyRate: c.hourlyRate,
        earnings: c.earnings,
        pct: filteredTotal > 0 ? c.sec / filteredTotal : 0,
      })),
      entries: filteredEntries.map((e) => {
        const s = new Date(e.started_at);
        const en = e.ended_at ? new Date(e.ended_at) : new Date();
        const cat: any = catMap.get(e.category_id);
        const durationMin = Math.max(0, Math.round((en.getTime() - s.getTime()) / 60000));
        const hourlyRate = cat?.hourly_rate ?? null;
        const currency = cat?.currency || "USD";
        return {
          date: s.toLocaleDateString(),
          startedAt: s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          endedAt: en.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          category: cat?.name || "Uncategorized",
          durationMin,
          currency,
          hourlyRate,
          earnings: ((hourlyRate || 0) * durationMin) / 60,
          note: e.note ?? null,
        };
      }),
    };
  };

  const onExport = (kind: "pdf" | "csv", categoryIds?: string[], scopeLabel?: string) => {
    if (!isPro) {
      setUpgradeOpen(true);
      return;
    }
    const payload = buildPayload(categoryIds, scopeLabel || "All categories");
    if (!payload.entries.length) {
      toast("Nothing to export for this period");
      return;
    }
    try {
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
            <div className="mt-1.5 flex items-end justify-between gap-3">
              <p className="font-display text-[40px] font-semibold tabular-nums leading-none">
                {fmtHM(totalSec)}
              </p>
              {totalEarnings > 0 && (
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">Estimated pay</p>
                  <p className="font-display text-[22px] font-semibold tabular-nums text-primary">{fmtMoney(totalEarnings)}</p>
                </div>
              )}
            </div>
            <p className="mt-2 text-[12px] text-secondary-fg/80">{range.label}</p>
          </section>

          {/* Category breakdown */}
          {byCategory.length > 0 ? (
            <section className="rounded-2xl border border-border/40 bg-card/30 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">
                    By category
                  </p>
                  <p className="mt-1 text-[11px] text-secondary-fg/70">
                    Expand a category to see its tracker history for this period.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (expandedCategoryIds.size === categoryGroups.length) setExpandedCategoryIds(new Set());
                    else setExpandedCategoryIds(new Set(categoryGroups.map((g) => g.id)));
                  }}
                  className="shrink-0 text-[11px] font-semibold text-primary pressable"
                >
                  {expandedCategoryIds.size === categoryGroups.length ? "Collapse all" : "Expand all"}
                </button>
              </div>
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
                {categoryGroups.map((group) => {
                  const isOpen = expandedCategoryIds.has(group.id);
                  const pct = totalSec > 0 ? group.sec / totalSec : 0;
                  return (
                  <li key={group.id} className="overflow-hidden rounded-2xl border border-border/35 bg-background/30">
                    <button
                      type="button"
                      onClick={() => toggleCategoryExpanded(group.id)}
                      className="flex w-full items-start gap-3 px-3 py-3 text-left pressable"
                      aria-expanded={isOpen}
                    >
                      <span
                        className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ background: group.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[13px] font-semibold text-foreground/95 truncate">
                            {group.name}
                          </span>
                          <span className="text-[12px] tabular-nums text-secondary-fg/85 shrink-0">
                            {fmtHM(group.sec)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-secondary-fg/70">
                          <span>{(pct * 100).toFixed(0)}% of period</span>
                          <span>{group.entries.length} session{group.entries.length === 1 ? "" : "s"}</span>
                          {group.hourlyRate ? <span>{fmtMoney(group.hourlyRate)}/h</span> : <span>No rate</span>}
                          {group.earnings > 0 && <span className="font-semibold text-primary">{fmtMoney(group.earnings)} earned</span>}
                        </div>
                      </div>
                      <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-secondary-fg transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="border-t border-border/30">
                        <ul className="divide-y divide-border/30">
                          {group.entries.map((e) => {
                            const s = new Date(e.started_at);
                            const en = e.ended_at ? new Date(e.ended_at) : new Date();
                            const sec = Math.max(0, (en.getTime() - s.getTime()) / 1000);
                            const earned = ((group.hourlyRate || 0) * sec) / 3600;
                            return (
                              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] text-secondary-fg/75 tabular-nums">
                                    {s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                                    {s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} -{" "}
                                    {en.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  </p>
                                  {e.note && <p className="mt-0.5 truncate text-[12px] text-foreground/80">{e.note}</p>}
                                </div>
                                <span className="text-right">
                                  <span className="block text-[12px] tabular-nums text-secondary-fg/85">{fmtHM(sec)}</span>
                                  {earned > 0 && <span className="block text-[10px] tabular-nums text-primary">{fmtMoney(earned)}</span>}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                        <div className="grid grid-cols-2 gap-2 px-4 py-3">
                          <button
                            type="button"
                            onClick={() => onExport("pdf", [group.id], group.name)}
                            className="h-8 rounded-xl border border-border/40 text-[11px] font-semibold text-secondary-fg/85 pressable hover:text-foreground"
                            aria-label={`Download PDF report for ${group.name}`}
                          >
                            PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => onExport("csv", [group.id], group.name)}
                            className="h-8 rounded-xl border border-border/40 text-[11px] font-semibold text-secondary-fg/85 pressable hover:text-foreground"
                            aria-label={`Download CSV report for ${group.name}`}
                          >
                            CSV
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                  );
                })}
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

          {/* Export */}
          <section className="space-y-2 pt-2">
            <div className="rounded-2xl border border-border/40 bg-card/25 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">
                Export scope
              </div>
              <div className="mt-1 text-[13px] text-foreground/90">
                All categories
              </div>
              {!isPro && (
                <p className="mt-1 text-[11px] text-secondary-fg/70">
                  Exporting billing reports and payment details is included with Pro.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => onExport("pdf")}
              className="h-11 rounded-2xl border-border/50 text-[13px] font-medium"
            >
              <FileText className="h-4 w-4 mr-1.5" /> {isPro ? "All PDF" : "Pro PDF"}
            </Button>
            <Button
              variant="outline"
              onClick={() => onExport("csv")}
              className="h-11 rounded-2xl border-border/50 text-[13px] font-medium"
            >
              <Download className="h-4 w-4 mr-1.5" /> {isPro ? "All CSV" : "Pro CSV"}
            </Button>
            </div>
          </section>
        </div>
      </div>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
    </Shell>
  );
}