import { lazy, Suspense, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BarChart3, ChevronDown, Download, FileText, ListFilter, ChevronRight } from "lucide-react";
import { useExchangeRates, convertCurrency } from "@/hooks/useExchangeRates";
import { CurrencyPickerSheet } from "@/components/app/CurrencyPickerSheet";
import { motion, AnimatePresence } from "framer-motion";
import { DateRangePickerSheet } from "@/components/app/DateRangePickerSheet";
import { CategoryFilterSheet } from "@/components/app/CategoryFilterSheet";

// Recharts is its own ~100kB chunk. Lazy-load it so the Reports first paint
// shows headline numbers + the per-day list while the chart streams in.
const ReportsTrendChart = lazy(() => import("@/components/app/ReportsTrendChart"));
import {
  downloadReportCsv,
  downloadReportPdf,
  type ReportPaymentDetails,
  type ReportPayload,
  type ReportPaymentSection,
} from "@/lib/reportExport";
import {
  mergeCategoryPayment,
  paymentDetailsHasContent,
  type CategoryBillingRow,
} from "@/lib/categoryBilling";
import { toast } from "sonner";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { TickingNumber } from "@/components/app/TickingNumber";
import { useTimeTracker, useTimeTrackerElapsed } from "@/hooks/useTimeTracker";
import { useTabVisible } from "@/components/app/PersistentTabs";
import {
  filterEntriesByRange,
  rollingEntriesQueryKey,
  fetchRollingEntries,
  type RollingEntry,
  ROLLING_ENTRIES_DAYS,
} from "@/lib/timeEntriesQuery";
import { parseDateStr, todayDateStr, friendlyDateFor, dateStr } from "@/lib/daydraft";

type Period = "day" | "week" | "month" | "custom";

function periodRange(period: Period, customFromStr?: string, customToStr?: string): { from: Date; to: Date; label: string; periodLabel: string } {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  
  if (period === "custom") {
    const cf = parseDateStr(customFromStr || todayDateStr());
    cf.setHours(0, 0, 0, 0);
    const ct = parseDateStr(customToStr || todayDateStr());
    ct.setHours(23, 59, 59, 999);
    // auto-swap if inverted
    const [finalFrom, finalTo] = cf.getTime() > ct.getTime() ? [ct, cf] : [cf, ct];
    return {
      from: finalFrom,
      to: finalTo,
      label: `${friendlyDateFor(finalFrom)} – ${friendlyDateFor(finalTo)}`,
      periodLabel: "Custom period"
    };
  }

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
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const label = period === "day" ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
  const periodLabel = period === "day" ? "Day" : period === "week" ? "Week" : "Month";
  return { from, to, label, periodLabel };
}

const fmtHM = (sec: number) => {
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (!h) {
    if (mm === 0 && sec > 0) return `${Math.floor(sec)}s`;
    return `${mm}m`;
  }
  return mm ? `${h}h ${mm}m` : `${h}h`;
};

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
  ].join("");
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

type CategoryGroup = {
  id: string;
  name: string;
  color: string;
  currency: string;
  hourlyRate: number | null;
  sec: number;
  earnings: number;
  pct: number;
  entries: RollingEntry[];
};

export default function Reports() {
  const { user } = useAuth();
  const { isPro } = useEntitlement();
  // Categories already live in the TimeTrackerProvider — reading them from the
  // shared context avoids a Reports-only fetch on every tab switch.
  const { categories } = useTimeTracker();
  // Subscribing to elapsedSec keeps live totals (running timer in the active
  // category) ticking inside Reports without a per-tab Supabase query.
  useTimeTrackerElapsed();
  const reportsTabVisible = useTabVisible();
  const [period, setPeriod] = useState<Period>("week");
  const minDateStrVal = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - ROLLING_ENTRIES_DAYS);
    return dateStr(d);
  }, []);
  // Custom range defaults to today / today — opening Custom mode should
  // feel like "I'm here, show me right now", not "show me a random week".
  const [customFrom, setCustomFrom] = useState<string>(() => todayDateStr());
  const [customTo, setCustomTo] = useState<string>(() => todayDateStr());
  // Empty Set = "all categories" (no filter applied). Set with ids = only
  // those categories. Lives separately from the date picker draft so each
  // sheet has independent committed state.
  const [appliedCatIds, setAppliedCatIds] = useState<Set<string>>(() => new Set());
  // Sheet open flags — kept page-level so the sheets themselves can stay
  // pure presentation components that never own their visibility.
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [catSheetOpen, setCatSheetOpen] = useState(false);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set());
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<string>(
    () => localStorage.getItem("reports-display-currency") || "USD",
  );
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const { data: rates = {}, isLoading: ratesLoading } = useExchangeRates();
  const range = useMemo(() => periodRange(period, customFrom, customTo), [period, customFrom, customTo]);

  const { data: rollingEntries = [] } = useQuery({
    queryKey: rollingEntriesQueryKey(user?.id),
    queryFn: () => fetchRollingEntries(user!.id),
    enabled: !!user?.id && reportsTabVisible,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: paymentDetails = null } = useQuery({
    queryKey: ["billing-payment-details", user?.id],
    enabled: !!user?.id && isPro && reportsTabVisible,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
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

  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const periodEntries = useMemo(() => {
    const inRange = filterEntriesByRange(rollingEntries, range);
    // Category filter — empty Set sentinel means "no filter, show all".
    // Filtering happens locally so we don't re-fetch from Supabase when the
    // user toggles a category; rollingEntries is already a 60-day window.
    if (appliedCatIds.size === 0) return inRange;
    return inRange.filter((e) => appliedCatIds.has(e.category_id || "uncategorized"));
  }, [rollingEntries, range, appliedCatIds]);

  // Single pass through entries — previously this file built two near-identical
  // aggregations (`byCategory` and `categoryGroups`) which doubled the work on
  // every period change. One walk computes totals, per-category sums, per-day
  // sums, and per-category entry lists at once.
  const { totalSec, totalEarnings, categoryGroups, perDay, earningsByCurrency } = useMemo(() => {
    const now = Date.now();
    let total = 0;
    let earnedTotal = 0;
    const groups = new Map<string, CategoryGroup>();
    const dMap = new Map<string, number>();
    for (const e of periodEntries) {
      const s = new Date(e.started_at).getTime();
      const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
      const sec = Math.max(0, (en - s) / 1000);
      if (sec <= 0) continue;
      total += sec;
      const id = e.category_id || "uncategorized";
      const cat = (e.category_id ? catMap.get(e.category_id) : undefined) as
        | (typeof categories)[number]
        | undefined;
      const rate = cat?.hourly_rate ?? null;
      const earned = ((rate || 0) * sec) / 3600;
      earnedTotal += earned;
      let group = groups.get(id);
      if (!group) {
        group = {
          id,
          name: cat?.name || "Uncategorized",
          color: cat?.color || "hsl(var(--muted-foreground))",
          currency: cat?.currency || "USD",
          hourlyRate: rate,
          sec: 0,
          earnings: 0,
          pct: 0,
          entries: [],
        };
        groups.set(id, group);
      }
      group.sec += sec;
      group.earnings += earned;
      group.entries.push(e);

      const d = new Date(s);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dMap.set(key, (dMap.get(key) || 0) + sec);
    }
    const groupList = Array.from(groups.values())
      .map((g) => ({ ...g, pct: total > 0 ? g.sec / total : 0 }))
      .sort((a, b) => b.sec - a.sec);
    const perDay = Array.from(dMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, sec]) => ({
        day: k.slice(5),
        hours: Number((sec / 3600).toFixed(2)),
      }));
    const byCurrency = new Map<string, number>();
    for (const g of groupList) {
      if (g.earnings > 0) {
        byCurrency.set(g.currency, (byCurrency.get(g.currency) ?? 0) + g.earnings);
      }
    }
    return {
      totalSec: total,
      totalEarnings: earnedTotal,
      categoryGroups: groupList,
      perDay,
      earningsByCurrency: byCurrency,
    };
  }, [periodEntries, catMap]);

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
    const filteredCategories = idSet
      ? categoryGroups.filter((c) => idSet.has(c.id))
      : categoryGroups;
    const filteredEntries = idSet
      ? periodEntries.filter((e) => idSet.has(e.category_id || "uncategorized"))
      : periodEntries;
    const filteredTotal = filteredCategories.reduce((sum, c) => sum + c.sec, 0);
    const filteredEarnings = filteredCategories.reduce((sum, c) => sum + c.earnings, 0);

    const globalPayment = isPro ? paymentDetails : null;
    const paymentBuckets = new Map<string, { details: ReportPaymentDetails; names: string[] }>();
    for (const c of filteredCategories) {
      const row =
        c.id === "uncategorized" ? undefined : (catMap.get(c.id) as CategoryBillingRow | undefined);
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
    const paymentSections: ReportPaymentSection[] = Array.from(paymentBuckets.values()).map(
      ({ details, names }) => ({
        title: names.length === 1 ? `Payment — ${names[0]}` : `Payment — ${names.join(", ")}`,
        details,
      }),
    );

    const paymentBlock =
      paymentSections.length === 0
        ? { paymentDetails: null as ReportPaymentDetails | null, paymentSections: null as ReportPaymentSection[] | null }
        : paymentSections.length === 1
          ? { paymentDetails: paymentSections[0].details, paymentSections: null as ReportPaymentSection[] | null }
          : { paymentDetails: null as ReportPaymentDetails | null, paymentSections };

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
        currency: c.currency,
        hourlyRate: c.hourlyRate,
        earnings: c.earnings,
        pct: filteredTotal > 0 ? c.sec / filteredTotal : 0,
      })),
      entries: filteredEntries.map((e) => {
        const s = new Date(e.started_at);
        const en = e.ended_at ? new Date(e.ended_at) : new Date();
        const cat = e.category_id ? catMap.get(e.category_id) : undefined;
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

  const onExport = async (kind: "pdf" | "csv", categoryIds?: string[], scopeLabel?: string) => {
    if (!isPro) {
      setUpgradeOpen(true);
      return;
    }
    const payload = buildPayload(categoryIds, scopeLabel || "All categories");
    try {
      if (kind === "pdf") await downloadReportPdf(payload);
      else await downloadReportCsv(payload);
      if (!payload.entries.length) toast("Exported an empty report — no entries in this period");
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  };

  return (
    <>
      <div className="flex w-full flex-col px-5 pt-[var(--content-inset-top)] pb-5">
        <header className="shrink-0 pb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-fg/65">
            Reports
          </p>
          <h1 className="mt-1 font-display text-[26px] font-semibold tracking-[-0.02em]">
            Time insights
          </h1>
        </header>

        {/*
          Period segmented control. Active uses a primary-tinted pill +
          ring rather than `bg-background`, which on dark mode is pure
          black and disappeared into the parent track. The underlay
          slides between buttons via transform so the selection reads
          as one continuous motion. Buttons are an equal-width 4-col
          grid so the slide hits each pill exactly.
        */}
        <div
          className="shrink-0 mb-5 relative isolate grid grid-cols-4 p-1 rounded-2xl surface-soft border border-soft self-start w-[280px]"
          role="tablist"
        >
          {(["day", "week", "month", "custom"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={`relative z-[1] h-8 rounded-xl text-[12px] font-semibold capitalize transition-colors duration-200 pressable ${
                period === p
                  ? "text-foreground"
                  : "text-secondary-fg/85 hover:text-foreground"
              }`}
            >
              {period === p && (
                <motion.div
                  layoutId="reports-period-tab"
                  className="absolute inset-0 rounded-xl bg-surface-elevated border border-soft shadow-sm"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  style={{ zIndex: -1 }}
                />
              )}
              {p}
            </button>
          ))}
        </div>

        {/* Category filter — visible in EVERY period mode (not just custom),
            because filtering by which categories count is useful regardless
            of the time window. Empty applied-set means "no filter, show all". */}
        <CategoryFilterChip
          categories={categories as any}
          appliedIds={appliedCatIds}
          onOpen={() => setCatSheetOpen(true)}
          onClear={() => setAppliedCatIds(new Set())}
        />

        <AnimatePresence initial={false}>
          {period === "custom" && (
            <motion.div
              initial={{ height: 0, opacity: 0, y: -8 }}
              animate={{ height: "auto", opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -8 }}
              transition={{ type: "spring", bounce: 0.25, duration: 0.55 }}
              className="overflow-hidden origin-top"
            >
              {/* From / To chip pair. Replaced the old `<Input type="date">`
                  pair because the native date picker:
                    1. clips on narrower Android phones (the user's bug),
                    2. has no consistent open animation across platforms,
                    3. mutates the applied range on every keystroke — making
                       the background cards flicker while the user is still
                       picking.
                  The chip cards are responsive (grid, never clip), and the
                  bottom-sheet picker holds its draft state until Apply. */}
              <div className="pb-5 pt-1 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDateSheetOpen(true)}
                  className="hero-glass border border-border/35 rounded-2xl px-4 py-3 text-left pressable hover:border-primary/30 transition-colors min-w-0"
                >
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/65 mb-1">From</p>
                  <p className="text-[14.5px] font-semibold text-foreground/95 truncate tabular-nums">
                    {formatChipDate(customFrom)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setDateSheetOpen(true)}
                  className="hero-glass border border-border/35 rounded-2xl px-4 py-3 text-left pressable hover:border-primary/30 transition-colors min-w-0"
                >
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/65 mb-1">To</p>
                  <p className="text-[14.5px] font-semibold text-foreground/95 truncate tabular-nums">
                    {formatChipDate(customTo)}
                  </p>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-5 pb-4 -mx-5 px-5">
          {/*
            Hero-glass top card so Reports has the same luminous primary
            tint at the top of the column that Home's HomeTrackerHero
            provides. Without this, Reports felt flatter / darker than
            the other tabs even though the Shell background is identical.
          */}
          <section className="rounded-[28px] hero-glass border px-5 pt-5 pb-4 deep-float" style={{ animationDelay: '0.4s' }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">
              Total tracked
            </p>
            <div className="mt-1.5 flex items-end justify-between gap-3">
              <p className="font-display text-[40px] font-semibold tabular-nums leading-none overflow-hidden">
                <TickingNumber value={fmtHM(totalSec)} />
              </p>
              {earningsByCurrency.size > 0 && (() => {
                const hasRates = Object.keys(rates).length > 1;
                const converted = Array.from(earningsByCurrency.entries()).reduce(
                  (sum, [from, amount]) =>
                    sum + (hasRates ? convertCurrency(amount, from, displayCurrency, rates) : amount),
                  0,
                );
                return (
                  <button
                    type="button"
                    onClick={() => setCurrencyPickerOpen(true)}
                    className="text-right pressable rounded-xl p-1 -m-1"
                    aria-label="Change display currency"
                  >
                    <span className="flex items-center justify-end gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">
                        Estimated pay
                      </span>
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-2 py-0.5 text-[9.5px] font-bold text-success border border-success/30">
                        {displayCurrency}
                        <ChevronRight className="h-2.5 w-2.5 opacity-80" />
                      </span>
                    </span>
                    <span className={`block font-display text-[22px] font-semibold tabular-nums text-success leading-none mt-1 transition-opacity ${ratesLoading && !hasRates ? "opacity-40" : ""}`}>
                      <TickingNumber value={fmtMoney(converted, displayCurrency)} />
                    </span>
                  </button>
                );
              })()}
            </div>
            <p className="mt-2 text-[12px] text-secondary-fg/80">{range.label}</p>
          </section>

          {categoryGroups.length > 0 ? (
            <section className="hero-glass border border-border/35 rounded-[28px] p-4">
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
              <div className="h-2 w-full rounded-full overflow-hidden flex bg-muted/40 mb-3">
                {categoryGroups.map((c) => (
                  <div
                    key={c.id}
                    style={{ width: `${c.pct * 100}%`, background: c.color }}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                  />
                ))}
              </div>
              <ul className="space-y-2 enter-stagger">
                {categoryGroups.map((group) => {
                  const isOpen = expandedCategoryIds.has(group.id);
                  return (
                    <li key={group.id} className="overflow-hidden rounded-2xl border border-soft/50 surface-soft card-volumetric">
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
                            <span>{(group.pct * 100).toFixed(0)}% of period</span>
                            <span>
                              {group.entries.length} session{group.entries.length === 1 ? "" : "s"}
                            </span>
                            {group.hourlyRate ? (
                              <span>{fmtMoney(group.hourlyRate, group.currency)}/h</span>
                            ) : (
                              <span>No rate</span>
                            )}
                            {group.earnings > 0 && (
                              <span className="font-semibold text-success">
                                {fmtMoney(group.earnings, group.currency)} earned
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronDown
                          className={`mt-0.5 h-4 w-4 shrink-0 text-secondary-fg transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      {isOpen && (
                        <div className="border-t border-soft">
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
                                    {e.note && (
                                      <p className="mt-0.5 truncate text-[12px] text-foreground/80">{e.note}</p>
                                    )}
                                  </div>
                                  <span className="text-right">
                                    <span className="block text-[12px] tabular-nums text-secondary-fg/85">
                                      {fmtHM(sec)}
                                    </span>
                                    {earned > 0 && (
                                      <span className="block text-[10px] tabular-nums text-success">
                                        {fmtMoney(earned, group.currency)}
                                      </span>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                          <div className="grid grid-cols-2 gap-2 px-4 py-3">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onExport("pdf", [group.id], group.name); }}
                              className="h-8 rounded-xl border border-soft text-[11px] font-semibold text-secondary-fg/85 pressable hover:text-foreground"
                              aria-label={`Download PDF report for ${group.name}`}
                            >
                              PDF
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onExport("csv", [group.id], group.name); }}
                              className="h-8 rounded-xl border border-soft text-[11px] font-semibold text-secondary-fg/85 pressable hover:text-foreground"
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
            <section className="rounded-2xl border border-dashed border-soft px-4 py-8 text-center">
              <BarChart3 className="h-6 w-6 mx-auto text-secondary-fg/60 mb-2" />
              <p className="text-[13px] text-secondary-fg/85">No tracked time in this period</p>
              <p className="text-[11px] text-secondary-fg/60 mt-1">
                Start a timer on the Track tab to fill this in.
              </p>
            </section>
          )}

          {period !== "day" && perDay.length > 1 && (
            <section className="hero-glass border border-border/35 rounded-[28px] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70 mb-2">
                Daily trend
              </p>
              <div className="h-32 -mx-2">
                <Suspense fallback={<div className="h-full w-full rounded-xl shimmer opacity-60" />}>
                  <ReportsTrendChart perDay={perDay} />
                </Suspense>
              </div>
            </section>
          )}

          <section className="space-y-2 pt-2">
            {!isPro && (
              <p className="text-[11px] text-secondary-fg/70 px-0.5">
                PDF and CSV export with billing details is included with Pro.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => onExport("pdf")}
                className="h-11 rounded-2xl border-soft text-[13px] font-medium"
              >
                <FileText className="h-4 w-4 mr-1.5" /> Export PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => onExport("csv")}
                className="h-11 rounded-2xl border-soft text-[13px] font-medium"
              >
                <Download className="h-4 w-4 mr-1.5" /> Export CSV
              </Button>
            </div>
          </section>
        </div>
      </div>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
      <CurrencyPickerSheet
        open={currencyPickerOpen}
        onOpenChange={setCurrencyPickerOpen}
        selected={displayCurrency}
        rates={rates}
        ratesLoading={ratesLoading}
        onSelect={(code) => {
          setDisplayCurrency(code);
          localStorage.setItem("reports-display-currency", code);
        }}
      />
      <DateRangePickerSheet
        open={dateSheetOpen}
        onOpenChange={setDateSheetOpen}
        initialFrom={customFrom}
        initialTo={customTo}
        minDate={minDateStrVal}
        onApply={(from, to) => {
          // Commit both endpoints together so the background page only
          // rerenders once with the final range, not on every tap inside
          // the calendar.
          setCustomFrom(from);
          setCustomTo(to);
        }}
      />
      <CategoryFilterSheet
        open={catSheetOpen}
        onOpenChange={setCatSheetOpen}
        categories={categories as any}
        initialSelected={appliedCatIds}
        onApply={setAppliedCatIds}
      />
    </>
  );
}

/** Render a single date in the "Sat, 24 May" chip-card format. Falls back to
 *  the raw ymd if parsing fails. */
function formatChipDate(ymd: string): string {
  try {
    const d = parseDateStr(ymd);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return ymd;
  }
}

/** Inline chip that summarises the current category filter. Tapping it opens
 *  the bottom-sheet multi-select. Designed to read as "All categories" when
 *  no filter is set (the most common state), so the chip never looks alarming
 *  for users who don't need filtering. */
function CategoryFilterChip({
  categories,
  appliedIds,
  onOpen,
  onClear,
}: {
  categories: { id: string; name: string; color: string }[];
  appliedIds: Set<string>;
  onOpen: () => void;
  onClear: () => void;
}) {
  const isFiltered = appliedIds.size > 0;
  // Show up to 3 colour dots when filtered, otherwise one neutral icon.
  const swatches = isFiltered
    ? categories.filter((c) => appliedIds.has(c.id)).slice(0, 3)
    : [];
  return (
    <div className="shrink-0 mb-4 flex items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        className={`flex items-center gap-2 h-9 px-3 rounded-full border text-[12.5px] font-medium pressable transition-colors min-w-0 ${
          isFiltered
            ? "border-primary/40 bg-primary/[0.08] text-foreground/95"
            : "border-border/40 bg-foreground/[0.03] text-foreground/85 hover:bg-foreground/[0.06]"
        }`}
        aria-label="Filter by category"
      >
        <ListFilter className="h-3.5 w-3.5 shrink-0 opacity-80" />
        {swatches.length > 0 && (
          <span className="flex -space-x-1.5" aria-hidden>
            {swatches.map((c) => (
              <span
                key={c.id}
                className="h-3 w-3 rounded-full ring-2 ring-popover"
                style={{ background: c.color }}
              />
            ))}
          </span>
        )}
        <span className="truncate">
          {isFiltered
            ? `${appliedIds.size} ${appliedIds.size === 1 ? "category" : "categories"}`
            : "All categories"}
        </span>
      </button>
      {isFiltered && (
        <button
          type="button"
          onClick={onClear}
          className="text-[12px] font-medium text-secondary-fg/85 hover:text-foreground pressable px-2 py-1 transition-colors"
          aria-label="Clear category filter"
        >
          Clear
        </button>
      )}
    </div>
  );
}
