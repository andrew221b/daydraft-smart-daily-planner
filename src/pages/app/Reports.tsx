import { lazy, Suspense, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BarChart3, ChevronDown, Download, FileText, ListFilter, ChevronRight, Timer } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/app/EmptyState";
import { useExchangeRates, convertCurrency } from "@/hooks/useExchangeRates";
import { CurrencyPickerSheet } from "@/components/app/CurrencyPickerSheet";
import { motion, AnimatePresence } from "framer-motion";
import { DateRangePickerSheet } from "@/components/app/DateRangePickerSheet";
import { CategoryFilterSheet } from "@/components/app/CategoryFilterSheet";
import { useReportCurrencyOverrides } from "@/hooks/useReportCurrency";
import { ReportCurrencyMismatchDialog } from "@/components/app/ReportCurrencyMismatchDialog";
import { BiometricGateSheet } from "@/components/app/BiometricGateSheet";
import { getGatePref, verifyBiometric } from "@/lib/biometricGate";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PaymentMethodFields, type PaymentFieldsValue } from "@/components/app/PaymentMethodFields";
import { categoryBillingToDraft } from "@/lib/categoryBilling";

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
  /** Tracker currency — what the hourly_rate is denominated in. Source of
   *  truth for "what was actually earned at the timer's rate". */
  currency: string;
  /** Report-display currency. Defaults to `currency`, but the user can
   *  override per-category via the row chip. When `reportCurrency` differs
   *  from `currency`, earnings get FX-converted for display, and the export
   *  flow will prompt the user to update payment details to match. */
  reportCurrency: string;
  hourlyRate: number | null;
  sec: number;
  earnings: number;
  pct: number;
  entries: RollingEntry[];
};

export default function Reports() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { isPro } = useEntitlement();
  // Categories already live in the TimeTrackerProvider — reading them from the
  // shared context avoids a Reports-only fetch on every tab switch.
  const { categories, updateCategoryBilling } = useTimeTracker();
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
  // Per-category report-currency overrides — independent from each
  // category's tracker currency (which drives the live timer rate). See
  // useReportCurrency.ts for the full data-flow story.
  const { effectiveCurrency: getReportCurrency, setOverride: setCatOverride, clearOverride: clearCatOverride } = useReportCurrencyOverrides();
  // Which category row is currently editing its report currency. `null` = sheet
  // closed. Holds catId + the row's tracker currency so the picker has both.
  const [reportCurrencyTarget, setReportCurrencyTarget] = useState<{ catId: string; trackerCurrency: string } | null>(null);
  // Export-time mismatch flow state.
  const [pendingExport, setPendingExport] = useState<{ kind: "pdf" | "csv"; categoryIds?: string[]; scopeLabel?: string } | null>(null);
  const [exportGateOpen, setExportGateOpen] = useState(false);
  const [pendingGatedExport, setPendingGatedExport] = useState<{ kind: "pdf" | "csv"; categoryIds?: string[]; scopeLabel?: string } | null>(null);
  const [mismatchDialogOpen, setMismatchDialogOpen] = useState(false);
  const [mismatchList, setMismatchList] = useState<import("@/components/app/ReportCurrencyMismatchDialog").CurrencyMismatch[]>([]);
  // When the user accepts the "update payment details" flow, we walk the
  // mismatch list one at a time. `editIdx` points at the current one;
  // `editDraft` holds the working payment data for that category.
  const [editIdx, setEditIdx] = useState(0);
  const [editDraft, setEditDraft] = useState<PaymentFieldsValue | null>(null);
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
        const trackerCurrency = (cat?.currency || "USD").toUpperCase();
        group = {
          id,
          name: cat?.name || "Uncategorized",
          color: cat?.color || "hsl(var(--muted-foreground))",
          currency: trackerCurrency,
          // Report currency = override (if any) or the tracker currency.
          // Stored on the group so downstream renderers and the export
          // payload builder both read from one place.
          reportCurrency: getReportCurrency(id, trackerCurrency),
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
  }, [periodEntries, catMap, getReportCurrency]);

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

    // Sum earnings in each report currency for the export totals — when the
    // user has overridden one category to a different currency, the top-line
    // total needs to reflect the converted numbers, not the raw tracker sums.
    let totalEarningsConverted = 0;
    for (const c of filteredCategories) {
      const reportCur = c.reportCurrency;
      const converted = reportCur !== c.currency
        ? convertCurrency(c.earnings, c.currency, reportCur, rates)
        : c.earnings;
      totalEarningsConverted += converted;
    }

    return {
      periodLabel: range.periodLabel,
      rangeLabel: range.label,
      scopeLabel,
      totalSeconds: filteredTotal,
      totalEarnings: totalEarningsConverted,
      ...paymentBlock,
      categories: filteredCategories.map((c) => {
        const converted = c.reportCurrency !== c.currency
          ? convertCurrency(c.earnings, c.currency, c.reportCurrency, rates)
          : c.earnings;
        const convertedRate = c.hourlyRate && c.reportCurrency !== c.currency
          ? convertCurrency(c.hourlyRate, c.currency, c.reportCurrency, rates)
          : c.hourlyRate;
        return {
          name: c.name,
          color: c.color,
          seconds: c.sec,
          currency: c.reportCurrency,
          hourlyRate: convertedRate,
          earnings: converted,
          pct: filteredTotal > 0 ? c.sec / filteredTotal : 0,
        };
      }),
      entries: filteredEntries.map((e) => {
        const s = new Date(e.started_at);
        const en = e.ended_at ? new Date(e.ended_at) : new Date();
        const cat = e.category_id ? catMap.get(e.category_id) : undefined;
        const durationMin = Math.max(0, Math.round((en.getTime() - s.getTime()) / 60000));
        const hourlyRate = cat?.hourly_rate ?? null;
        const trackerCur = (cat?.currency || "USD").toUpperCase();
        const reportCur = cat ? getReportCurrency(cat.id, trackerCur) : trackerCur;
        const earningsTracker = ((hourlyRate || 0) * durationMin) / 60;
        const earnings = reportCur !== trackerCur
          ? convertCurrency(earningsTracker, trackerCur, reportCur, rates)
          : earningsTracker;
        const displayedRate = hourlyRate && reportCur !== trackerCur
          ? convertCurrency(hourlyRate, trackerCur, reportCur, rates)
          : hourlyRate;
        return {
          date: s.toLocaleDateString(),
          startedAt: s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          endedAt: en.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          category: cat?.name || "Uncategorized",
          durationMin,
          currency: reportCur,
          hourlyRate: displayedRate,
          earnings,
          note: e.note ?? null,
        };
      }),
    };
  };

  const runExport = async (kind: "pdf" | "csv", categoryIds?: string[], scopeLabel?: string) => {
    const payload = buildPayload(categoryIds, scopeLabel || "All categories");
    try {
      if (kind === "pdf") await downloadReportPdf(payload);
      else await downloadReportCsv(payload);
      if (!payload.entries.length) toast("Exported an empty report — no entries in this period");
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  };

  /**
   * Find categories in scope where the report currency the user picked
   * doesn't match the tracker currency that owns the payment details. These
   * are the rows whose payment block in the exported PDF would otherwise
   * disagree with the displayed earnings.
   */
  const findMismatches = (categoryIds?: string[]): import("@/components/app/ReportCurrencyMismatchDialog").CurrencyMismatch[] => {
    const idSet = categoryIds?.length ? new Set(categoryIds) : null;
    const scope = idSet
      ? categoryGroups.filter((c) => idSet.has(c.id))
      : categoryGroups;
    return scope
      .filter((c) => c.id !== "uncategorized" && c.reportCurrency !== c.currency)
      .map((c) => ({
        catId: c.id,
        catName: c.name,
        catColor: c.color,
        trackerCurrency: c.currency,
        reportCurrency: c.reportCurrency,
      }));
  };

  // Core export dispatch — no gate. Called after verification is done (by
  // onExport gate wrapper) or from the mismatch dialog (already past the gate).
  const doExport = async (kind: "pdf" | "csv", categoryIds?: string[], scopeLabel?: string) => {
    if (!isPro) { setUpgradeOpen(true); return; }
    const mismatches = findMismatches(categoryIds);
    if (mismatches.length > 0) {
      setPendingExport({ kind, categoryIds, scopeLabel });
      setMismatchList(mismatches);
      setMismatchDialogOpen(true);
      return;
    }
    await runExport(kind, categoryIds, scopeLabel);
  };

  // Gate wrapper: first time → show explanation sheet; subsequent → system
  // biometric prompt fires directly (no custom UI).
  const onExport = async (kind: "pdf" | "csv", categoryIds?: string[], scopeLabel?: string) => {
    if (!isPro) { setUpgradeOpen(true); return; }
    if (getGatePref() === "unset") {
      setPendingGatedExport({ kind, categoryIds, scopeLabel });
      setExportGateOpen(true);
      return;
    }
    const allowed = await verifyBiometric("Export time tracking report");
    if (allowed) await doExport(kind, categoryIds, scopeLabel);
  };

  // ── Mismatch-flow handlers ────────────────────────────────────────────
  // Open the first PaymentMethodFields sheet, pre-filled with the cat's
  // existing billing data but with currency set to the report currency.
  const beginEditFlow = () => {
    setMismatchDialogOpen(false);
    if (!mismatchList.length) return;
    setEditIdx(0);
    openEditSheetFor(0);
  };

  const openEditSheetFor = (idx: number) => {
    const m = mismatchList[idx];
    if (!m) return;
    const row = catMap.get(m.catId) as CategoryBillingRow | undefined;
    const draft = categoryBillingToDraft(row);
    // Pre-set the currency to the report currency so the picker / fields
    // make sense for the new account.
    draft.currency = m.reportCurrency;
    // If the new currency is a different kind (crypto vs fiat), wipe the
    // old payment_method so PaymentMethodFields' auto-detect can pick a
    // valid one for the new kind.
    draft.payment_method = "";
    setEditDraft(draft);
  };

  const saveCurrentEdit = async () => {
    const m = mismatchList[editIdx];
    if (!m || !editDraft) return;
    try {
      await updateCategoryBilling(m.catId, {
        currency: editDraft.currency,
        payment_method: editDraft.payment_method,
        display_name: editDraft.display_name,
        bank_name: editDraft.bank_name,
        iban: editDraft.iban,
        crypto_network: editDraft.crypto_network,
        crypto_wallet: editDraft.crypto_wallet,
        payment_link: editDraft.payment_link,
        notes: editDraft.notes,
      });
      // Override is now redundant — tracker matches report. Clear it.
      clearCatOverride(m.catId);
    } catch (e: any) {
      toast.error(e?.message || "Could not save payment details");
      return;
    }
    advanceEditFlow();
  };

  const advanceEditFlow = () => {
    const nextIdx = editIdx + 1;
    if (nextIdx >= mismatchList.length) {
      // All done — close sheet, kick off the actual export.
      setEditDraft(null);
      const pe = pendingExport;
      setPendingExport(null);
      setMismatchList([]);
      if (pe) void runExport(pe.kind, pe.categoryIds, pe.scopeLabel);
      return;
    }
    setEditIdx(nextIdx);
    openEditSheetFor(nextIdx);
  };

  const skipCurrentEdit = () => {
    // User declined to update this category — keep the override and move on.
    advanceEditFlow();
  };

  const exportAsIs = async () => {
    setMismatchDialogOpen(false);
    const pe = pendingExport;
    setPendingExport(null);
    setMismatchList([]);
    if (pe) await runExport(pe.kind, pe.categoryIds, pe.scopeLabel);
  };

  const cancelExport = () => {
    setMismatchDialogOpen(false);
    setPendingExport(null);
    setMismatchList([]);
  };

  return (
    <>
      <div className="flex w-full flex-col px-5 pt-[var(--content-inset-top)] pb-5">
        <header className="shrink-0 pb-6">
          <p className="eyebrow">
            Reports
          </p>
          <h1 className="page-title mt-1">
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
          className="shrink-0 mb-5 relative isolate grid grid-cols-4 p-1 rounded-2xl surface-soft border border-soft self-start w-full max-w-[280px]"
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
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/65 mb-1">From</p>
                  <p className="text-[15px] font-semibold text-foreground/95 truncate tabular-nums">
                    {formatChipDate(customFrom)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setDateSheetOpen(true)}
                  className="hero-glass border border-border/35 rounded-2xl px-4 py-3 text-left pressable hover:border-primary/30 transition-colors min-w-0"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/65 mb-1">To</p>
                  <p className="text-[15px] font-semibold text-foreground/95 truncate tabular-nums">
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
              <p className="font-display text-[40px] font-semibold tabular-nums leading-none whitespace-nowrap">
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
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success border border-success/30">
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
                  className="shrink-0 text-[11px] font-semibold text-primary pressable py-1.5 px-1 -my-1.5 -mx-1"
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
              <ul className="space-y-2 enter-stagger reports-category-list">
                {categoryGroups.map((group) => {
                  const isOpen = expandedCategoryIds.has(group.id);
                  return (
                    <li key={group.id} className="reports-category-card overflow-hidden rounded-2xl border border-soft/50 surface-soft card-volumetric">
                      <button
                        type="button"
                        onClick={() => toggleCategoryExpanded(group.id)}
                        className="flex w-full items-start gap-3 px-3 py-3 text-left"
                        aria-expanded={isOpen}
                      >
                        <span
                          className="reports-cat-dot mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: group.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13.5px] font-semibold text-foreground truncate">
                              {group.name}
                            </span>
                            <span className="reports-cat-total text-[12px] font-semibold tabular-nums text-foreground/85 shrink-0">
                              {fmtHM(group.sec)}
                            </span>
                          </div>
                          <div className="reports-cat-meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-secondary-fg/75">
                            <span>{(group.pct * 100).toFixed(0)}% of period</span>
                            <span>
                              {group.entries.length} session{group.entries.length === 1 ? "" : "s"}
                            </span>
                            {group.hourlyRate ? (
                              <span>{fmtMoney(group.hourlyRate, group.currency)}/h</span>
                            ) : (
                              <span>No rate</span>
                            )}
                            {group.earnings > 0 && (() => {
                              // Convert earnings to report currency for display
                              // when override differs. Falls back to original
                              // amount silently if rates aren't loaded yet.
                              const shouldConvert = group.reportCurrency !== group.currency;
                              const displayedAmount = shouldConvert
                                ? convertCurrency(group.earnings, group.currency, group.reportCurrency, rates)
                                : group.earnings;
                              return (
                                <span className="font-semibold text-success">
                                  {fmtMoney(displayedAmount, group.reportCurrency)} earned
                                </span>
                              );
                            })()}
                            {/* Report-currency chip — taps to override the
                                display currency for this category's report.
                                Has a subtle accent ring when an override is
                                active (report ≠ tracker). */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (group.id === "uncategorized") return;
                                setReportCurrencyTarget({ catId: group.id, trackerCurrency: group.currency });
                              }}
                              disabled={group.id === "uncategorized"}
                              aria-label={`Change report currency for ${group.name}`}
                              className={[
                                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums tracking-[0.04em]",
                                "transition-[transform,box-shadow,background-color] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.96]",
                                group.id === "uncategorized" ? "cursor-default" : "pressable",
                              ].join(" ")}
                              style={
                                group.reportCurrency !== group.currency
                                  ? {
                                      background:
                                        "linear-gradient(180deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--primary) / 0.08) 100%)",
                                      boxShadow: [
                                        "inset 0 1px 0 hsl(0 0% 100% / 0.12)",
                                        "inset 0 -1px 0 hsl(var(--primary) / 0.30)",
                                        "0 0 0 1px hsl(var(--primary) / 0.40)",
                                      ].join(", "),
                                      color: "hsl(var(--primary))",
                                    }
                                  : {
                                      background: "hsl(var(--foreground) / 0.05)",
                                      boxShadow: "inset 0 0 0 1px hsl(var(--border) / 0.40)",
                                      color: "hsl(var(--foreground) / 0.65)",
                                    }
                              }
                            >
                              {group.reportCurrency}
                              {group.id !== "uncategorized" && (
                                <ChevronDown className="h-2.5 w-2.5 opacity-70" />
                              )}
                            </button>
                          </div>
                        </div>
                        <ChevronDown
                          className={`mt-0.5 h-4 w-4 shrink-0 text-secondary-fg transition-transform duration-300 ease-[cubic-bezier(0.34,1.2,0.64,1)] ${
                            isOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            key="cat-detail"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 340, damping: 28, mass: 0.85 }}
                            style={{ overflow: "hidden" }}
                          >
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
                                        {earned > 0 && (() => {
                                          const display = group.reportCurrency !== group.currency
                                            ? convertCurrency(earned, group.currency, group.reportCurrency, rates)
                                            : earned;
                                          return (
                                            <span className="block text-[10px] tabular-nums text-success">
                                              {fmtMoney(display, group.reportCurrency)}
                                            </span>
                                          );
                                        })()}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                              <div className="grid grid-cols-2 gap-2 px-4 py-3">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onExport("pdf", [group.id], group.name); }}
                                  className="h-9 rounded-xl border border-soft text-[11px] font-semibold text-secondary-fg/85 pressable hover:text-foreground"
                                  aria-label={`Download PDF report for ${group.name}`}
                                >
                                  PDF
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onExport("csv", [group.id], group.name); }}
                                  className="h-9 rounded-xl border border-soft text-[11px] font-semibold text-secondary-fg/85 pressable hover:text-foreground"
                                  aria-label={`Download CSV report for ${group.name}`}
                                >
                                  CSV
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <EmptyState
              icon={Timer}
              tone="primary"
              eyebrow={range.label}
              title="No tracked time yet"
              body="Start a timer on the Track tab and your work will show up here — by category, by day, with billing totals."
              primaryAction={{
                label: "Open Tracker",
                onClick: () => nav("/tracker"),
                icon: Timer,
              }}
            />
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
      {/* Biometric gate — first-time export explanation for both PDF and CSV */}
      <BiometricGateSheet
        open={exportGateOpen}
        onClose={() => { setExportGateOpen(false); setPendingGatedExport(null); }}
        feature="export"
        onResult={async (granted) => {
          const pe = pendingGatedExport;
          setPendingGatedExport(null);
          if (granted && pe) await doExport(pe.kind, pe.categoryIds, pe.scopeLabel);
        }}
      />
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
      {/* Per-row report-currency picker. Opens when user taps a category's
          currency chip; picking a code stores an override (or clears it
          when the chosen code matches the tracker currency). */}
      <CurrencyPickerSheet
        open={!!reportCurrencyTarget}
        onOpenChange={(o) => { if (!o) setReportCurrencyTarget(null); }}
        selected={reportCurrencyTarget ? getReportCurrency(reportCurrencyTarget.catId, reportCurrencyTarget.trackerCurrency) : "USD"}
        rates={rates}
        ratesLoading={ratesLoading}
        onSelect={(code) => {
          if (!reportCurrencyTarget) return;
          // If the picked code matches tracker currency, drop the override.
          // Otherwise store it. Either way, close the picker.
          const upper = code.toUpperCase();
          const trackerUpper = reportCurrencyTarget.trackerCurrency.toUpperCase();
          if (upper === trackerUpper) {
            clearCatOverride(reportCurrencyTarget.catId);
          } else {
            setCatOverride(reportCurrencyTarget.catId, upper, trackerUpper);
          }
          setReportCurrencyTarget(null);
        }}
      />
      {/* Pre-export gate when report currency differs from tracker for any
          in-scope category. */}
      <ReportCurrencyMismatchDialog
        open={mismatchDialogOpen}
        mismatches={mismatchList}
        onCancel={cancelExport}
        onExportAsIs={exportAsIs}
        onUpdatePaymentDetails={beginEditFlow}
      />
      {/* Sequential PaymentMethodFields sheet — one mismatched category at a
          time. Saving advances; skipping leaves the override in place and
          moves on. After the last one we fire the original export. */}
      <Sheet
        open={editDraft !== null}
        onOpenChange={(o) => { if (!o) { setEditDraft(null); setPendingExport(null); setMismatchList([]); } }}
      >
        <SheetContent
          side="bottom"
          className="rounded-t-[28px] border-border/45 bg-popover max-h-[90vh] flex flex-col p-0"
        >
          <SheetTitle className="sr-only">
            Update payment details
          </SheetTitle>
          <div className="flex-1 overflow-y-auto">
          {editDraft && mismatchList[editIdx] && (
            <>
              <div className="px-5 pt-6 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">
                  Step {editIdx + 1} of {mismatchList.length}
                </p>
                <h2 className="mt-1.5 font-display text-[20px] font-semibold tracking-tight">
                  Payment for {mismatchList[editIdx].catName}
                </h2>
                <p className="mt-1 text-[12.5px] text-secondary-fg/85 leading-relaxed">
                  Report shows{" "}
                  <span className="font-semibold text-foreground">{mismatchList[editIdx].reportCurrency}</span>{" "}
                  but tracker holds{" "}
                  <span className="font-semibold text-foreground">{mismatchList[editIdx].trackerCurrency}</span> details. Update below — or skip to keep the old account.
                </p>
              </div>
              <div className="px-5 pb-6 space-y-4">
                <PaymentMethodFields
                  value={editDraft}
                  onChange={(field, val) => setEditDraft((p) => (p ? { ...p, [field]: val } : p))}
                />
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={skipCurrentEdit}
                    className="flex-1 h-11 rounded-xl border border-border/45 bg-card/40 text-[12.5px] font-medium text-secondary-fg/90 hover:text-foreground transition-colors"
                  >
                    Skip this one
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveCurrentEdit()}
                    className="flex-[2] h-11 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold pressable shadow-[0_8px_22px_-12px_hsl(var(--primary)/0.55)]"
                  >
                    Save and continue
                  </button>
                </div>
              </div>
            </>
          )}
          </div>
        </SheetContent>
      </Sheet>
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
        className={`flex items-center gap-2 h-9 px-3 rounded-full border text-[13px] font-medium pressable transition-colors min-w-0 ${
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
