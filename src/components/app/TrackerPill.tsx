import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Play, Pause, Plus, Check, Trash2, ChevronLeft, ChevronRight, Download, ChevronDown, Lock, Pencil, X, Clock, ListTodo, Wallet } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import { categoryBillingToDraft } from "@/lib/categoryBilling";
import { useTimeTracker, getElapsedSec, fmtHMS, fmtHM, TimeCategory } from "@/hooks/useTimeTracker";
import { LiveElapsed } from "@/components/app/LiveElapsed";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
// jspdf + jspdf-autotable + their transitive html2canvas total ~150 KB
// gzip. Pulling them statically into TrackerPill puts the whole printer
// in the main route bundle even though export-as-PDF is rare. They're
// dynamically imported inside `exportPDF` instead — see below.
import { useEntitlement } from "@/hooks/useEntitlement";
import { Block, isUserTask, todayDateStr } from "@/lib/daydraft";
import { fetchPlanDashboard, planDashboardQueryKey } from "@/lib/planQueries";
import { fetchRollingEntries, rollingEntriesQueryKey } from "@/lib/timeEntriesQuery";
import { parseHourlyRate } from "@/lib/rateInput";
import { triggerDownload } from "@/lib/reportExport";
import { useTabVisible } from "@/components/app/PersistentTabs";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { EntryStartSheet, EntryDeleteDialog, type EditableEntry } from "@/components/app/EntryEditSheet";
import { PaymentMethodFields, type PaymentFieldsValue } from "@/components/app/PaymentMethodFields";
import { verifyBiometric, getGatePref } from "@/lib/biometricGate";
import { BiometricGateSheet } from "@/components/app/BiometricGateSheet";
import { haptics } from "@/lib/haptics";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Entry = {
  id: string;
  category_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  block_id?: string | null;
};

type PaymentDetailsDraft = {
  currency: string;
  payment_method: string;
  display_name: string;
  bank_name: string;
  iban: string;
  crypto_network: string;
  crypto_wallet: string;
  payment_link: string;
  notes: string;
};

const emptyPaymentDetails: PaymentDetailsDraft = {
  currency: "USD",
  payment_method: "",
  display_name: "",
  bank_name: "",
  iban: "",
  crypto_network: "",
  crypto_wallet: "",
  payment_link: "",
  notes: "",
};

type Tab = "today" | "week" | "month";
const TABS: Tab[] = ["today", "week", "month"];

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
/** Calendar grid is Monday-first — match header labels to columns. */
const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const hhmmToMin = (hhmm: string) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};
const fmtMoney = (amount: number, currency = "USD") => {
  const safeCurrency = currency?.trim().toUpperCase() || "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: safeCurrency,
      // Always show cents (e.g. $15.53, $120.00) — never round earnings to whole.
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${safeCurrency} ${amount.toFixed(2)}`;
  }
};
/** True when a category has any sensitive payout data worth gating behind a
 *  biometric check (an hourly rate alone is not sensitive). */
function categoryHasSavedBilling(c: TimeCategory): boolean {
  return !!(
    c.payment_method ||
    c.billing_iban ||
    c.billing_crypto_wallet ||
    c.billing_display_name ||
    c.billing_bank_name ||
    c.billing_payment_link ||
    c.billing_notes
  );
}

function clipDuration(e: Entry, dayStart: number, dayEnd: number, now: number) {
  const s = new Date(e.started_at).getTime();
  const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
  const a = Math.max(s, dayStart);
  const b = Math.min(en, dayEnd);
  return Math.max(0, (b - a) / 1000);
}

/**
 * Pre-parsed entry shape — avoids the `new Date(...).getTime()` call inside
 * the month aggregation loop (was firing 31 days × N entries × every
 * render). For a heavy user with ~500 entries in the rolling 60-day window
 * that's ~15k Date constructors per render of the month view; the parsed
 * form drops it to N once per entries-change.
 */
type ParsedEntry = {
  id: string;
  category_id: string | null;
  startMs: number;
  endMs: number | null; // null = "still running" — resolve to `now` at the call site
  note: string | null;
  block_id?: string | null;
  // Rate snapshot captured at session start — use this, not the current category
  // rate, so changing a rate never retroactively alters historical earnings.
  snapshotRate: number | null;
  snapshotCurrency: string | null;
};

function clipParsed(p: ParsedEntry, dayStart: number, dayEnd: number, now: number): number {
  const en = p.endMs ?? now;
  const a = p.startMs > dayStart ? p.startMs : dayStart;
  const b = en < dayEnd ? en : dayEnd;
  return b > a ? (b - a) / 1000 : 0;
}

/**
 * Inner tracker UI — used by both the standalone /tracker page (TrackerView)
 * and the legacy bottom sheet (TrackerSheet). The tab bar now navigates to
 * /tracker, so the sheet is no longer mounted from the shell, but we keep
 * it exported for any old call sites until they're cleaned up.
 */
function TrackerInner({ embedded = false, onClose }: { embedded?: boolean; onClose?: () => void }) {
  const { user } = useAuth();
  const { active, categories, start, stop, switchCategory, deleteCategory, renameCategory, updateCategoryRate, resetRateSetAt, updateCategoryBilling, addCategory, addManualEntry, deleteEntry, updateEntryStart, todayTotalSec } = useTimeTracker();
  // todayTotalSec re-derives once a minute via the provider; no need to
  // subscribe to the elapsed heartbeat here. The big HH:MM:SS digits below
  // are rendered via <LiveElapsed>, which writes to the DOM directly and
  // never re-renders this component.
  const { isPro } = useEntitlement();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  // Saved payment details are gated behind a fresh biometric check. This flips
  // true once the user verifies (or on devices that can't verify), per edit.
  const [billingRevealed, setBillingRevealed] = useState(false);
  const [billingUnlocking, setBillingUnlocking] = useState(false);
  const [billingGateOpen, setBillingGateOpen] = useState(false);
  const [exportGateOpen, setExportGateOpen] = useState(false);
  const [editingName, setEditingName] = useState("");
  const [editingRate, setEditingRate] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [manualForCat, setManualForCat] = useState<string | null>(null);
  const [confirmDeleteCat, setConfirmDeleteCat] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState<number>(() => Date.now());
  const simpleMode = false;
  const [showAllCategories, setShowAllCategories] = useState(false);
  // Per-session edit (adjust start) + delete, opened from any session list.
  const [editEntry, setEditEntry] = useState<EditableEntry | null>(null);
  const [deleteEntryTarget, setDeleteEntryTarget] = useState<EditableEntry | null>(null);

  // Rename-only mode for non-Pro: same visual as editingCat but no rate/billing.
  const [renamingCat, setRenamingCat] = useState<string | null>(null);
  const [stopBusy, setStopBusy] = useState(false);
  const [categoryBusyId, setCategoryBusyId] = useState<string | null>(null);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetailsDraft>(emptyPaymentDetails);
  const [paymentDetailsSaving, setPaymentDetailsSaving] = useState(false);
  const addCategoryFormRef = useRef<HTMLFormElement | null>(null);
  const addCategoryInputRef = useRef<HTMLInputElement | null>(null);
  const tabIndex = TABS.indexOf(tab);

  const activeCat = categories.find(c => c.id === active?.category_id);
  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  // Entries are pulled from the shared rolling-entries cache — same source as
  // Home, Reports, and the home tracker hero. Switching to /tracker after any
  // of those have visited reads from cache instead of refetching.
  const trackerTabVisible = useTabVisible();

  const { data: entries = [] } = useQuery({
    queryKey: rollingEntriesQueryKey(user?.id),
    queryFn: () => fetchRollingEntries(user!.id),
    enabled: !!user?.id && trackerTabVisible,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });

  // Parse timestamps once per `entries` change. Every aggregation loop
  // (month grid, day breakdown, today-by-category, period totals) consumes
  // the parsed form and skips `new Date(...).getTime()` in the hot path.
  const parsedEntries = useMemo<ParsedEntry[]>(
    () =>
      entries.map((e) => ({
        id: e.id,
        category_id: e.category_id,
        startMs: new Date(e.started_at).getTime(),
        endMs: e.ended_at ? new Date(e.ended_at).getTime() : null,
        note: e.note,
        block_id: e.block_id ?? null,
        snapshotRate: (e).snapshot_hourly_rate ?? null,
        snapshotCurrency: (e).snapshot_currency ?? null,
      })),
    [entries],
  );

  // Resolve a session id back to its raw (un-clipped) start/end + category so the
  // editor works on the true recorded times, not the period-clipped display values.
  const buildEditableEntry = (id: string): EditableEntry | null => {
    const raw = entries.find((e) => e.id === id);
    if (!raw) return null;
    const cat = raw.category_id ? catMap.get(raw.category_id) : undefined;
    return {
      id: raw.id,
      startedAtMs: new Date(raw.started_at).getTime(),
      endedAtMs: raw.ended_at ? new Date(raw.ended_at).getTime() : null,
      categoryName: cat?.name ?? null,
      categoryColor: cat?.color ?? null,
      note: raw.note ?? null,
      adjustmentSeconds: raw.adjustment_seconds ?? 0,
      adjustmentReason: raw.adjustment_reason ?? null,
    };
  };
  const openEditEntry = (id: string) => { const e = buildEditableEntry(id); if (e) { haptics.tap(); setEditEntry(e); } };
  const openDeleteEntry = (id: string) => { const e = buildEditableEntry(id); if (e) { haptics.tap(); setDeleteEntryTarget(e); } };

  useEffect(() => {
    if (!editingCat) {
      setPaymentDetails(emptyPaymentDetails);
      setBillingRevealed(false);
      return;
    }
    const cat = categories.find((c) => c.id === editingCat);
    if (!cat) return;
    setPaymentDetails(categoryBillingToDraft(cat));
    // Nothing sensitive saved yet → no gate. Existing details stay hidden
    // until the user passes a biometric check.
    setBillingRevealed(!categoryHasSavedBilling(cat));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCat]);

  const unlockBilling = async () => {
    if (billingUnlocking) return;
    // First time: show the opt-in explanation sheet.
    if (getGatePref() === "unset") {
      setBillingGateOpen(true);
      return;
    }
    setBillingUnlocking(true);
    try {
      const ok = await verifyBiometric("View saved payment details");
      if (ok) setBillingRevealed(true);
    } finally {
      setBillingUnlocking(false);
    }
  };

  // Full editor (rate + billing + rename) — Pro only.
  // Non-Pro opening path: pencil → UpgradeSheet; long-press → rename-only.
  const openCategoryEditor = (c: TimeCategory, opts?: { resetRate?: boolean }) => {
    setEditingName(c.name);
    setEditingRate(opts?.resetRate ? "" : (c.hourly_rate == null ? "" : String(c.hourly_rate)));
    setEditingCat(c.id);
    setRenamingCat(null);
  };

  const openRenameOnly = (c: TimeCategory) => {
    setEditingName(c.name);
    setRenamingCat(c.id);
    setEditingCat(null);
  };

  const todayDate = todayDateStr();
  const { data: todayPlanData } = useQuery({
    queryKey: planDashboardQueryKey(user?.id ?? "", todayDate),
    queryFn: () => fetchPlanDashboard(user!.id, todayDate),
    enabled: !!user?.id && trackerTabVisible,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });
  const todayPlanBlocks: Block[] = (todayPlanData?.planBlocks as Block[]) || [];

  // ----- Aggregations -----
  // `nowSec` drives the live duration of any still-running entry in the
  // tracker grid. We only tick when (a) the Tracker tab is visible AND
  // (b) there's an active session whose duration is actually growing.
  // Idle = no running entry = `now` doesn't affect any memo, so a tick
  // is pure waste. Interval is 60s (was 30s) because the grid shows
  // h:m granularity — sub-minute updates wouldn't be visible anyway.
  useEffect(() => {
    if (!trackerTabVisible || !active) return;
    setNowSec(Date.now()); // re-sync on return
    const id = window.setInterval(() => setNowSec(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [trackerTabVisible, active]);

  // Collapse editor/rename when leaving this tab or backgrounding the app.
  useEffect(() => {
    if (!trackerTabVisible) { setEditingCat(null); setRenamingCat(null); }
  }, [trackerTabVisible]);

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) { setEditingCat(null); setRenamingCat(null); } };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("dd_tracker_simple_mode", simpleMode ? "1" : "0");
    } catch {
      // ignore
    }
    if (simpleMode) setTab("today");
  }, [simpleMode]);

  const now = nowSec;

  // Week (last 7 days, oldest first)
  const weekDays = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    return Array.from({ length: 7 }, (_, i) => {
      const dayStart = today - (6 - i) * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const byCat = new Map<string, number>();
      let total = 0;
      for (const p of parsedEntries) {
        const d = clipParsed(p, dayStart, dayEnd, now);
        if (d > 0) {
          total += d;
          if (p.category_id) byCat.set(p.category_id, (byCat.get(p.category_id) || 0) + d);
        }
      }
      return { date: new Date(dayStart), key: ymd(new Date(dayStart)), total, byCat };
    });
  }, [parsedEntries, now]);

  const weekTotal = weekDays.reduce((a, d) => a + d.total, 0);
  const weekPeakSec = Math.max(0, ...weekDays.map(d => d.total));
  const weekMaxSec = Math.max(1, weekPeakSec);
  const weekActiveDays = weekDays.filter((d) => d.total > 0).length;
  const weekRangeLabel = useMemo(() => {
    const a = weekDays[0]!.date;
    const b = weekDays[6]!.date;
    const sameYear = a.getFullYear() === b.getFullYear();
    const left = a.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
    const right = b.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    return `${left} – ${right}`;
  }, [weekDays]);
  const weekAvgSec = weekTotal / 7;

  // Month grid — was the hottest loop in this file. With ~500 entries in
  // the 60-day rolling window and ~31 day cells per render this used to do
  // ~15k `new Date(...).getTime()` calls. Now it loops over parsedEntries
  // (already millis) and does pure numeric clipping in `clipParsed`.
  const monthCells = useMemo(() => {
    const first = new Date(monthCursor);
    const year = first.getFullYear(), month = first.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = (first.getDay() + 6) % 7; // Mon = 0
    const cells: Array<{ date: Date | null; key: string; total: number } | null> = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStart = new Date(year, month, d).getTime();
      const dayEnd = dayStart + DAY_MS;
      let total = 0;
      for (const p of parsedEntries) {
        total += clipParsed(p, dayStart, dayEnd, now);
      }
      cells.push({ date: new Date(dayStart), key: ymd(new Date(dayStart)), total });
    }
    return cells;
  }, [parsedEntries, monthCursor, now]);

  const monthTotal = monthCells.reduce((a, c) => a + (c?.total || 0), 0);
  const monthPeakSec = Math.max(0, ...monthCells.map(c => c?.total || 0));
  const monthMaxSec = Math.max(1, monthPeakSec);
  const monthActiveDays = monthCells.reduce((sum, c) => sum + ((c?.total || 0) > 0 ? 1 : 0), 0);

  // Selected day breakdown (used by week + month)
  const dayDetail = useMemo(() => {
    if (!selectedDay) return null;
    const [y, m, d] = selectedDay.split("-").map(Number);
    const dayStart = new Date(y, m - 1, d).getTime();
    const dayEnd = dayStart + DAY_MS;
    const byCat = new Map<string, number>();
    const items: Array<{ id: string; cat: TimeCategory | undefined; start: number; end: number; dur: number; fromPlanner: boolean }> = [];
    let total = 0;
    for (const p of parsedEntries) {
      const dur = clipParsed(p, dayStart, dayEnd, now);
      if (dur <= 0) continue;
      total += dur;
      if (p.category_id) byCat.set(p.category_id, (byCat.get(p.category_id) || 0) + dur);
      const s = p.startMs > dayStart ? p.startMs : dayStart;
      const en = (p.endMs ?? now) < dayEnd ? (p.endMs ?? now) : dayEnd;
      items.push({
        id: p.id,
        cat: p.category_id ? catMap.get(p.category_id) : undefined,
        start: s,
        end: en,
        dur,
        fromPlanner: !!p.block_id,
      });
    }
    items.sort((a, b) => a.start - b.start);
    return { date: new Date(dayStart), total, byCat, items };
  }, [selectedDay, parsedEntries, catMap, now]);

  // Today breakdown by category
  const todayByCat = useMemo(() => {
    const dayStart = startOfDay(new Date()).getTime();
    const dayEnd = dayStart + DAY_MS;
    const byCat = new Map<string, number>();
    for (const p of parsedEntries) {
      const d = clipParsed(p, dayStart, dayEnd, now);
      if (d > 0 && p.category_id) byCat.set(p.category_id, (byCat.get(p.category_id) || 0) + d);
    }
    return Array.from(byCat.entries())
      .map(([id, sec]) => ({ cat: catMap.get(id), sec }))
      .filter((x) => x.cat)
      .sort((a, b) => b.sec - a.sec);
  }, [parsedEntries, catMap, now]);

  // Period boundaries based on active tab (used for PDF + category drill-in)
  const period = useMemo(() => {
    if (tab === "today") {
      const s = startOfDay(new Date()).getTime();
      return { start: s, end: s + DAY_MS, label: "Today", days: 1 };
    }
    if (tab === "week") {
      const today = startOfDay(new Date()).getTime();
      return { start: today - 6 * DAY_MS, end: today + DAY_MS, label: "Last 7 days", days: 7 };
    }
    const first = new Date(monthCursor).getTime();
    const next = new Date(monthCursor); next.setMonth(next.getMonth() + 1);
    return { start: first, end: next.getTime(), label: monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" }), days: Math.round((next.getTime() - first) / DAY_MS) };
  }, [tab, monthCursor]);

  // Per-category stats for the active period (for inline drill-in)
  const periodCatStats = useMemo(() => {
    const map = new Map<string, { sec: number; sessions: Array<{ id: string; start: number; end: number; note: string | null; fromPlanner: boolean }>; perDay: Map<string, number> }>();
    for (const p of parsedEntries) {
      if (!p.category_id) continue;
      const en = p.endMs ?? now;
      const a = p.startMs > period.start ? p.startMs : period.start;
      const b = en < period.end ? en : period.end;
      if (b <= a) continue;
      const dur = (b - a) / 1000;
      const cur = map.get(p.category_id) || { sec: 0, sessions: [], perDay: new Map() };
      cur.sec += dur;
      cur.sessions.push({ id: p.id, start: a, end: b, note: p.note, fromPlanner: !!p.block_id });
      const dayKey = ymd(new Date(a));
      cur.perDay.set(dayKey, (cur.perDay.get(dayKey) || 0) + dur);
      map.set(p.category_id, cur);
    }
    return map;
  }, [parsedEntries, period, now]);

  // Per-category earnings for the active period, computed per-entry using the
  // rate snapshot captured at session start. This means changing a category's
  // hourly rate never retroactively alters earnings shown for past sessions.
  // Uses only the rate snapshot captured at session start. Changing a category's
  // current rate must never retroactively alter displayed historical earnings —
  // so catMap is intentionally not a dependency of this memo.
  const earnedByCat = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of parsedEntries) {
      if (!p.category_id) continue;
      const rate = p.snapshotRate;
      if (!rate || rate <= 0) continue;
      const en = p.endMs ?? now;
      const a = p.startMs > period.start ? p.startMs : period.start;
      const b = en < period.end ? en : period.end;
      if (b <= a) continue;
      map.set(p.category_id, (map.get(p.category_id) ?? 0) + ((b - a) / 3_600_000) * rate);
    }
    return map;
  }, [parsedEntries, period, now]);

  const headerTotalSec = tab === "today" ? todayTotalSec : tab === "week" ? weekTotal : monthTotal;
  const headerLabel =
    tab === "today"
      ? "Today"
      : tab === "week"
        ? "Last 7 days"
        : monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const isViewingCurrentMonth = useMemo(() => {
    const n = new Date();
    return monthCursor.getFullYear() === n.getFullYear() && monthCursor.getMonth() === n.getMonth();
  }, [monthCursor]);
  const visibleCategories = useMemo(() => {
    const taskTitleSet = new Set(
      todayPlanBlocks
        .filter((b) => isUserTask(b))
        .map((b) => b.title.trim().toLowerCase()),
    );
    const sorted = [...categories].sort((a, b) => {
      const aTask = taskTitleSet.has(a.name.trim().toLowerCase()) ? 0 : 1;
      const bTask = taskTitleSet.has(b.name.trim().toLowerCase()) ? 0 : 1;
      return aTask - bTask;
    });
    if (!simpleMode || showAllCategories) return sorted;
    const first = sorted.slice(0, 2);
    if (active && !first.some((c) => c.id === active.category_id)) {
      const activeCategory = sorted.find((c) => c.id === active.category_id);
      if (activeCategory) return [...first, activeCategory];
    }
    return first;
  }, [categories, todayPlanBlocks, simpleMode, showAllCategories, active?.category_id]);

  // Smart stop: if running session is < 60s, confirm (likely accidental tap).
  const handleStop = async () => {
    if (stopBusy) return;
    // Read the live (un-rendered) elapsed seconds directly from the store —
    // bypassing the minute-resolution React state.
    if (active && getElapsedSec() < 60) {
      const ok = window.confirm("Stop after less than a minute? This session will still be saved.");
      if (!ok) return;
    }
    setStopBusy(true);
    try {
      await stop();
      setEditingCat(null);
      haptics.notify("success");
    } finally {
      setStopBusy(false);
    }
  };

  const focusAddCategory = () => {
    setTab("today");
    // The keyboard only opens for a `.focus()` that runs SYNCHRONOUSLY inside the
    // user-gesture (tap) call stack. Deferring it to rAF — as we used to —
    // severs that chain, so on iOS/Android the field focuses but the keyboard
    // never appears. When the input is already mounted (the common case: the
    // Add-category form lives on the same "today" tab as the trigger), focus it
    // right now within the gesture; only the scroll-into-view is deferred a
    // frame. If the tab is still switching and the input isn't mounted yet, fall
    // back to the rAF path (keyboard may not pop, but focus still lands).
    const input = addCategoryInputRef.current;
    if (input) {
      input.focus();
      // `auto`, not `smooth`: a smooth scroll running into the keyboard slide-in
      // janks on iOS WKWebView.
      window.requestAnimationFrame(() => {
        addCategoryFormRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
      });
    } else {
      window.requestAnimationFrame(() => {
        addCategoryFormRef.current?.scrollIntoView({ behavior: "auto", block: "center" });
        addCategoryInputRef.current?.focus();
      });
    }
  };

  const updatePaymentField = (field: keyof PaymentDetailsDraft, value: string) =>
    setPaymentDetails((current) => ({ ...current, [field]: value }));

  const savePaymentDetails = async () => {
    if (!editingCat) return true;
    // Billing is Pro-only. For free users there's nothing to persist — let the
    // (free) rename go through and close the editor instead of forcing upgrade.
    if (!isPro) return true;
    setPaymentDetailsSaving(true);
    try {
      await updateCategoryBilling(editingCat, paymentDetails);
      return true;
    } catch (e) {
      toast.error(e?.message || "Unable to save payment details");
      return false;
    } finally {
      setPaymentDetailsSaving(false);
    }
  };

  // ----- PDF export -----
  // Core export logic — no gate check. Called after verification is already done.
  const runExport = async () => {
    setExporting(true);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 40;
      let y = margin;

      doc.setFont("helvetica", "bold"); doc.setFontSize(18);
      doc.text("Time tracker report", margin, y); y += 22;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(110);
      const periodText = `${period.label} · ${new Date(period.start).toLocaleDateString()} – ${new Date(period.end - 1).toLocaleDateString()}`;
      doc.text(periodText, margin, y); y += 14;
      doc.text(`Total: ${fmtHM(headerTotalSec)}`, margin, y); y += 20;
      doc.setTextColor(0);

      // Section: by category
      const catRows: string[][] = [];
      const catTotals = Array.from(periodCatStats.entries())
        .map(([id, v]) => ({ cat: catMap.get(id), sec: v.sec, sessions: v.sessions.length }))
        .filter(x => x.cat)
        .sort((a, b) => b.sec - a.sec);
      const grand = catTotals.reduce((a, x) => a + x.sec, 0) || 1;
      catTotals.forEach(x => catRows.push([x.cat!.name, fmtHM(x.sec), `${Math.round((x.sec / grand) * 100)}%`, String(x.sessions)]));

      doc.setFont("helvetica", "bold"); doc.setFontSize(12);
      doc.text("Summary by category", margin, y); y += 8;
      autoTable(doc, {
        startY: y + 4,
        head: [["Category", "Time", "Share", "Sessions"]],
        body: catRows.length ? catRows : [["—", "—", "—", "—"]],
        styles: { fontSize: 10 },
        headStyles: { fillColor: [240, 240, 245], textColor: 30 },
        margin: { left: margin, right: margin },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;

      // Section: per day
      const periodDays: Array<{ key: string; date: Date; total: number }> = [];
      for (let t = period.start; t < period.end; t += DAY_MS) {
        const ds = t, de = t + DAY_MS;
        let total = 0;
        entries.forEach(e => { total += clipDuration(e, ds, de, now); });
        periodDays.push({ key: ymd(new Date(ds)), date: new Date(ds), total });
      }

      if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = margin; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(12);
      doc.text("Daily breakdown", margin, y); y += 16;
      const maxDay = Math.max(1, ...periodDays.map(d => d.total));
      const barAreaW = pageW - margin * 2 - 160;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      periodDays.forEach(d => {
        if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = margin; }
        const label = d.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        doc.setTextColor(60);
        doc.text(label, margin, y);
        doc.setDrawColor(230); doc.setFillColor(240, 240, 245);
        doc.roundedRect(margin + 110, y - 8, barAreaW, 10, 2, 2, "F");
        if (d.total > 0) {
          const w = Math.max(2, (d.total / maxDay) * barAreaW);
          doc.setFillColor(99, 102, 241);
          doc.roundedRect(margin + 110, y - 8, w, 10, 2, 2, "F");
        }
        doc.setTextColor(0);
        doc.text(d.total > 0 ? fmtHM(d.total) : "—", margin + 110 + barAreaW + 8, y);
        y += 16;
      });
      y += 10;

      // Section: all sessions
      const allSessions: Array<{ start: number; end: number; dur: number; cat: string; note: string }> = [];
      entries.forEach(e => {
        const s = new Date(e.started_at).getTime();
        const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
        const a = Math.max(s, period.start);
        const b = Math.min(en, period.end);
        if (b <= a) return;
        const cat = e.category_id ? catMap.get(e.category_id) : undefined;
        allSessions.push({ start: a, end: b, dur: (b - a) / 1000, cat: cat?.name || "Uncategorized", note: e.note || "" });
      });
      allSessions.sort((a, b) => a.start - b.start);

      if (allSessions.length) {
        if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = margin; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(12);
        doc.text("Sessions", margin, y); y += 8;
        autoTable(doc, {
          startY: y + 4,
          head: [["Date", "Start", "End", "Duration", "Category", "Note"]],
          body: allSessions.map(s => [
            new Date(s.start).toLocaleDateString(),
            new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            new Date(s.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            fmtHM(s.dur),
            s.cat,
            s.note,
          ]),
          styles: { fontSize: 9 },
          headStyles: { fillColor: [240, 240, 245], textColor: 30 },
          margin: { left: margin, right: margin },
        });
      }

      // Footer
      const pageCount = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        doc.setFontSize(8); doc.setTextColor(140);
        doc.text(`Daydraft · generated ${new Date().toLocaleString()}`, margin, doc.internal.pageSize.getHeight() - 18);
        doc.text(`${p} / ${pageCount}`, pageW - margin, doc.internal.pageSize.getHeight() - 18, { align: "right" });
      }

      const fileLabel = period.label.toLowerCase().replace(/\s+/g, "-");
      const filename = `daydraft-tracker-${fileLabel}-${ymd(new Date())}.pdf`;
      const pdfBlob = doc.output("blob") as Blob;
      await triggerDownload(pdfBlob, filename, "application/pdf");
      toast.success("PDF exported");
    } catch (err) {
      toast.error(err?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  // Gate wrapper: first time → show explanation sheet, otherwise verify and run.
  const exportPDF = async () => {
    if (!isPro) { setUpgradeOpen(true); return; }
    if (getGatePref() === "unset") { setExportGateOpen(true); return; }
    const allowed = await verifyBiometric("Export time tracking report");
    if (allowed) void runExport();
  };

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    embedded
      ? <div className="bg-background">{children}</div>
      : <div className="rounded-t-[20px] p-0 border border-soft max-h-[92vh] overflow-y-auto bg-background/88 backdrop-blur-xl">{children}</div>;

  return (
    <>
    <Wrapper>
        {/* Header */}
        <div className="px-5 pt-6 pb-4 border-b border-soft">
          {/* PDF moved to the bottom of the sheet — the close (X) sits in the
              top-right of SheetContent and any button placed beside it gets
              accidentally tapped when the user reaches to dismiss. */}
          <div className="text-left">
            <h2 className="type-title text-[24px] pr-8 tracking-tight">Time tracker</h2>
            {!active && (
              <>
                <p className="text-xs text-secondary-fg mt-0.5">
                  {headerLabel}: <span className="text-foreground font-medium">{fmtHM(headerTotalSec)}</span>
                </p>
                <p className="text-[13px] text-secondary-fg mt-3 leading-[1.55] max-w-[20rem]">
                  Choose what you&apos;re working on, tap Play, then Pause when done. Use the pills below to view today, week, or month totals.
                </p>
              </>
            )}
          </div>
          {/* Quick mode removed — week/month tabs always visible */}

          {/* Tabs */}
          {!simpleMode ? (
            <div className="mt-5 relative inline-flex w-full rounded-[14px] bg-muted/80 p-1 tracker-tabs-luxe">
              <span
                aria-hidden
                className="pointer-events-none absolute top-1 bottom-1 rounded-[10px] tracker-tabs-indicator"
                style={{
                  left: `calc(${tabIndex * (100 / TABS.length)}% + 4px)`,
                  width: `calc(${100 / TABS.length}% - 8px)`,
                }}
              />
              {TABS.map(t => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setSelectedDay(null); }}
                  className={`relative z-[1] flex-1 px-3 py-1.5 rounded-lg text-xs font-medium capitalize pressable transition-colors ${
                    tab === t ? "text-foreground" : "text-secondary-fg"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* PLAN TAB — categories + start/stop + today summary */}
        {tab === "today" && (
          <>
            <div className="px-5 pt-4">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={focusAddCategory}
                  className="rounded-[14px] border border-soft surface-soft px-3 py-2.5 text-left pressable hover:border-primary/30"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <Plus className="h-3.5 w-3.5" />
                    Category
                  </span>
                  <span className="mt-1 block text-[10px] text-secondary-fg">{categories.length} total</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("week")}
                  className="rounded-[14px] border border-soft surface-soft px-3 py-2.5 text-left pressable hover:border-primary/30"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Week
                  </span>
                  <span className="mt-1 block text-[10px] text-secondary-fg">{fmtHM(weekTotal)}</span>
                </button>
                <button
                  type="button"
                  onClick={exportPDF}
                  disabled={exporting || headerTotalSec === 0}
                  className="rounded-[14px] border border-soft surface-soft px-3 py-2.5 text-left pressable hover:border-primary/30 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    {isPro ? <Download className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    Export
                  </span>
                  <span className="mt-1 block text-[10px] text-secondary-fg">{isPro ? headerLabel : "Pro PDF"}</span>
                </button>
              </div>
            </div>
            {/* Hero stopwatch — premium, centered */}
            <div className="px-5 pt-5">
              <div
                className={`relative overflow-hidden rounded-[18px] border p-5 transition-[border-color,background-color,box-shadow,transform] duration-[320ms] backdrop-blur-sm tracker-hero-luxe ${
                  active && activeCat
                    ? "tracker-hero--running border-transparent surface-card shadow-card"
                    : "border-soft surface-card"
                }`}
                style={
                  active && activeCat
                    ? ({ "--tracker-accent": activeCat.color } as React.CSSProperties)
                    : undefined
                }
              >
                {active && activeCat ? (
                  <div className="relative z-[1] flex flex-col items-center text-center gap-4 fade-in">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span
                          className="absolute inset-0 rounded-full tracker-dot-soft-pulse opacity-80"
                          style={{ background: activeCat.color }}
                        />
                        <span className="relative h-2.5 w-2.5 rounded-full ring-2 ring-background" style={{ background: activeCat.color }} />
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg">Now tracking</span>
                    </div>
                    <LiveElapsed
                      format={fmtHMS}
                      className="font-display tabular-nums text-[44px] font-semibold leading-none tracking-tight tracker-time-glow tracker-time-glow--live"
                    />
                    <div className="text-[14px] font-medium text-subtle truncate max-w-full">
                      {activeCat.name}
                    </div>
                    <button
                      onClick={handleStop}
                      className="tracker-stop-btn mt-1 btn-volumetric-danger inline-flex items-center justify-center gap-2 h-11 px-6 rounded-full text-white text-[14px] font-semibold pressable shadow-card"
                      aria-label="Stop"
                    >
                      <Pause className="h-3.5 w-3.5" fill="currentColor" /> Stop
                    </button>
                  </div>
                ) : (
                  <div className="relative z-[1] flex flex-col items-center text-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg">Today</span>
                    <div className="font-display tabular-nums text-[40px] font-semibold leading-none tracking-tight">
                      {fmtHM(todayTotalSec)}
                    </div>
                    <p className="text-[12px] text-secondary-fg mt-1">
                      {todayTotalSec === 0 ? "Pick a category to start tracking" : "Idle — ready when you are"}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Today proportional breakdown — springs in after the first session
                stops, hidden while nothing has been tracked yet. Each category
                row also springs in individually so new ones animate as they're added. */}
            <AnimatePresence initial={false}>
              {!simpleMode && todayByCat.length > 0 && (
                <motion.div
                  key="today-breakdown"
                  className="px-5 pt-4"
                  initial={{ opacity: 0, y: 14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 340, damping: 28, mass: 0.85 }}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-secondary-fg mb-2">Where today went</div>
                  <div className="space-y-1.5">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {todayByCat.map((x, i) => {
                        const pct = (x.sec / Math.max(1, todayTotalSec)) * 100;
                        return (
                          <motion.div
                            key={x.cat!.id}
                            layout
                            initial={{ opacity: 0, x: -14, scale: 0.96 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: -10, scale: 0.97 }}
                            transition={{ type: "spring", stiffness: 380, damping: 28, mass: 0.8, delay: i * 0.04 }}
                            className="flex items-center gap-2 text-[12px]"
                          >
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: x.cat!.color }} />
                            <span className="w-20 truncate text-foreground">{x.cat!.name}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${pct}%`, background: x.cat!.color }} />
                            </div>
                            <span className="font-mono tabular-nums text-secondary-fg w-12 text-right">{fmtHM(x.sec)}</span>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Switch hint removed — switching mid-session was confusing and
                rarely intentional; users can stop and start a fresh session. */}

            {/* Empty state when no entries today and no active */}
            {!active && todayByCat.length === 0 && categories.length > 0 && (
              <div className="min-h-[40vh] flex flex-col items-center justify-center px-5 empty-state-fade">
                <div className="w-full rounded-[18px] border border-dashed border-soft surface-soft backdrop-blur-sm px-4 py-5 text-center">
                  <div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-2 breathe">
                    <Clock className="h-4 w-4 text-secondary-fg" />
                  </div>
                  <div className="text-[13px] font-medium">No time tracked today</div>
                  <div className="text-[11px] text-secondary-fg mt-0.5">Tap a category below to start, or log past time with +Add.</div>
                </div>
              </div>
            )}

            <div className="px-4 py-4 space-y-2 enter-stagger">
              {visibleCategories.map(c => {
                const isActive = active?.category_id === c.id;
                const isOpen = selectedCat === c.id;
                const stat = periodCatStats.get(c.id);
                const periodSec = stat?.sec || 0;
                const rate = Number(c.hourly_rate || 0); // display-only: shows current rate label
                const earned = earnedByCat.get(c.id) ?? 0;
                return (
                  <SwipeRow key={c.id} disabled={c.is_default || isActive || editingCat === c.id || renamingCat === c.id} onDelete={() => setConfirmDeleteCat(c.id)}>
                  <div className={`rounded-[18px] border transition-[border-color,background-color,box-shadow,transform] duration-300 shadow-card tracker-category-luxe ${isActive ? "border-accent surface-accent ring-2 ring-primary/12 ring-offset-2 ring-offset-background" : "border-soft surface-card"} overflow-hidden backdrop-blur-sm`}>
                    <AnimatePresence mode="popLayout" initial={false}>
                    {renamingCat === c.id ? (
                      /* ── Rename-only form (free tier) ─────────────── */
                      <motion.form
                        key="rename"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (editingName.trim() && editingName.trim() !== c.name) {
                            await renameCategory(c.id, editingName);
                          }
                          setRenamingCat(null);
                        }}
                        className="w-full min-w-0 px-3 pt-3 pb-2"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ height: { type: "tween", duration: 0.34, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.22, ease: "easeOut" } }}
                        style={{ overflow: "hidden" }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="h-3 w-3 rounded-full shrink-0" style={{ background: c.color }} />
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") setRenamingCat(null); }}
                            className="flex-1 h-8 bg-transparent border-0 px-0 text-[15px] font-medium focus-visible:ring-0 shadow-none"
                            style={{ fontSize: 16 }}
                            autoFocus
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            className="flex-1 h-9 rounded-xl bg-primary text-[12px] font-semibold text-primary-foreground pressable"
                          >
                            Save
                          </button>
                          <button type="button" onClick={() => setRenamingCat(null)} className="h-9 w-9 rounded-xl border border-border/70 text-secondary-fg pressable" aria-label="Cancel">
                            <X className="mx-auto h-4 w-4" />
                          </button>
                        </div>
                      </motion.form>
                    ) : editingCat === c.id ? (
                      /* ── Edit / billing form ──────────────────────── */
                      <motion.form
                        key="edit"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          // Validate the rate BEFORE saving anything — garbage
                          // input (letters, symbols, "0123") must surface a
                          // format error, not a misleading "saved" message.
                          const parsedRate = parseHourlyRate(editingRate);
                          if (parsedRate.kind === "invalid") {
                            toast.error("Invalid rate — enter a number like 25 or 25.50");
                            return;
                          }
                          const rateValue = parsedRate.kind === "cleared" ? null : parsedRate.value;
                          if (editingName.trim() && editingName.trim() !== c.name) {
                            await renameCategory(c.id, editingName);
                          }
                          if ((rateValue ?? null) !== (c.hourly_rate ?? null)) {
                            await updateCategoryRate(c.id, rateValue);
                          }
                          const savedPaymentDetails = await savePaymentDetails();
                          if (!savedPaymentDetails) return;
                          setEditingCat(null);
                        }}
                        className="w-full min-w-0 px-3 pt-3 pb-2"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ height: { type: "tween", duration: 0.34, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.22, ease: "easeOut" } }}
                        style={{ overflow: "hidden" }}
                      >
                        {/* ① Name row — static content; the form's own height+opacity
                            tween is the single entrance (matches the timeline task cards).
                            Per-section spring staggers used to fire WHILE the height grew,
                            and their overshoot read as a janky "pressed-in" bounce. */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className="h-3 w-3 rounded-full shrink-0" style={{ background: c.color }} />
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") setEditingCat(null); }}
                            className="flex-1 h-8 bg-transparent border-0 px-0 text-[15px] font-medium focus-visible:ring-0 shadow-none"
                            style={{ fontSize: 16 }}
                          />
                        </div>

                        {/* ② Rate row */}
                        <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/50 shadow-sm px-2.5 py-2 mb-2">
                          {isPro ? (
                            <>
                              <span className="text-[11px] font-semibold text-primary/80 shrink-0">Rate / h</span>
                              <Input
                                inputMode="decimal"
                                value={editingRate}
                                onChange={(e) => setEditingRate(e.target.value)}
                                placeholder="0"
                                className="h-7 flex-1 bg-transparent border-0 px-0 text-right text-[13px] font-mono tabular-nums focus-visible:ring-0 shadow-none"
                                style={{ fontSize: 16 }}
                              />
                              <Input
                                value={paymentDetails.currency}
                                onChange={(e) => updatePaymentField("currency", e.target.value.toUpperCase().slice(0, 3))}
                                placeholder="USD"
                                className="h-7 w-14 bg-transparent border-l border-soft rounded-none px-2 text-center text-[11px] font-semibold font-mono focus-visible:ring-0 shadow-none"
                                style={{ fontSize: 16 }}
                                maxLength={3}
                              />
                            </>
                          ) : (
                            // Rate is a Pro feature — locked CTA in place of the inputs.
                            <button
                              type="button"
                              onClick={() => setUpgradeOpen(true)}
                              className="flex w-full items-center gap-2 text-left pressable"
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-primary bg-primary/10 border border-primary/20">
                                <Lock className="h-3 w-3" />
                              </span>
                              <span className="text-[11px] font-semibold text-secondary-fg flex-1">Hourly rate &amp; earnings</span>
                              <span className="text-[10px] font-semibold text-primary">Pro</span>
                            </button>
                          )}
                        </div>

                        {/* ②½ Rate scope — only when a rate is set AND rate_set_at is non-null */}
                        <AnimatePresence initial={false}>
                          {c.rate_set_at && c.hourly_rate && (
                            <motion.div
                              key="rate-scope"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ type: "spring", stiffness: 380, damping: 30 }}
                              className="overflow-hidden mb-2"
                            >
                              <Callout variant="warning" className="py-2 px-2.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] flex-1 leading-snug">
                                    Earnings count from{" "}
                                    <span className="font-semibold">
                                      {new Date(c.rate_set_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                    </span>
                                    {" "}— time before that isn't billed.
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void resetRateSetAt(c.id)}
                                    className="shrink-0 text-[10px] font-semibold underline underline-offset-2 pressable"
                                  >
                                    Include all
                                  </button>
                                </div>
                              </Callout>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* ③ Billing section */}
                        <div className="rounded-xl border border-border/70 bg-muted/20 px-2.5 py-2.5 mb-2">
                          <div className="mb-2 flex items-center gap-2">
                            <span
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-primary bg-primary/10 border border-primary/20"
                            >
                              <Wallet className="h-3 w-3" strokeWidth={2.4} />
                            </span>
                            <span className="text-[11px] font-semibold text-secondary-fg flex-1">Payment for this category</span>
                            {!isPro && <span className="text-[10px] font-semibold text-primary">Pro</span>}
                          </div>
                          {!isPro ? (
                            <button
                              type="button"
                              onClick={() => setUpgradeOpen(true)}
                              className="h-8 w-full rounded-lg border border-border/80 text-[11px] font-semibold text-primary pressable"
                            >
                              Unlock payment details
                            </button>
                          ) : (
                            <AnimatePresence mode="wait" initial={false}>
                              {billingRevealed ? (
                                <motion.div
                                  key="fields"
                                  initial={{ opacity: 0, y: 6 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -3 }}
                                  transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                                >
                                  <PaymentMethodFields
                                    compact
                                    value={paymentDetails as PaymentFieldsValue}
                                    onChange={(field, val) => updatePaymentField(field as keyof PaymentDetailsDraft, val)}
                                  />
                                </motion.div>
                              ) : (
                                <motion.button
                                  key="gate"
                                  type="button"
                                  onClick={unlockBilling}
                                  disabled={billingUnlocking}
                                  className="pebble-idle flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left pressable disabled:opacity-60"
                                  initial={{ opacity: 0, y: 6 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -3 }}
                                  transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                                >
                                  <motion.span
                                    className="shrink-0 h-8 w-8 rounded-xl flex items-center justify-center text-primary bg-primary/10 border border-primary/20"
                                    animate={billingUnlocking ? { rotate: [0, -8, 8, -8, 8, 0] } : {}}
                                    transition={{ duration: 0.5 }}
                                  >
                                    <Lock className="h-4 w-4" />
                                  </motion.span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-[12.5px] font-semibold text-foreground leading-tight">
                                      {billingUnlocking ? "Verifying…" : "Payment details hidden"}
                                    </span>
                                    <span className="block text-[11px] text-secondary-fg/75 mt-0.5 leading-snug">
                                      Tap to reveal with Face ID / fingerprint
                                    </span>
                                  </span>
                                </motion.button>
                              )}
                            </AnimatePresence>
                          )}
                        </div>

                        {/* ④ Save / Cancel buttons */}
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={paymentDetailsSaving}
                            className="flex-1 h-9 rounded-xl bg-primary text-[12px] font-semibold text-primary-foreground pressable disabled:opacity-60"
                            aria-label="Save category and billing details"
                          >
                            {paymentDetailsSaving ? "Saving..." : "Save"}
                          </button>
                          <button type="button" onClick={() => setEditingCat(null)} className="h-9 w-9 rounded-xl border border-border/70 text-secondary-fg pressable" aria-label="Cancel">
                            <X className="mx-auto h-4 w-4" />
                          </button>
                        </div>
                      </motion.form>
                    ) : (
                      <motion.div
                        key="row"
                        className="flex items-center gap-2 px-3 py-2.5 w-full"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <LongPressButton
                          onClick={() => {
                            if (simpleMode) return;
                            setSelectedCat(isOpen ? null : c.id);
                          }}
                          onLongPress={() => {
                            if (isPro) openCategoryEditor(c);
                            else openRenameOnly(c);
                          }}
                          className="flex-1 flex items-center gap-2 min-w-0 text-left pressable"
                          ariaLabel={`${c.name} details — long press to rename`}
                        >
                          <span className="relative h-3 w-3 shrink-0">
                            {isActive && (
                              <span
                                className="absolute inset-0 rounded-full tracker-dot-soft-pulse opacity-70"
                                style={{ background: c.color }}
                              />
                            )}
                            <span className="relative z-[1] block h-3 w-3 rounded-full ring-1 ring-background" style={{ background: c.color }} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[15px] font-medium truncate">{c.name}</span>
                            {rate > 0 && (
                              <span className="block text-[10px] font-mono tabular-nums text-secondary-fg">
                                {fmtMoney(rate, c.currency ?? undefined)}/h
                              </span>
                            )}
                            {rate === 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isPro) { setUpgradeOpen(true); return; }
                                  openCategoryEditor(c, { resetRate: true });
                                }}
                                className="inline-flex items-center gap-1 text-[10px] font-medium text-primary/85 hover:text-primary pressable mt-0.5"
                              >
                                {!isPro && <Lock className="h-2.5 w-2.5" />}
                                + Set hourly rate
                              </button>
                            )}
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-mono tabular-nums text-[11px] text-secondary-fg">{fmtHM(periodSec)}</span>
                            {earned > 0 && <span className="block font-mono tabular-nums text-[10px] text-primary">{fmtMoney(earned, c.currency ?? undefined)}</span>}
                          </span>
                          {!simpleMode && <ChevronDown className={`h-3.5 w-3.5 text-secondary-fg shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />}
                        </LongPressButton>
                        <button
                          onClick={() => {
                            if (isPro) openCategoryEditor(c);
                            else setUpgradeOpen(true);
                          }}
                          className="category-edit-btn p-1.5 text-secondary-fg hover:text-foreground pressable"
                          aria-label={`Edit ${c.name}`}
                          title={isPro ? "Edit category" : "Rate & billing — Pro feature"}
                        >
                          {isPro ? <Pencil className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                        </button>
                        {isActive ? (
                          <button disabled={stopBusy} onClick={handleStop} className="tracker-stop-btn inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium pressable disabled:opacity-50 disabled:pointer-events-none">
                            <Pause className="h-3 w-3" fill="currentColor" /> Stop
                          </button>
                        ) : (
                          <>
                            {!simpleMode && (
                              <button
                                onClick={() => setManualForCat(manualForCat === c.id ? null : c.id)}
                                className="p-1.5 text-secondary-fg hover:text-foreground pressable"
                                aria-label="Add past time"
                                title="Log past time"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {!active && !c.is_default && (
                              <button
                                onClick={() => setConfirmDeleteCat(c.id)}
                                className="p-1.5 text-secondary-fg hover:text-destructive pressable"
                                aria-label={`Delete category ${c.name}`}
                                title="Delete category"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {!active && (
                              <button
                                disabled={!!categoryBusyId}
                                onClick={async () => {
                                  if (categoryBusyId) return;
                                  setCategoryBusyId(c.id);
                                  try {
                                    await start(c.id);
                                    haptics.impact("medium");
                                  } finally {
                                    setCategoryBusyId(null);
                                  }
                                }}
                                className="tracker-start-btn gleam btn-volumetric inline-flex items-center gap-1 h-9 px-3 rounded-lg text-primary-foreground text-xs font-medium pressable disabled:opacity-50 disabled:pointer-events-none"
                              >
                                <Play className="h-3 w-3" fill="currentColor" /> Start
                              </button>
                            )}
                          </>
                        )}
                      </motion.div>
                    )}
                    </AnimatePresence>
                    {!simpleMode && manualForCat === c.id && (
                      <ManualEntryRow
                        color={c.color}
                        onSubmit={async (mins, note) => {
                          await addManualEntry(c.id, mins * 60, { note });
                          setManualForCat(null);
                        }}
                        onCancel={() => setManualForCat(null)}
                      />
                    )}
                    {!simpleMode && isOpen && (
                      <CategoryDetail cat={c} stat={stat} period={period} onEditEntry={openEditEntry} onDeleteEntry={openDeleteEntry} />
                    )}
                  </div>
                  </SwipeRow>
                );
              })}

              {simpleMode && !showAllCategories && categories.length > visibleCategories.length && (
                <button
                  type="button"
                  onClick={() => setShowAllCategories(true)}
                  className="w-full h-10 rounded-[14px] border border-soft surface-soft text-[12px] text-secondary-fg hover:text-foreground pressable"
                >
                  Show all categories
                </button>
              )}

              {!simpleMode && (
              <form
                ref={addCategoryFormRef}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newName.trim()) return;
                  const c = await addCategory(newName);
                  if (c) setNewName("");
                }}
                className="flex items-center gap-2 rounded-[14px] border border-dashed border-border/90 surface-soft backdrop-blur-sm px-3 py-2"
              >
                <Plus className="h-4 w-4 text-secondary-fg shrink-0" />
                <Input
                  ref={addCategoryInputRef}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Add category (e.g. Client A)"
                  className="flex-1 h-8 bg-transparent border-0 px-0 text-sm focus-visible:ring-0 shadow-none"
                  style={{ fontSize: 16 }}
                />
                {newName.trim() && (
                  <button type="submit" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium pressable">
                    <Check className="h-3 w-3" /> Add
                  </button>
                )}
              </form>
              )}
            </div>
          </>
        )}

        {/* WEEK TAB — rolling 7 days, oldest → newest (today on the right) */}
        {tab === "week" && (
          <div className="px-5 py-4 space-y-4">
            <div className="app-card px-4 py-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-display font-semibold text-foreground leading-tight">Last 7 days</h3>
                  <p className="text-[12px] text-secondary-fg mt-1.5 leading-snug">{weekRangeLabel}</p>
                  <p className="text-[11px] text-faint mt-1.5 leading-snug">
                    Each bar is one day of tracked time. The number above it is exact; height is relative to the busiest day.
                  </p>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-secondary-fg">Total</div>
                  <div className="font-display text-xl font-semibold tabular-nums leading-none">{fmtHM(weekTotal)}</div>
                  <div className="text-[10px] text-secondary-fg tabular-nums">~{fmtHM(weekAvgSec)} / day avg</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-soft/80 bg-black/[0.03] dark:bg-black/40 px-2.5 py-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary-fg">Best day</div>
                  <div className="mt-0.5 font-mono text-[12px] font-semibold tabular-nums text-foreground">{weekPeakSec > 0 ? fmtHM(weekPeakSec) : "0m"}</div>
                </div>
                <div className="rounded-lg border border-soft/80 bg-black/[0.03] dark:bg-black/40 px-2.5 py-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary-fg">Active days</div>
                  <div className="mt-0.5 font-mono text-[12px] font-semibold tabular-nums text-foreground">{weekActiveDays}/7</div>
                </div>
                <div className="rounded-lg border border-soft/80 bg-black/[0.03] dark:bg-black/40 px-2.5 py-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary-fg">Scale</div>
                  <div className="mt-0.5 font-mono text-[12px] font-semibold tabular-nums text-foreground">0 → {weekPeakSec > 0 ? fmtHM(weekPeakSec) : "0m"}</div>
                </div>
              </div>

              <div className="rounded-xl border border-soft/80 bg-muted/15 px-1.5 sm:px-2 pt-2 pb-1.5">
                <div className="flex items-end justify-between gap-0.5 sm:gap-1 min-h-[128px]">
                  {weekDays.map((d) => {
                    const h = d.total > 0 ? Math.max(10, (d.total / weekMaxSec) * 100) : 5;
                    const isSelected = selectedDay === d.key;
                    const isToday = d.key === ymd(new Date());
                    const weekday = d.date.toLocaleDateString(undefined, { weekday: "short" });
                    const dayNum = d.date.getDate();
                    const title = d.date.toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    });
                    return (
                      <button
                        key={d.key}
                        type="button"
                        title={title}
                        aria-label={`${title}, ${d.total > 0 ? fmtHM(d.total) + " tracked" : "no time tracked"}`}
                        aria-pressed={isSelected}
                        onClick={() => setSelectedDay(isSelected ? null : d.key)}
                        className={`flex-1 min-w-0 flex flex-col items-center gap-1 rounded-lg py-1 pressable transition-colors ${
                          isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/[0.06]" : "hover:bg-black/5 dark:hover:bg-black/40"
                        }`}
                      >
                        <div className="h-[78px] w-full flex flex-col items-center justify-end gap-1">
                          <span
                            className={`text-[10px] font-mono tabular-nums leading-none ${d.total > 0 ? "text-foreground font-medium" : "text-faint"}`}
                          >
                            {d.total > 0 ? fmtHM(d.total) : "—"}
                          </span>
                          <div className="h-[52px] w-full flex items-end justify-center">
                            <div
                              className={`w-[88%] max-w-[36px] rounded-md transition-[height,background-color,box-shadow,transform] duration-300 ease-out ${
                                isSelected
                                  ? "bg-primary shadow-sm"
                                  : d.total > 0
                                    ? "bg-primary/65 hover:bg-primary/80"
                                    : "bg-muted"
                              }`}
                              style={{ height: `${h}%`, minHeight: d.total > 0 ? 6 : 4 }}
                            />
                          </div>
                        </div>
                        <div className="text-center pt-0.5 pb-0.5 w-full border-t border-transparent">
                          <div className={`text-[11px] font-semibold leading-tight truncate w-full ${isToday ? "text-primary" : "text-foreground"}`}>
                            {weekday}
                          </div>
                          <div className="text-[10px] text-secondary-fg tabular-nums leading-tight">{dayNum}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-[11px] text-secondary-fg leading-relaxed border-t border-soft pt-3">
                Tap a column to open that day&apos;s sessions, category split, and 24h timeline below.
              </p>
            </div>

            {dayDetail && <DayDetail detail={dayDetail} catMap={catMap} onEditEntry={openEditEntry} onDeleteEntry={openDeleteEntry} />}
          </div>
        )}

        {/* MONTH TAB — calendar month heatmap (Mon-first grid) */}
        {tab === "month" && (
          <div className="px-5 py-4 space-y-4">
            <div className="app-card px-4 py-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setMonthCursor((d) => {
                    const x = new Date(d);
                    x.setMonth(x.getMonth() - 1);
                    return x;
                  })}
                  className="p-2 rounded-xl border border-soft surface-soft pressable shrink-0 mt-0.5"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex-1 text-center min-w-0 px-1">
                  <div className="text-[16px] font-display font-semibold leading-tight">{monthLabel}</div>
                  <p className="text-[12px] text-secondary-fg mt-1 leading-snug">
                    Each square is one day. Time is printed inside; darker color means closer to this month's best day.
                  </p>
                  {!isViewingCurrentMonth && (
                    <button
                      type="button"
                      onClick={() => {
                        const x = new Date();
                        x.setDate(1);
                        x.setHours(0, 0, 0, 0);
                        setMonthCursor(x);
                        setSelectedDay(null);
                      }}
                      className="mt-2 text-[11px] font-semibold text-primary pressable underline-offset-2 hover:underline"
                    >
                      Jump to this month
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMonthCursor((d) => {
                    const x = new Date(d);
                    x.setMonth(x.getMonth() + 1);
                    return x;
                  })}
                  className="p-2 rounded-xl border border-soft surface-soft pressable shrink-0 mt-0.5"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border border-soft/80 bg-muted/15 px-3 py-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-secondary-fg">Month total</div>
                  <div className="font-display text-lg font-semibold tabular-nums">{fmtHM(monthTotal)}</div>
                </div>
                <div className="flex items-center gap-2 text-right">
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary-fg">Best day</div>
                    <div className="font-mono text-[12px] font-semibold tabular-nums text-foreground">{monthPeakSec > 0 ? fmtHM(monthPeakSec) : "0m"}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-wide text-secondary-fg">Active</div>
                    <div className="font-mono text-[12px] font-semibold tabular-nums text-foreground">{monthActiveDays}d</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-x-0.5 gap-y-1">
                {WEEKDAY_HEADERS.map((label) => (
                  <div key={label} className="text-center text-[10px] font-semibold uppercase tracking-wide text-secondary-fg py-0.5">
                    {label}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {monthCells.map((c, i) => {
                  if (!c) return <div key={`pad-${i}`} className="aspect-square min-h-[2.5rem]" aria-hidden />;
                  const intensity = c.total === 0 ? 0 : Math.min(1, c.total / monthMaxSec);
                  const isSelected = selectedDay === c.key;
                  const isToday = c.key === ymd(new Date());
                  const opacity = c.total === 0 ? 0 : 0.18 + intensity * 0.82;
                  const title = `${c.date!.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${fmtHM(c.total)}`;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      title={title}
                      aria-label={title}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDay(isSelected ? null : c.key)}
                      className={`aspect-square min-h-[2.5rem] rounded-lg flex flex-col items-center justify-center gap-0.5 pressable transition-[background-color,color,box-shadow,transform] duration-200 text-center px-0.5 ${
                        isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background z-[1]" : ""
                      } ${isToday && !isSelected ? "ring-1 ring-primary/50" : ""}`}
                      style={{
                        backgroundColor: c.total > 0 ? `hsl(var(--primary) / ${opacity})` : "hsl(var(--muted))",
                        color: intensity > 0.55 ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                      }}
                    >
                      <span className="text-[12px] font-semibold tabular-nums leading-none">{c.date!.getDate()}</span>
                      {c.total > 0 && (
                        <span className="text-[9px] font-mono tabular-nums leading-none opacity-90">{fmtHM(c.total)}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-soft text-[11px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-secondary-fg shrink-0">Color scale</span>
                  <div className="flex items-center gap-1">
                    <span className="text-faint">0m</span>
                    {[0.2, 0.45, 0.7, 1].map((o, idx) => (
                      <span key={idx} className="h-3 w-3 rounded-sm border border-border/80" style={{ backgroundColor: `hsl(var(--primary) / ${o})` }} />
                    ))}
                    <span className="text-faint">{monthPeakSec > 0 ? fmtHM(monthPeakSec) : "0m"}</span>
                  </div>
                </div>
                <span className="text-secondary-fg sm:text-right">
                  Tap a square for that day&apos;s sessions. Outline = today.
                </span>
              </div>
            </div>

            {dayDetail && <DayDetail detail={dayDetail} catMap={catMap} onEditEntry={openEditEntry} onDeleteEntry={openDeleteEntry} />}
          </div>
        )}

        {/* PDF export — placed at the bottom of the sheet, well clear of the X */}
        <div className="px-5 pt-3 pb-2">
          <button
            onClick={exportPDF}
            disabled={exporting || headerTotalSec === 0}
            className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-[14px] app-card py-0 text-sm font-medium text-foreground pressable disabled:opacity-40 disabled:pointer-events-none"
            aria-label="Export PDF"
            title={isPro ? `Export ${headerLabel} as PDF` : "PDF export is a Pro feature"}
          >
            {isPro ? <Download className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {isPro ? `Export ${headerLabel} as PDF` : "Export as PDF · Pro"}
          </button>
        </div>
        <div className="px-5 pb-6 pt-2 text-[11px] text-secondary-fg text-center">
          Tracking runs in the background — close the app and it keeps counting.
        </div>
      </Wrapper>
    {/* Biometric gate sheets — shown once on first access to protected features */}
    <BiometricGateSheet
      open={billingGateOpen}
      onClose={() => setBillingGateOpen(false)}
      feature="billing"
      onResult={(granted) => { if (granted) setBillingRevealed(true); }}
    />
    <BiometricGateSheet
      open={exportGateOpen}
      onClose={() => setExportGateOpen(false)}
      feature="export"
      onResult={(granted) => { if (granted) void runExport(); }}
    />
    <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
    <AlertDialog open={!!confirmDeleteCat} onOpenChange={(v) => { if (!v) setConfirmDeleteCat(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this category?</AlertDialogTitle>
          <AlertDialogDescription>
            {(() => {
              const n = categories.find(c => c.id === confirmDeleteCat)?.name;
              return n
                ? `"${n}" will be removed. Time entries logged under it will be unassigned.`
                : "This category will be removed.";
            })()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              const id = confirmDeleteCat;
              setConfirmDeleteCat(null);
              if (id) deleteCategory(id);
            }}
          >Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Per-session edit (adjust start) + delete — shared by every session list. */}
    <EntryStartSheet
      open={!!editEntry}
      entry={editEntry}
      onClose={() => setEditEntry(null)}
      onCommit={(d, reason) => {
        if (!editEntry) return;
        // Reason becomes an immutable audit field — not merged into the note.
        void updateEntryStart(editEntry.id, d, reason);
      }}
    />
    <EntryDeleteDialog
      open={!!deleteEntryTarget}
      onOpenChange={(o) => { if (!o) setDeleteEntryTarget(null); }}
      entry={deleteEntryTarget}
      onConfirm={() => { if (deleteEntryTarget) void deleteEntry(deleteEntryTarget.id); setDeleteEntryTarget(null); }}
    />
    </>
  );
}

/** Standalone full-screen tracker view used by the /tracker route. */
export function TrackerView() {
  return <TrackerInner embedded />;
}

/** Legacy bottom-sheet wrapper kept for any old callers. */
export function TrackerSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[24px] p-0 border-soft max-h-[92vh] flex flex-col bg-background/95 backdrop-blur-xl"
        style={{ paddingBottom: "var(--keyboard-inset, 0px)" }}
      >
        <SheetTitle className="sr-only">Time tracker</SheetTitle>
        <div className="flex-1 overflow-y-auto">
          <TrackerInner onClose={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ----- Sub-components -----

function StackedBar({ segments, totalSec }: { segments: Array<{ value: number; color: string; label: string }>; totalSec: number }) {
  const total = Math.max(1, totalSec);
  return (
    <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-muted">
      {segments.map((s, i) => (
        <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} aria-label={s.label} />
      ))}
    </div>
  );
}

type DayDetailData = { date: Date; total: number; byCat: Map<string, number>; items: Array<{ id: string; cat: TimeCategory | undefined; start: number; end: number; dur: number; fromPlanner: boolean }> };
/** Compact edit-start + delete actions for a single tracked-session row. */
function SessionActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 -mr-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-secondary-fg/55 hover:text-foreground hover:bg-foreground/[0.06] pressable transition-colors"
        aria-label="Adjust start time"
        title="Adjust start time"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-secondary-fg/55 hover:text-destructive hover:bg-destructive/10 pressable transition-colors"
        aria-label="Delete session"
        title="Delete session"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function DayDetail({ detail, catMap, onEditEntry, onDeleteEntry }: { detail: DayDetailData; catMap: Map<string, TimeCategory>; onEditEntry: (id: string) => void; onDeleteEntry: (id: string) => void }) {
  const byCat = Array.from(detail.byCat.entries() as IterableIterator<[string, number]>)
    .map(([id, sec]) => ({ cat: catMap.get(id), sec }))
    .filter(x => x.cat)
    .sort((a, b) => b.sec - a.sec);

  const dateLabel = detail.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  return (
    <div className="app-card px-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200 py-5">
      <div className="flex items-baseline justify-between">
        <div className="text-[14px] font-display font-semibold">{dateLabel}</div>
        <div className="text-xs text-secondary-fg">Total <span className="font-mono tabular-nums text-foreground">{fmtHM(detail.total)}</span></div>
      </div>

      {detail.total === 0 ? (
        <div className="py-6 text-center text-xs text-secondary-fg">No time tracked this day</div>
      ) : (
        <>
          <StackedBar segments={byCat.map(x => ({ value: x.sec, color: x.cat!.color, label: x.cat!.name }))} totalSec={detail.total} />

          <DayTimeline24h
            segments={detail.items.map((it) => ({
              id: it.id,
              start: it.start - detail.date.getTime(),
              end: it.end - detail.date.getTime(),
              color: it.cat?.color || "hsl(var(--muted-foreground))",
              name: it.cat?.name || "Untracked",
            }))}
          />

          <div className="space-y-1.5">
            {byCat.map(x => (
              <div key={x.cat!.id} className="flex items-center justify-between text-[13px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: x.cat!.color }} />
                  <span className="truncate">{x.cat!.name}</span>
                </div>
                <span className="font-mono tabular-nums text-secondary-fg">{fmtHM(x.sec)}</span>
              </div>
            ))}
          </div>

          {detail.items.length > 0 && (
            <div className="pt-2 mt-2 border-t border-soft">
              <div className="text-[11px] font-medium uppercase tracking-wide text-secondary-fg mb-2">Sessions</div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {detail.items.map((it) => {
                  const startStr = new Date(it.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                  const endStr = new Date(it.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={it.id} className="flex items-center gap-2 text-[12px]">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: it.cat?.color || "hsl(var(--muted-foreground))" }} />
                      <span className="w-[82px] shrink-0 font-mono tabular-nums text-secondary-fg">{startStr}–{endStr}</span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                        {it.fromPlanner ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-primary/25 bg-primary/[0.08] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary"
                            title="From day plan"
                          >
                            <ListTodo className="h-2.5 w-2.5" aria-hidden />
                            Plan
                          </span>
                        ) : null}
                        <span className="truncate">{it.cat?.name || "Uncategorized"}</span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-secondary-fg">{fmtHM(it.dur)}</span>
                      <SessionActions onEdit={() => onEditEntry(it.id)} onDelete={() => onDeleteEntry(it.id)} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 24h horizontal timeline. Segments expressed as offsets from start-of-day in ms.
function DayTimeline24h({ segments }: { segments: Array<{ id: string; start: number; end: number; color: string; name: string }> }) {
  const total = DAY_MS;
  return (
    <div>
      <div className="relative h-7 rounded-lg bg-muted overflow-hidden">
        {/* hour grid */}
        {Array.from({ length: 23 }, (_, i) => i + 1).map(h => (
          <div
            key={h}
            className={`absolute top-0 bottom-0 ${h % 6 === 0 ? "bg-border" : "bg-border/40"}`}
            style={{ left: `${(h / 24) * 100}%`, width: 1 }}
          />
        ))}
        {segments.map(s => {
          const left = (s.start / total) * 100;
          const width = Math.max(0.4, ((s.end - s.start) / total) * 100);
          return (
            <div
              key={s.id}
              title={`${s.name} · ${new Date(s.start).toUTCString().slice(17, 22)}–${new Date(s.end).toUTCString().slice(17, 22)}`}
              className="absolute top-1 bottom-1 rounded-sm"
              style={{ left: `${left}%`, width: `${width}%`, background: s.color }}
            />
          );
        })}
        {/* "now" indicator only if it's today (caller controls by passing today segments) */}
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-mono tabular-nums text-faint">
        <span>0</span><span>6</span><span>12</span><span>18</span><span>24</span>
      </div>
    </div>
  );
}

// Inline category drill-in: shown beneath a clicked category row.
function CategoryDetail({
  cat,
  stat,
  period,
  onEditEntry,
  onDeleteEntry,
}: {
  cat: TimeCategory;
  stat: { sec: number; sessions: Array<{ id: string; start: number; end: number; note: string | null; fromPlanner?: boolean }>; perDay: Map<string, number> } | undefined;
  period: { start: number; end: number; label: string; days: number };
  onEditEntry: (id: string) => void;
  onDeleteEntry: (id: string) => void;
}) {
  const sec = stat?.sec || 0;
  const sessions = stat?.sessions || [];
  const perDay = stat?.perDay || new Map<string, number>();
  const activeDays = perDay.size;
  const avgPerActiveDay = activeDays > 0 ? sec / activeDays : 0;
  const avgPerDay = period.days > 0 ? sec / period.days : 0;

  // last 5 sessions (most recent first)
  const recent = [...sessions].sort((a, b) => b.start - a.start).slice(0, 5);

  // hour-of-day histogram: when does this category usually run?
  const hourBuckets = new Array(24).fill(0);
  sessions.forEach(s => {
    let cursor = s.start;
    while (cursor < s.end) {
      const d = new Date(cursor);
      const hourStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
      const hourEnd = hourStart + 3_600_000;
      const slice = Math.min(s.end, hourEnd) - cursor;
      hourBuckets[d.getHours()] += slice / 1000;
      cursor = hourEnd;
    }
  });
  const maxHour = Math.max(1, ...hourBuckets);

  if (sec === 0) {
    return (
      <div className="px-3 pb-3 pt-1 border-t border-soft bg-black/[0.03] dark:bg-black/50">
        <div className="py-3 text-center text-[12px] text-secondary-fg">
          No activity in <span className="text-foreground">{period.label.toLowerCase()}</span> yet
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 pb-3 pt-2 border-t border-soft bg-black/[0.04] dark:bg-black/40 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label={period.label} value={fmtHM(sec)} />
        <Stat label="Avg / active day" value={fmtHM(avgPerActiveDay)} />
        <Stat label="Active days" value={`${activeDays}/${period.days}`} />
      </div>

      {/* Hour histogram */}
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-secondary-fg mb-1.5">Typical hours</div>
        <div className="flex items-end gap-[2px] h-12">
          {hourBuckets.map((v, h) => (
            <div
              key={h}
              className="flex-1 rounded-sm"
              style={{
                height: `${v > 0 ? Math.max(8, (v / maxHour) * 100) : 4}%`,
                background: v > 0 ? cat.color : "hsl(var(--muted))",
                opacity: v > 0 ? 0.4 + (v / maxHour) * 0.6 : 1,
              }}
              title={`${String(h).padStart(2, "0")}:00 · ${fmtHM(v)}`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[9px] font-mono tabular-nums text-faint">
          <span>0</span><span>6</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>

      {/* Recent sessions */}
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-secondary-fg mb-1.5">Recent sessions</div>
        <div className="space-y-1">
          {recent.map(s => {
            const dateStr = new Date(s.start).toLocaleDateString(undefined, { month: "short", day: "numeric" });
            const startStr = new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const endStr = new Date(s.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            return (
              <div key={s.id} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono tabular-nums text-secondary-fg w-[50px] shrink-0">{dateStr}</span>
                <span className="font-mono tabular-nums text-secondary-fg w-[82px] shrink-0">{startStr}–{endStr}</span>
                <span className="truncate flex-1 text-secondary-fg inline-flex items-center gap-1.5 min-w-0">
                  {s.fromPlanner ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-primary/25 bg-primary/[0.08] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary" title="From day plan">
                      <ListTodo className="h-2.5 w-2.5" aria-hidden />
                      Plan
                    </span>
                  ) : null}
                  <span className="truncate">{s.note || "—"}</span>
                </span>
                <span className="font-mono tabular-nums text-foreground shrink-0">{fmtHM((s.end - s.start) / 1000)}</span>
                <SessionActions onEdit={() => onEditEntry(s.id)} onDelete={() => onDeleteEntry(s.id)} />
              </div>
            );
          })}
        </div>
        {sessions.length > recent.length && (
          <div className="mt-1.5 text-[10px] text-faint">
            + {sessions.length - recent.length} more in this period
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg surface-soft px-2 py-1.5">
      <div className="text-[9px] font-medium uppercase tracking-wide text-secondary-fg truncate">{label}</div>
      <div className="text-[13px] font-mono tabular-nums font-semibold mt-0.5">{value}</div>
    </div>
  );
}

// Long-press detection: fires onLongPress after 500ms hold without movement.
function LongPressButton({
  children, onClick, onLongPress, className, ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  onLongPress: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const start = () => {
    fired.current = false;
    timer.current = window.setTimeout(() => {
      fired.current = true;
      try { navigator.vibrate?.(15); } catch { /* vibrate unsupported */ }
      onLongPress();
    }, 500);
  };
  const cancel = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      onPointerDown={start}
      onPointerUp={(e) => { cancel(); if (!fired.current) { e.preventDefault(); onClick(); } }}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

// Swipe-to-delete row. Drag left to reveal a delete action; release past threshold to confirm.
function SwipeRow({
  children, onDelete, disabled,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const lock = useRef<"none" | "x" | "y">("none");
  const THRESHOLD = 88;
  const MAX = 120;

  if (disabled) return <>{children}</>;

  const onPointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    startY.current = e.clientY;
    lock.current = "none";
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current === null || startY.current === null) return;
    const delta = e.clientX - startX.current;
    const deltaY = e.clientY - startY.current;
    if (lock.current === "none") {
      if (Math.abs(delta) < 8 && Math.abs(deltaY) < 8) return;
      lock.current = Math.abs(delta) > Math.abs(deltaY) ? "x" : "y";
    }
    if (lock.current === "y") return;
    if (delta < 0) setDx(Math.max(-MAX, delta));
    else if (dx < 0) setDx(Math.min(0, delta + dx));
  };
  const onPointerUp = () => {
    setDragging(false);
    if (dx <= -THRESHOLD) {
      setDx(-MAX);
      // brief delay to show "Delete" before action
      setTimeout(() => { onDelete(); setDx(0); }, 120);
    } else {
      setDx(0);
    }
    startX.current = null;
    startY.current = null;
    lock.current = "none";
  };

  return (
    <div className="relative">
      <div className={`absolute inset-0 flex items-center justify-end pr-5 rounded-xl transition-colors ${dx <= -THRESHOLD ? "bg-destructive/90 text-destructive-foreground" : "bg-muted text-secondary-fg"}`}>
        <div className="flex items-center gap-1.5 text-[12px] font-semibold">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </div>
      </div>
      <div
        className={`relative ${dragging ? "" : "transition-transform duration-200"}`}
        style={{ transform: `translateX(${dx}px)`, touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  );
}

// Inline manual entry: pick a duration (or type minutes) + optional note.
function ManualEntryRow({
  color, onSubmit, onCancel,
}: {
  color: string;
  onSubmit: (minutes: number, note?: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [mins, setMins] = useState<number>(15);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const QUICK = [15, 30, 45, 60, 90];
  const submit = async () => {
    const m = custom ? parseInt(custom, 10) : mins;
    if (!m || m <= 0 || m > 24 * 60) { toast.error("Enter 1–1440 minutes"); return; }
    await onSubmit(m, note.trim() || undefined);
    setCustom(""); setNote("");
  };
  return (
      <div className="px-3 pb-3 pt-1 border-t border-soft bg-black/[0.03] dark:bg-black/50 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="flex items-center gap-1.5 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary-fg mr-1">Log past</span>
        {QUICK.map(q => (
          <button
            key={q}
            onClick={() => { setMins(q); setCustom(""); }}
            className={`px-2 py-1 rounded-md text-[11px] font-mono tabular-nums pressable ${
              !custom && mins === q ? "text-primary-foreground" : "bg-muted text-secondary-fg"
            }`}
            style={!custom && mins === q ? { background: color } : undefined}
          >
            +{q}m
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          inputMode="numeric"
          placeholder="min"
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
          className="h-8 w-16 text-[12px] tabular-nums"
          style={{ fontSize: 16 }}
        />
        <Input
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-8 flex-1 text-[12px]"
          style={{ fontSize: 16 }}
        />
        <button onClick={onCancel} className="p-1.5 text-secondary-fg pressable" aria-label="Cancel">
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={submit}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium pressable"
        >
          <Check className="h-3 w-3" /> Log
        </button>
      </div>
    </div>
  );
}
