import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

import { BarChart3, ChevronDown, Download, FileText, ListFilter, ChevronRight, Timer, Pencil, Check, X, TrendingUp, MoreHorizontal, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/app/EmptyState";
import { FeatureHint } from "@/components/app/FeatureHint";
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
import { EntryStartSheet, EntryDeleteDialog, SessionNoteSheet, SessionTaskSheet, ReportsActionSheet, AdjustmentInfoSheet, type EditableEntry } from "@/components/app/EntryEditSheet";
import { TickingNumber } from "@/components/app/TickingNumber";
import { FitText } from "@/components/app/FitText";
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

/** "+1h 30m" / "−15m" from a signed seconds value (manual adjustment badge). */
const fmtSignedMin = (sec: number): string => {
  const mins = Math.round(Math.abs(sec) / 60);
  const sign = sec >= 0 ? "+" : "−";
  if (mins < 60) return `${sign}${mins}m`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return r ? `${sign}${h}h ${r}m` : `${sign}${h}h`;
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
      // Always show cents — earnings must read exactly the same here as on the
      // Tracker (e.g. $15.53, not a rounded $16). No ">=100 → whole" shortcut.
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
};


type CategoryGroup = {
  id: string;
  name: string;
  color: string;
  isDeleted: boolean;
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
  /** Per-rate breakdown for this period. Key = the rate each session was
   *  billed at (snapshot rate, in tracker `currency`); `0` = no rate. Lets the
   *  detail view group sessions under a labeled "$5/h", "$50/h" divider so a
   *  rate change is visible, while earnings stay snapshot-correct. */
  rateTiers: Map<number, { sec: number; earned: number; entries: RollingEntry[]; lastStart: number }>;
};

export default function Reports() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { isPro } = useEntitlement();
  // Categories already live in the TimeTrackerProvider — reading them from the
  // shared context avoids a Reports-only fetch on every tab switch.
  const { categories, allCatMap: contextAllCatMap, updateCategoryBilling, deleteEntry, updateEntryStart, updateEntryNote, updateEntryTaskTitle, renameCategory } = useTimeTracker();
  // Subscribing to elapsedSec keeps live totals (running timer in the active
  // category) ticking inside Reports without a per-tab Supabase query.
  useTimeTrackerElapsed();
  const reportsTabVisible = useTabVisible();

  // removed TOUR_REPORTS auto-start

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
  // Per-session edit (adjust start) + delete, and inline category rename.
  const [editEntry, setEditEntry] = useState<EditableEntry | null>(null);
  const [deleteEntryTarget, setDeleteEntryTarget] = useState<EditableEntry | null>(null);
  // Session being named/labelled (its note edited) via SessionNoteSheet.
  const [noteEntry, setNoteEntry] = useState<{ id: string; note: string; categoryName: string; categoryColor: string } | null>(null);
  const [taskEntry, setTaskEntry] = useState<{ id: string; taskTitle: string; categoryName?: string; categoryColor?: string } | null>(null);
  const [actionsEntry, setActionsEntry] = useState<EditableEntry & { note: string; taskTitle: string | null } | null>(null);
  // Read-only view of a session's manual-time-adjustment audit.
  const [reasonEntry, setReasonEntry] = useState<EditableEntry | null>(null);
  const [renamingCatId, setRenamingCatId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const toEditable = (e: RollingEntry, name?: string | null, color?: string | null): EditableEntry => ({
    id: e.id,
    startedAtMs: new Date(e.started_at).getTime(),
    endedAtMs: e.ended_at ? new Date(e.ended_at).getTime() : null,
    categoryName: name ?? null,
    categoryColor: color ?? null,
    note: e.note ?? null,
    adjustmentSeconds: e.adjustment_seconds ?? 0,
    adjustmentReason: e.adjustment_reason ?? null,
  });
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

  const queryClient = useQueryClient();

  // Tracks the current calendar date as a string. When focus or visibility
  // changes and the date has rolled over (app left open past midnight), we
  // update this key — which forces `range` to recompute with today's date
  // and evicts the rolling-entries cache so fresh data is fetched.
  const [todayKey, setTodayKey] = useState(() => todayDateStr());
  useEffect(() => {
    const check = () => {
      const current = todayDateStr();
      setTodayKey((prev) => {
        if (prev !== current) {
          void queryClient.invalidateQueries({ queryKey: rollingEntriesQueryKey(user?.id) });
          return current;
        }
        return prev;
      });
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [queryClient, user?.id]);

  const range = useMemo(() => periodRange(period, customFrom, customTo), [period, customFrom, customTo, todayKey]);

  const { data: rollingEntries = [] } = useQuery({
    queryKey: rollingEntriesQueryKey(user?.id),
    queryFn: () => fetchRollingEntries(user!.id),
    enabled: !!user?.id && reportsTabVisible,
    staleTime: 30_000,  // 30s so a tab switch shows fresh data without waiting 60s
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });

  // Task title is now snapshotted directly on time_entries.task_title at session
  // start, so it survives block deletion without any extra query.
  const titleFor = (e: { task_title?: string | null }) => e.task_title ?? null;

  const { data: paymentDetails = null } = useQuery({
    queryKey: ["billing-payment-details", user?.id],
    enabled: !!user?.id && isPro && reportsTabVisible,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await (supabase)
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

  // Use allCatMap from context (includes soft-deleted) so historical entries
  // still resolve to their original category name with "(Deleted)" label.
  const catMap = contextAllCatMap;

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
  const { totalSec, categoryGroups, perDay, perHour, earningsByCurrency } = useMemo(() => {
    const now = Date.now();
    let total = 0;
    const groups = new Map<string, CategoryGroup>();
    const dMap = new Map<string, number>();
    // Seconds tracked per hour-of-day (local), spread across the hours each
    // session actually spans — powers the "Rhythm / peak hours" chart view,
    // which is meaningful even on a single day of data.
    const hourSec = new Array(24).fill(0) as number[];
    // Accumulate earnings per snapshot currency (not per current category currency)
    // so that changing a category's currency never rebuckets historical earnings.
    const byCurrency = new Map<string, number>();
    for (const e of periodEntries) {
      const started = new Date(e.started_at).getTime();
      const ended = e.ended_at ? new Date(e.ended_at).getTime() : now;
      const s = Math.max(started, range.from.getTime());
      const en = Math.min(ended, range.to.getTime());
      const sec = Math.max(0, (en - s) / 1000);
      if (sec <= 0) continue;
      total += sec;

      // Spread this session across the local hour buckets it overlaps so a long
      // session is attributed accurately (not all to its start hour).
      // Pure arithmetic: avoid new Date() inside the hot loop (each session can
      // span multiple hours; new Date is slow on iOS JSC vs V8).
      let cur = s;
      while (cur < en) {
        // Floor to the start of the current local hour without Date allocation.
        const localOffset = new Date(cur).getTimezoneOffset() * 60_000;
        const hourStart = Math.floor((cur - localOffset) / 3_600_000) * 3_600_000 + localOffset;
        const hourEnd = hourStart + 3_600_000;
        const sliceEnd = Math.min(en, hourEnd);
        const h = Math.floor(((cur - localOffset) % 86_400_000) / 3_600_000);
        hourSec[h] += (sliceEnd - cur) / 1000;
        cur = sliceEnd;
      }
      const id = e.category_id || "uncategorized";
      const cat = (e.category_id ? catMap.get(e.category_id) : undefined) as
        | (typeof categories)[number]
        | undefined;
      // Use only the snapshot rate captured at session start. Changing the
      // category's current rate must never retroactively alter report totals.
      const rate = e.snapshot_hourly_rate;
      const earned = ((rate || 0) * sec) / 3600;

      // Bucket earnings under the snapshot currency (not the current category
      // currency) so the "Total Tracked → Estimated pay" total stays correct
      // after a currency change.
      if (earned > 0) {
        const entryCur = (e.snapshot_currency ?? cat?.currency ?? "USD").toUpperCase();
        byCurrency.set(entryCur, (byCurrency.get(entryCur) ?? 0) + earned);
      }

      let group = groups.get(id);
      if (!group) {
        const trackerCurrency = (e.snapshot_currency ?? cat?.currency ?? "USD").toUpperCase();
        group = {
          id,
          name: cat?.name ?? "Uncategorized",
          color: cat?.color ?? "hsl(var(--muted-foreground))",
          isDeleted: !!(cat?.deleted_at),
          currency: trackerCurrency,
          reportCurrency: getReportCurrency(id, trackerCurrency),
          hourlyRate: rate,
          sec: 0,
          earnings: 0,
          pct: 0,
          entries: [],
          rateTiers: new Map(),
        };
        groups.set(id, group);
      }
      group.sec += sec;
      group.earnings += earned;
      group.entries.push(e);

      // Fold the session into its rate tier (the rate it was actually billed
      // at) so the detail view can group sessions under a labeled rate divider.
      const tierKey = rate ?? 0;
      let tier = group.rateTiers.get(tierKey);
      if (!tier) {
        tier = { sec: 0, earned: 0, entries: [], lastStart: 0 };
        group.rateTiers.set(tierKey, tier);
      }
      tier.sec += sec;
      tier.earned += earned;
      tier.entries.push(e);
      tier.lastStart = Math.max(tier.lastStart, started);

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
        date: k,
        day: k.slice(5),
        hours: Number((sec / 3600).toFixed(2)),
      }));
    return {
      totalSec: total,
      categoryGroups: groupList,
      perDay,
      perHour: hourSec,
      earningsByCurrency: byCurrency,
    };
  }, [periodEntries, catMap, getReportCurrency]);

  // ── Earnings insight (week + month, Pro only) ────────────────────────────
  // Day 1: shows "Today so far" — no projection until there's a meaningful
  // baseline. Day 2+: daily average + projected period total, always adapting
  // to whatever was actually tracked (no stale minimum-day gate).
  const insight = useMemo(() => {
    if (period !== "month" && period !== "week") return null;
    if (!isPro) return null;
    if (earningsByCurrency.size === 0) return null;
    const hasRates = Object.keys(rates).length > 1;
    const earnedSoFar = Array.from(earningsByCurrency.entries()).reduce(
      (sum, [from, amount]) =>
        sum + (hasRates ? convertCurrency(amount, from, displayCurrency, rates) : amount),
      0,
    );
    if (earnedSoFar <= 0) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fromDay = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
    // Fully completed days before today (today is still in progress).
    const completedDays = Math.max(0, Math.floor((today.getTime() - fromDay.getTime()) / 86_400_000));
    const periodDays = period === "week"
      ? 7
      : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remainingDays = Math.max(0, periodDays - completedDays - 1);
    if (completedDays === 0) {
      // First day of the period — show earnings to date, no projection yet.
      return { type: "today" as const, earnedSoFar, remainingDays, periodDays, isWeek: period === "week" };
    }
    const elapsedDays = completedDays + 1; // completed days + today
    const dailyAvg = earnedSoFar / elapsedDays;
    const projectedTotal = earnedSoFar + dailyAvg * remainingDays;
    return {
      type: "trend" as const,
      earnedSoFar,
      dailyAvg,
      projectedTotal,
      remainingDays,
      periodDays,
      isWeek: period === "week",
      totalSec,
    };
  // range.from is a new Date object every render — use its timestamp to avoid
  // spurious recomputes of insight when the date hasn't actually changed.
  }, [period, isPro, earningsByCurrency, displayCurrency, rates, range.from.getTime(), totalSec]);

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
        const started = new Date(e.started_at).getTime();
        const ended = e.ended_at ? new Date(e.ended_at).getTime() : Date.now();
        const s = new Date(Math.max(started, range.from.getTime()));
        const en = new Date(Math.min(ended, range.to.getTime()));
        const cat = e.category_id ? catMap.get(e.category_id) : undefined;
        const durationMin = Math.max(0, Math.round((en.getTime() - s.getTime()) / 60000));
        let hourlyRate = e.snapshot_hourly_rate;
        if (hourlyRate === null && cat?.hourly_rate != null) {
          if (!cat.rate_set_at || started >= new Date(cat.rate_set_at).getTime()) {
            hourlyRate = cat.hourly_rate;
          }
        }
        const trackerCur = (e.snapshot_currency || cat?.currency || "USD").toUpperCase();
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
          taskTitle: titleFor(e),
          durationMin,
          currency: reportCur,
          hourlyRate: displayedRate,
          earnings,
          note: e.note ?? null,
          manual: e.source === "manual_add",
          adjustmentReason: e.adjustment_reason ?? null,
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
    } catch (e) {
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
    } catch (e) {
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
          className="reports-period-tabs shrink-0 mb-5 relative isolate grid grid-cols-4 p-1 rounded-2xl surface-soft border border-soft self-start w-full max-w-[280px]"
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
          categories={categories}
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
                  className="hero-glass border border-border/65 rounded-2xl px-4 py-3 text-left pressable hover:border-primary/30 transition-colors min-w-0"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/65 mb-1">From</p>
                  <p className="text-[15px] font-semibold text-foreground/95 truncate tabular-nums">
                    {formatChipDate(customFrom)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setDateSheetOpen(true)}
                  className="hero-glass border border-border/65 rounded-2xl px-4 py-3 text-left pressable hover:border-primary/30 transition-colors min-w-0"
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
          <section data-tour="reports-summary" className="rounded-[28px] hero-glass border px-5 pt-5 pb-4 deep-float" style={{ animationDelay: '0.4s' }}>
            {(() => {
              const hasPay = earningsByCurrency.size > 0;
              const hasRates = Object.keys(rates).length > 1;
              const converted = hasPay
                ? Array.from(earningsByCurrency.entries()).reduce(
                    (sum, [from, amount]) =>
                      sum + (hasRates ? convertCurrency(amount, from, displayCurrency, rates) : amount),
                    0,
                  )
                : 0;
              const totalStr = fmtHM(totalSec);
              const payStr = fmtMoney(converted, displayCurrency);
              return (
                <>
                  {/* Time (content-sized) | Money (remainder). Labels carry NO chip
                      now — the display-currency selector moved to the footer — so
                      "Estimated pay" can never clip, and FitText keeps any amount
                      on one line regardless of magnitude. */}
                  <div className={hasPay ? "grid grid-cols-[auto_1fr] gap-x-4" : ""}>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/70 truncate">
                        Total tracked
                      </p>
                      <FitText
                        max={36}
                        min={22}
                        className="mt-1.5 font-display font-semibold tabular-nums text-foreground"
                        watch={totalStr}
                      >
                        <TickingNumber value={totalStr} />
                      </FitText>
                    </div>

                    {hasPay && (
                      <div className="min-w-0 border-l border-border/60 pl-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/70 truncate">
                          Estimated pay
                        </p>
                        <FitText
                          max={30}
                          min={16}
                          className={`mt-1.5 font-display font-semibold tabular-nums text-success transition-opacity ${ratesLoading && !hasRates ? "opacity-40" : ""}`}
                          watch={payStr}
                        >
                          <TickingNumber value={payStr} />
                        </FitText>
                      </div>
                    )}
                  </div>

                  {/* Footer: period range (left) + display-currency selector (right) */}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-[12px] text-secondary-fg/80 truncate">{range.label}</p>
                    {hasPay && (
                      <button
                        type="button"
                        onClick={() => setCurrencyPickerOpen(true)}
                        aria-label="Change display currency"
                        className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-bold text-success border border-success/30 pressable shrink-0"
                      >
                        {displayCurrency}
                        <ChevronRight className="h-3 w-3 opacity-80" />
                      </button>
                    )}
                  </div>

                  {/* ── Earnings insight ── day 1 = "Today so far"; day 2+ = daily
                       average + period projection. Amber keeps it visually distinct
                       from the green "Estimated pay" total above. */}
                  {insight && (
                    <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid hsl(38 92% 52% / 0.18)" }}>
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-[9px] flex items-center justify-center shrink-0" style={{ background: "hsl(38 92% 52% / 0.13)", border: "1px solid hsl(38 92% 52% / 0.26)" }}>
                          <TrendingUp style={{ width: 14, height: 14, color: "hsl(38 92% 52%)" }} strokeWidth={2.5} />
                        </div>
                        {insight.type === "today" ? (
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/55">Today so far</p>
                            <FitText max={18} min={13} className="mt-0.5 font-display font-semibold tabular-nums" style={{ color: "hsl(38 92% 52%)" }} watch={fmtMoney(insight.earnedSoFar, displayCurrency)}>
                              {fmtMoney(insight.earnedSoFar, displayCurrency)}
                            </FitText>
                          </div>
                        ) : insight.remainingDays === 0 ? (
                          // Last day — show effective hourly rate for the period
                          // (the only number not shown anywhere else).
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/55">
                              Effective rate · {insight.isWeek ? "this week" : "this month"}
                            </p>
                            <FitText
                              max={19}
                              min={13}
                              className="mt-0.5 font-display font-semibold tabular-nums"
                              style={{ color: "hsl(38 92% 52%)" }}
                              watch={insight.totalSec > 0 ? `${fmtMoney(insight.earnedSoFar / (insight.totalSec / 3600), displayCurrency)}/hr` : ""}
                            >
                              {insight.totalSec > 0
                                ? `${fmtMoney(insight.earnedSoFar / (insight.totalSec / 3600), displayCurrency)}/hr`
                                : "—"}
                            </FitText>
                            {insight.totalSec > 0 && (
                              <p className="text-[10px] text-secondary-fg/50 tabular-nums mt-0.5">
                                across {fmtHM(insight.totalSec)} tracked
                              </p>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/55">
                                avg {fmtMoney(insight.dailyAvg, displayCurrency)}/day · by {insight.isWeek ? "week" : "month"} end
                              </p>
                              <FitText
                                max={19}
                                min={13}
                                className="mt-0.5 font-display font-semibold tabular-nums"
                                style={{ color: "hsl(38 92% 52%)" }}
                                watch={`≈ ${fmtMoney(insight.projectedTotal, displayCurrency)}`}
                              >
                                ≈ {fmtMoney(insight.projectedTotal, displayCurrency)}
                              </FitText>
                            </div>
                            <div className="text-right shrink-0 pl-1">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-secondary-fg/50">left</p>
                              <p className="text-[13px] font-semibold tabular-nums text-foreground/80 mt-0.5">{insight.remainingDays}d</p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </section>

          {categoryGroups.length > 0 ? (
            <section className="hero-glass border border-border/65 rounded-[28px] p-4">
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
                  // Header shows the category's CURRENT rate (live — updates the
                  // moment it's changed in Tracker). Earnings stay snapshot-correct.
                  const liveCat = group.id === "uncategorized" ? undefined : catMap.get(group.id);
                  const currentRate = liveCat?.hourly_rate ?? null;
                  const currentCurrency = liveCat?.currency || group.currency;
                  // "Mixed rate" only when the period contains sessions that were
                  // ACTUALLY TRACKED at 2+ different positive rates. Changing the
                  // current rate without tracking again must NOT trigger "Mixed rate".
                  const positiveTierRates = [...group.rateTiers.keys()].filter(r => r > 0);
                  const showTiers = positiveTierRates.length > 1;
                  // Header rate: current if set, else the most-recent POSITIVE tier.
                  const headerRate =
                    currentRate ??
                    [...group.rateTiers.entries()]
                      .filter(([r]) => r > 0)
                      .sort((a, b) => b[1].lastStart - a[1].lastStart)[0]?.[0] ??
                    null;
                  return (
                    <li key={group.id} className="reports-category-card overflow-hidden rounded-2xl border border-soft/50 surface-soft card-volumetric">
                      <button
                        type="button"
                        onClick={() => toggleCategoryExpanded(group.id)}
                        className="relative grid w-full items-start gap-x-2.5 pl-5 pr-3 py-3.5 text-left"
                        style={{ WebkitTapHighlightColor: "transparent", gridTemplateColumns: "1fr 80px 20px" }}
                        aria-expanded={isOpen}
                      >
                        {/* Category-colour edge — 3 px stripe at rest; stretches to a
                            full-width tinted backdrop when the card is open so the
                            accent colour follows and hugs the card's rounded corners. */}
                        <span
                          aria-hidden
                          className="absolute top-0 bottom-0 left-0"
                          style={{
                            background: group.color,
                            width: isOpen ? "100%" : "3px",
                            opacity: isOpen ? 0.12 : 1,
                            borderRadius: isOpen ? "16px 16px 0 0" : "0 9999px 9999px 0",
                            // Open: width expands first (bloom), opacity fades after 80ms delay
                            // so stripe is vivid for a beat before settling to the tint.
                            // Close: opacity snaps back to vivid first, then width collapses.
                            transition: isOpen
                              ? "width 580ms cubic-bezier(0.32, 0.72, 0, 1), opacity 480ms cubic-bezier(0.4, 0, 0.2, 1) 80ms, border-radius 480ms cubic-bezier(0.4, 0, 0.2, 1)"
                              : "width 420ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms cubic-bezier(0.4, 0, 0.2, 1), border-radius 360ms cubic-bezier(0.4, 0, 0.2, 1) 80ms",
                          }}
                        />

                        {/* col 1 — name + metadata */}
                        <div className="min-w-0">
                          <span className="block truncate text-[14.5px] font-semibold text-foreground leading-snug">
                            {group.name}
                            {group.isDeleted && (
                              <span className="text-[11px] font-medium text-destructive/70"> (Deleted)</span>
                            )}
                          </span>
                          <span className="reports-cat-meta mt-1 block truncate text-[11.5px] text-secondary-fg/60 tabular-nums">
                            {group.earnings > 0 ? `${fmtHM(group.sec)} · ` : ""}{group.entries.length} session{group.entries.length === 1 ? "" : "s"}
                          </span>
                        </div>

                        {/* col 2 — fixed 80px right column so the decimal point lines
                            up identically across every category card regardless of amount.
                            Green only on the category total; rate hint stays muted. */}
                        <div className="flex flex-col items-end min-w-0">
                          {group.earnings > 0 ? (() => {
                            const shouldConvert = group.reportCurrency !== group.currency;
                            const displayedAmount = shouldConvert
                              ? convertCurrency(group.earnings, group.currency, group.reportCurrency, rates)
                              : group.earnings;
                            const moneyStr = fmtMoney(displayedAmount, group.reportCurrency);
                            return (
                              <>
                                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/45 mb-0.5">Total</span>
                                <FitText
                                  max={14}
                                  min={10.5}
                                  align="right"
                                  className="font-semibold tabular-nums text-success leading-snug w-full"
                                  watch={moneyStr}
                                >
                                  {moneyStr}
                                </FitText>
                                {(showTiers || (headerRate != null && headerRate > 0)) && (
                                  <span className="mt-0.5 text-[10px] tabular-nums text-secondary-fg/50 overflow-hidden text-ellipsis whitespace-nowrap max-w-full">
                                    {showTiers ? "Mixed" : `${fmtMoney(headerRate, currentCurrency)}/h`}
                                  </span>
                                )}
                              </>
                            );
                          })() : (
                            <span className="reports-cat-total text-[14px] font-semibold tabular-nums text-foreground/90 text-right">
                              {fmtHM(group.sec)}
                            </span>
                          )}
                        </div>

                        {/* col 3 — chevron, self-centered */}
                        <ChevronDown
                          className={`self-center h-4 w-4 text-secondary-fg/45 ${isOpen ? "rotate-180" : ""}`}
                          style={{
                            transitionProperty: "transform",
                            transitionDuration: isOpen ? "520ms" : "380ms",
                            transitionTimingFunction: isOpen
                              ? "cubic-bezier(0.34, 1.4, 0.64, 1)"
                              : "cubic-bezier(0.4, 0, 0.2, 1)",
                          }}
                        />
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            key="cat-detail"
                            initial="collapsed"
                            animate="open"
                            exit="collapsed"
                            variants={{
                              open: {
                                height: "auto",
                                opacity: 1,
                                transition: {
                                  height: { type: "spring", damping: 28, stiffness: 260, mass: 0.8 },
                                  opacity: { duration: 0.28, ease: [0.4, 0, 0.2, 1] },
                                },
                              },
                              collapsed: {
                                height: 0,
                                opacity: 0,
                                transition: {
                                  height: { type: "tween", duration: 0.40, ease: [0.4, 0, 0.2, 1] },
                                  opacity: { duration: 0.18, ease: "easeIn" },
                                },
                              },
                            }}
                            style={{ overflow: "hidden" }}
                          >
                            <div className="border-t border-soft">
                              {(() => {
                                // Convert a tracker-currency amount to the report currency for display.
                                const toDisplay = (amt: number) =>
                                  group.reportCurrency !== group.currency
                                    ? convertCurrency(amt, group.currency, group.reportCurrency, rates)
                                    : amt;
                                // One session row — shared by flat and grouped views.
                                const renderSession = (e: RollingEntry, isLast: boolean) => {
                                  const started = new Date(e.started_at).getTime();
                                  const ended = e.ended_at ? new Date(e.ended_at).getTime() : Date.now();
                                  const s = new Date(Math.max(started, range.from.getTime()));
                                  const en = new Date(Math.min(ended, range.to.getTime()));
                                  const sec = Math.max(0, (en.getTime() - s.getTime()) / 1000);
                                  const rate = e.snapshot_hourly_rate;
                                  const earned = ((rate || 0) * sec) / 3600;
                                  const taskTitle = titleFor(e);
                                  const dateStr = s.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                                  const timeStr = `${s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${en.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                                  return (
                                    <li
                                      key={e.id}
                                      data-hint="reports-session"
                                      className={`flex items-start gap-3 py-3 px-4 ${isLast ? "" : "border-b border-border/90"}`}
                                    >
                                      {/* Left: the session's name. Priority:
                                          planned task title → user's session note
                                          (set in the tracker / here) → the date.
                                          No "No title" placeholder. */}
                                      <div className="min-w-0 flex-1">
                                        {taskTitle ? (
                                          <>
                                            <p className="truncate text-[12.5px] font-medium text-foreground/85">{taskTitle}</p>
                                            <p className="mt-0.5 text-[11px] text-secondary-fg/55 tabular-nums">
                                              {dateStr} · {timeStr}
                                            </p>
                                          </>
                                        ) : e.note ? (
                                          <>
                                            <p className="truncate text-[12.5px] font-medium text-foreground/85">{e.note}</p>
                                            <p className="mt-0.5 text-[11px] text-secondary-fg/55 tabular-nums">
                                              {dateStr} · {timeStr}
                                            </p>
                                          </>
                                        ) : (
                                          <>
                                            <p className="text-[12.5px] font-semibold text-foreground/80 tabular-nums">{dateStr}</p>
                                            <p className="mt-0.5 text-[11px] text-secondary-fg/55 tabular-nums">{timeStr}</p>
                                          </>
                                        )}
                                        {/* If a planned task also carries a note, show it under the title. */}
                                        {e.note && taskTitle && (
                                          <p className="mt-0.5 text-[11.5px] text-secondary-fg/65 italic leading-relaxed line-clamp-2">{e.note}</p>
                                        )}
                                        {/* Manual time adjustment — colored badge, tap to view the reason. */}
                                        {(e.adjustment_seconds ?? 0) !== 0 && (e.adjustment_reason ?? "").trim() && (
                                          <button
                                            type="button"
                                            onClick={() => setReasonEntry(toEditable(e, group.name, group.color))}
                                            className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-amber-500/12 border border-amber-500/20 pressable transition-colors hover:bg-amber-500/[0.18]"
                                          >
                                            <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" strokeWidth={2.4} />
                                            <span className="text-[10.5px] font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                                              {fmtSignedMin(e.adjustment_seconds ?? 0)} manual
                                            </span>
                                          </button>
                                        )}
                                      </div>
                                      <div className="flex flex-col justify-center shrink-0">
                                        <div className="flex items-center gap-1.5">
                                          <div className="w-[70px] text-left">
                                            <p className="text-[11.5px] font-medium tabular-nums text-secondary-fg/70">
                                              {fmtHM(sec)}
                                            </p>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => setActionsEntry({ ...toEditable(e, group.name, group.color), note: e.note ?? "", taskTitle: taskTitle })}
                                            className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-xl text-secondary-fg/40 hover:text-foreground hover:bg-foreground/[0.06] pressable transition-colors -mr-2"
                                            aria-label="More actions"
                                          >
                                            <MoreHorizontal className="h-4 w-4" />
                                          </button>
                                        </div>
                                        {earned > 0 && (
                                          <div className="flex items-center gap-1.5 mt-0.5">
                                            <div className="w-[85px] text-left">
                                              <FitText
                                                max={12.5}
                                                min={10}
                                                align="left"
                                                className="font-bold tabular-nums text-foreground/95"
                                                watch={fmtMoney(toDisplay(earned), group.reportCurrency)}
                                              >
                                                {fmtMoney(toDisplay(earned), group.reportCurrency)}
                                              </FitText>
                                            </div>
                                            <div className="w-8 shrink-0 -mr-2" aria-hidden="true" />
                                          </div>
                                        )}
                                      </div>
                                    </li>
                                  );
                                };

                                // Single rate — sessions in one category-accented card
                                // (matches the multi-rate tiers; no flat grey wash).
                                const tiers = [...group.rateTiers.entries()].sort(
                                  (a, b) => b[1].lastStart - a[1].lastStart,
                                );
                                const accentBorder = `color-mix(in srgb, ${group.color} 64%, transparent)`;
                                const accentDivider = `color-mix(in srgb, ${group.color} 65%, transparent)`;

                                return (
                                  <div className="px-3 py-3">
                                    <div
                                      className="reports-tier-card rounded-[16px] overflow-hidden bg-card/60"
                                      style={{ border: `1px solid ${accentBorder}` }}
                                    >
                                      {tiers.map(([tierRate, tier], i) => {
                                        const rateStr = tierRate > 0 ? `${fmtMoney(toDisplay(tierRate), group.reportCurrency)}/h` : "No rate";
                                        return (
                                          <div key={tierRate} style={i > 0 ? { borderTop: `1px solid ${accentDivider}` } : undefined}>
                                            {showTiers && (
                                              <div
                                                className="px-4 py-2 flex items-center gap-2"
                                                style={{ borderBottom: `1px solid ${accentDivider}` }}
                                              >
                                                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-secondary-fg/55">Rate</span>
                                                <span className="text-[11.5px] font-bold tabular-nums text-foreground/85 truncate">{rateStr}</span>
                                              </div>
                                            )}
                                            <ul className="flex flex-col">
                                              {tier.entries.map((e, idx) => renderSession(e, idx === tier.entries.length - 1))}
                                            </ul>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* ── Footer: Controls & Export ── */}
                              <div className="border-t border-soft bg-foreground/[0.02] mt-auto">
                                {group.id !== "uncategorized" && (
                                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-soft/50">
                                    {renamingCatId === group.id ? (
                                      <div className="flex items-center gap-2 w-full">
                                        <input
                                          autoFocus
                                          value={renameDraft}
                                          onChange={(ev) => setRenameDraft(ev.target.value)}
                                          onKeyDown={(ev) => {
                                            if (ev.key === "Enter") {
                                              const t = renameDraft.trim();
                                              if (t && t !== group.name) void renameCategory(group.id, t);
                                              setRenamingCatId(null);
                                            }
                                            if (ev.key === "Escape") setRenamingCatId(null);
                                          }}
                                          className="flex-1 min-w-0 h-8 rounded-xl border border-primary/40 bg-card/60 px-3 text-[12px] font-medium outline-none focus:border-primary/70 transition-colors"
                                          aria-label="Category name"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const t = renameDraft.trim();
                                            if (t && t !== group.name) void renameCategory(group.id, t);
                                            setRenamingCatId(null);
                                          }}
                                          className="h-8 w-8 rounded-xl bg-primary/90 flex items-center justify-center text-primary-foreground pressable shrink-0"
                                        >
                                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setRenamingCatId(null)}
                                          className="h-8 w-8 rounded-xl border border-border/70 bg-card/40 flex items-center justify-center text-secondary-fg pressable shrink-0"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-4 w-full">
                                        {!group.isDeleted ? (
                                          <button
                                            type="button"
                                            onClick={() => { setRenameDraft(group.name); setRenamingCatId(group.id); }}
                                            className="min-w-0 flex items-center gap-2 text-left text-secondary-fg/60 hover:text-foreground pressable transition-colors flex-1"
                                          >
                                            <Pencil className="h-3 w-3 shrink-0" />
                                            <span className="text-[11.5px] font-medium truncate">Rename category</span>
                                          </button>
                                        ) : (
                                          <span className="min-w-0 text-[11.5px] font-medium text-secondary-fg/45 truncate flex-1">Deleted category</span>
                                        )}
                                        <div className="flex items-center gap-2 shrink-0">
                                          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-secondary-fg/45">Currency</span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setReportCurrencyTarget({ catId: group.id, trackerCurrency: group.currency });
                                            }}
                                            aria-label={`Change report currency for ${group.name}`}
                                            className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-semibold tabular-nums tracking-[0.04em] pressable transition-[transform,box-shadow,background-color] duration-150 active:scale-[0.96]"
                                            style={
                                              group.reportCurrency !== group.currency
                                                ? {
                                                    background: "linear-gradient(180deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--primary) / 0.08) 100%)",
                                                    boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.12), 0 0 0 1px hsl(var(--primary) / 0.40)",
                                                    color: "hsl(var(--primary))",
                                                  }
                                                : {
                                                    background: "hsl(var(--foreground) / 0.05)",
                                                    boxShadow: "inset 0 0 0 1px hsl(var(--border) / 0.40)",
                                                    color: "hsl(var(--foreground) / 0.7)",
                                                  }
                                            }
                                          >
                                            {group.reportCurrency}
                                            <ChevronDown className="h-2.5 w-2.5 opacity-60" />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="grid grid-cols-2 gap-2 px-4 py-3">
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onExport("pdf", [group.id], group.name); }}
                                    className="h-9 rounded-xl border border-primary/45 bg-primary/[0.14] hover:bg-primary/[0.20] text-[11px] font-semibold text-primary pressable flex items-center justify-center gap-1.5 transition-colors"
                                  >
                                    <FileText className="h-3 w-3" /> PDF
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onExport("csv", [group.id], group.name); }}
                                    className="h-9 rounded-xl border border-success/40 bg-success/[0.12] hover:bg-success/[0.18] text-[11px] font-semibold text-success pressable flex items-center justify-center gap-1.5 transition-colors"
                                  >
                                    <Download className="h-3 w-3" /> CSV
                                  </button>
                                </div>
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
                onClick: () => nav("/home"),
                icon: Timer,
              }}
            />
          )}

          {period !== "day" && totalSec > 0 && (
            <section className="hero-glass border border-border/65 rounded-[28px] p-4">
              <Suspense fallback={<div className="h-[196px] w-full rounded-xl shimmer opacity-60" />}>
                <ReportsTrendChart perDay={perDay} perHour={perHour} totalSec={totalSec} />
              </Suspense>
            </section>
          )}

          {/* In-context coachmark: session rows are tappable for editing — not
              obvious. Anchors to the first session; auto-hidden when none exist. */}
          <FeatureHint
            id="reports-session-edit"
            selector="[data-hint='reports-session']"
            title="Sessions are editable"
            placement="top"
          >
            Tap any session to fix its start time, delete it, or move it to another category.
          </FeatureHint>

          <FeatureHint
            id="reports-export"
            selector="[data-tour='reports-export']"
            title="Hand it to a client"
            placement="top"
          >
            Export the period — or one category — as a billing-ready PDF or CSV, with rates and totals already worked out.
          </FeatureHint>

          <section data-tour="reports-export" className="space-y-3 pt-2">
            {!isPro && (
              <p className="text-[11px] text-secondary-fg/70 px-0.5">
                PDF and CSV export with billing details is included with Pro.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {/* PDF — primary accent card */}
              <button
                type="button"
                onClick={() => onExport("pdf")}
                className="group relative h-[62px] rounded-2xl border border-primary/55 bg-primary/[0.16] hover:bg-primary/[0.22] pressable flex flex-col items-center justify-center gap-0.5 overflow-hidden transition-colors"
              >
                {/* subtle top glow */}
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                  <FileText className="h-[14px] w-[14px]" />
                  {isPro ? "Export PDF" : "Export PDF"}
                  {!isPro && <BarChart3 className="h-[11px] w-[11px] opacity-60" />}
                </span>
                <span className="text-[10px] font-medium text-primary/60">All categories</span>
              </button>

              {/* CSV — success-tinted card */}
              <button
                type="button"
                onClick={() => onExport("csv")}
                className="group relative h-[62px] rounded-2xl border border-success/45 bg-success/[0.13] hover:bg-success/[0.19] pressable flex flex-col items-center justify-center gap-0.5 overflow-hidden transition-colors"
              >
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-success/40 to-transparent" />
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-success">
                  <Download className="h-[14px] w-[14px]" />
                  {isPro ? "Export CSV" : "Export CSV"}
                  {!isPro && <BarChart3 className="h-[11px] w-[11px] opacity-60" />}
                </span>
                <span className="text-[10px] font-medium text-success/60">All categories</span>
              </button>
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
        categories={categories}
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
          className="rounded-t-[28px] border-border/75 bg-popover max-h-[90vh] flex flex-col p-0"
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
                    className="flex-1 h-11 rounded-xl border border-border/75 bg-card/40 text-[12.5px] font-medium text-secondary-fg/90 hover:text-foreground transition-colors"
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

      {/* Per-session edit (adjust start) + delete — shared with the Track screen
          via the same time-entries cache, so changes here reflect there too. */}
      <EntryStartSheet
        open={!!editEntry}
        entry={editEntry}
        onClose={() => setEditEntry(null)}
        onCommit={(d, reason) => {
          if (!editEntry) return;
          // Reason is stored as an immutable audit field, NOT merged into the
          // editable note — so it can't be deleted while the added time stays.
          void updateEntryStart(editEntry.id, d, reason);
        }}
      />
      <EntryDeleteDialog
        open={!!deleteEntryTarget}
        onOpenChange={(o) => { if (!o) setDeleteEntryTarget(null); }}
        entry={deleteEntryTarget}
        onConfirm={() => { if (deleteEntryTarget) void deleteEntry(deleteEntryTarget.id); setDeleteEntryTarget(null); }}
      />
      {/* Name the task -> task_title */}
      <SessionTaskSheet
        open={!!taskEntry}
        onClose={() => setTaskEntry(null)}
        initialTitle={taskEntry?.taskTitle ?? ""}
        categoryName={taskEntry?.categoryName}
        categoryColor={taskEntry?.categoryColor}
        onSave={(taskTitle) => { if (taskEntry) void updateEntryTaskTitle(taskEntry.id, taskTitle); }}
      />
      {/* Name / re-label a past session notes — writes to time_entries.note. */}
      <SessionNoteSheet
        open={!!noteEntry}
        onClose={() => setNoteEntry(null)}
        initialNote={noteEntry?.note ?? ""}
        categoryName={noteEntry?.categoryName}
        categoryColor={noteEntry?.categoryColor}
        onSave={(note) => { if (noteEntry) void updateEntryNote(noteEntry.id, note); }}
      />
      <ReportsActionSheet
        open={!!actionsEntry}
        onClose={() => setActionsEntry(null)}
        entry={actionsEntry}
        onEditTask={() => {
          if (actionsEntry) setTaskEntry({ id: actionsEntry.id, taskTitle: actionsEntry.taskTitle || "", categoryName: actionsEntry.categoryName ?? "", categoryColor: actionsEntry.categoryColor ?? "" });
        }}
        onEditNote={() => {
          if (actionsEntry) setNoteEntry({ id: actionsEntry.id, note: actionsEntry.note, categoryName: actionsEntry.categoryName ?? "", categoryColor: actionsEntry.categoryColor ?? "" });
        }}
        onEditTime={() => {
          if (actionsEntry) setEditEntry(actionsEntry);
        }}
        onViewReason={() => {
          if (actionsEntry) setReasonEntry(actionsEntry);
        }}
        onDelete={() => {
          if (actionsEntry) setDeleteEntryTarget(actionsEntry);
        }}
      />
      <AdjustmentInfoSheet
        open={!!reasonEntry}
        onClose={() => setReasonEntry(null)}
        entry={reasonEntry}
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
        className={`flex items-center gap-2 h-9 px-3 rounded-full border text-[13px] font-medium pressable transition-colors min-w-0 ${
          isFiltered
            ? "border-primary/40 bg-primary/[0.08] text-foreground/95"
            : "border-border/70 bg-foreground/[0.03] text-foreground/85 hover:bg-foreground/[0.06]"
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
