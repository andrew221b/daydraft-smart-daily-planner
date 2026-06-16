import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Play, Square, Plus, Search, ChevronDown, Wallet, Pencil, Trash2, Lock, Tag, FileText } from "lucide-react";
import { SessionNoteSheet, SessionTaskSheet } from "@/components/app/EntryEditSheet";
import { Callout } from "@/components/ui/callout";
import { useTimeTracker, subscribeElapsed, getElapsedSec, fmtHMS, fmtHM, subscribeWidgetStop, consumeWidgetStopMeta } from "@/hooks/useTimeTracker";
import { LiveElapsed } from "@/components/app/LiveElapsed";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { categoryBillingToDraft } from "@/lib/categoryBilling";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { PaymentMethodFields, type PaymentFieldsValue } from "@/components/app/PaymentMethodFields";
import { getPaymentMethod } from "@/lib/paymentMethods";
import { parseHourlyRate } from "@/lib/rateInput";
import { verifyBiometric, getGatePref } from "@/lib/biometricGate";
import { BiometricGateSheet } from "@/components/app/BiometricGateSheet";
import { useTabVisible } from "@/components/app/PersistentTabs";
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

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      // Always 2 decimals so the live earnings read consistently with cents
      // (e.g. +$0.00 → +$15.53), matching the Tracker and Reports.
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function FlipEarnings({ rate, currency }: { rate: number; currency: string }) {
  const [amt, setAmt] = useState(() => `+${fmtMoney(0, currency)}`);
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  useEffect(() => {
    visibleRef.current = false;
    setVisible(false);
    return subscribeElapsed((sec) => {
      const earned = (sec / 3600) * rate;
      if (!visibleRef.current && sec >= 0) {
        visibleRef.current = true;
        setAmt(`+${fmtMoney(earned, currency)}`);
        setVisible(true);
      }
      if (visibleRef.current && sec > 0) {
        setAmt(`+${fmtMoney(earned, currency)}`);
      }
    });
  }, [rate, currency]);

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-success/10 border border-success/20 px-3 py-1 tabular-nums overflow-hidden"
      style={{ perspective: 200 }}
    >
      <span className="text-[11px] font-medium text-success/65">earned</span>
      <span className="text-[14px] font-semibold text-success tabular-nums">
        {amt}
      </span>
    </motion.div>
  );
}

/**
 * HomeTrackerHero — the bold, primary surface of the app.
 * Tracker-first design: a luminous halo around the running timer,
 * a single hero CTA when idle, and quick category chips below.
 */
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

function NewCategoryForm({
  focusNewCategory,
  addingCategory,
  onAdd
}: {
  focusNewCategory: boolean;
  addingCategory: boolean;
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the new-category input ONLY when the user explicitly chose
  // "New category" (focusNewCategory). Previously a transient categoriesLength
  // of 0 (while categories were still loading) also focused — popping the
  // keyboard over the list when the user only wanted to pick / manage a
  // category. Opening the picker to choose now never raises the keyboard.
  useEffect(() => {
    if (!focusNewCategory) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, [focusNewCategory]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || addingCategory) return;
    onAdd(trimmed);
    setName("");
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-border/65 px-5 pt-4 shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}>
      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border/75 bg-card/35 px-3 py-2.5">
        <Plus className="h-4 w-4 text-secondary-fg shrink-0" />
        <input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New category name"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-secondary-fg/65"
          style={{ fontSize: 16 }}
        />
        {name.trim() && (
          <button
            type="submit"
            disabled={addingCategory}
            className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground pressable disabled:opacity-60"
          >
            <Check className="h-3 w-3" />
            Add
          </button>
        )}
      </div>
    </form>
  );
}

function StartSessionPrompt({
  categoryId,
  onClose,
  onStart,
}: {
  categoryId: string | null;
  onClose: () => void;
  onStart: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (categoryId) setTitle("");
  }, [categoryId]);

  return (
    <Sheet open={!!categoryId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-[28px] p-0 flex flex-col bg-popover border-border/75 transition-[padding-bottom] duration-200" style={{ paddingBottom: "var(--keyboard-inset, 0px)" }} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="px-5 pt-6 pb-4">
          <SheetTitle className="font-display text-[20px] font-semibold tracking-tight">Name this session</SheetTitle>
          <p className="text-[13px] text-secondary-fg/80 mt-1">Optional. What will you be working on?</p>
        </div>
        <div className="px-5 pb-5 flex flex-col gap-4">
          <Input 
            autoFocus
            placeholder="e.g. Design homepage..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onStart(title);
              }
            }}
            className="h-12 rounded-xl text-[15px] border border-black/[0.08] dark:border-white/[0.09] bg-black/[0.04] dark:bg-white/[0.04] px-4 outline-none focus:border-primary/55 transition-colors placeholder:text-secondary-fg/55 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06)] dark:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.05)]"
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 rounded-xl h-12 text-[14px]" onClick={() => onStart("")}>Skip</Button>
            <Button className="flex-1 rounded-xl h-12 text-[14px] font-semibold" onClick={() => onStart(title)}>Start</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function HomeTrackerHero({ onOpenDetails }: { onOpenDetails: () => void }) {
  const { isPro } = useEntitlement();
  const {
    active,
    categories,
    allCatMap,
    start,
    stop,
    switchCategory,
    addCategory,
    deleteCategory,
    renameCategory,
    todayTotalSec,
    updateCategoryRate,
    updateCategoryBilling,
    updateEntryNote,
    updateEntryTaskTitle,
  } = useTimeTracker();
  const activeCat = categories.find((c) => c.id === active?.category_id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noteSheetOpen, setNoteSheetOpen] = useState(false);
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  // Stop flow: STOP the session first, then optionally attach a note. Because
  // `active` is null the instant the session stops, we snapshot what the note
  // sheet needs (entry id + category chrome) at stop time. `notePrompt` drives
  // the Yes/No dialog; `noteEditor` drives the actual note input sheet.
  type StoppedSessionMeta = { entryId: string; note: string; categoryName?: string; categoryColor?: string };
  const [stopBusy, setStopBusy] = useState(false);
  const [notePrompt, setNotePrompt] = useState<StoppedSessionMeta | null>(null);
  const [noteEditor, setNoteEditor] = useState<StoppedSessionMeta | null>(null);

  const handleStop = async () => {
    if (!active || stopBusy) return;
    const meta: StoppedSessionMeta = {
      entryId: active.id,
      note: active.note ?? "",
      categoryName: activeCat?.name,
      categoryColor: activeCat?.color,
    };
    setStopBusy(true);
    haptics.impact("medium");
    const ok = await stop();
    setStopBusy(false);
    // Only offer the note prompt once the session is actually stopped.
    if (ok) setNotePrompt(meta);
  };

  // When the tracker is stopped from the Live Activity widget, the in-app stop
  // button never fires — so `handleStop` never runs. Subscribe to the module-
  // level signal that `stop({ fromWidget: true })` emits and open the same note
  // prompt so widget users get the same post-stop UX.
  useEffect(() => {
    return subscribeWidgetStop(() => {
      const m = consumeWidgetStopMeta();
      if (!m) return;
      const cat = allCatMap.get(m.categoryId ?? "");
      setNotePrompt({ entryId: m.entryId, note: m.note, categoryName: cat?.name, categoryColor: cat?.color });
    });
  }, [allCatMap]);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [focusNewCategory, setFocusNewCategory] = useState(false);
  const [draftRate, setDraftRate] = useState("");
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingExpanded, setBillingExpanded] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetailsDraft>(emptyPaymentDetails);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [bioGateIntent, setBioGateIntent] = useState<"expand" | "payment" | false>(false);
  // Picker-sheet inline manage state — long-press a row to edit/delete it
  // without leaving the picker. Surfaces what was previously only
  // discoverable via the tracker page's swipe-row affordance.
  const [manageCatId, setManageCatId] = useState<string | null>(null);
  const [manageName, setManageName] = useState("");
  const [manageBusy, setManageBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingStartCatId, setPendingStartCatId] = useState<string | null>(null);
  const chipsScrollRef = useRef<HTMLDivElement>(null);

  const selectedCat = categories.find((c) => c.id === selectedCategoryId) || null;
  const savedRateStr = selectedCat?.hourly_rate == null ? "" : String(selectedCat.hourly_rate);

  // Scroll chip row back to the start whenever selected category changes so
  // the highlighted chip (always at position 0 in orderedCats) is immediately visible.
  useEffect(() => {
    chipsScrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [selectedCategoryId]);
  const rateDirty = draftRate.replace(",", ".").trim() !== savedRateStr;
  const accent = activeCat?.color || selectedCat?.color || "hsl(var(--primary))";
  // Always put the selected category first so it stays visible even when
  // there are 5+ categories and some are hidden behind "More".
  const orderedCats = useMemo(() => {
    if (!selectedCategoryId) return categories;
    const sel = categories.find((c) => c.id === selectedCategoryId);
    if (!sel) return categories;
    return [sel, ...categories.filter((c) => c.id !== selectedCategoryId)];
  }, [categories, selectedCategoryId]);
  const topCats = orderedCats.slice(0, 4);
  const moreCats = orderedCats.slice(4);
  const filteredCategories = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, categoryQuery]);



  useEffect(() => {
    if (active?.category_id) {
      setSelectedCategoryId(active.category_id);
      return;
    }
    if (selectedCategoryId && categories.some((c) => c.id === selectedCategoryId)) return;
    setSelectedCategoryId(categories[0]?.id ?? null);
  }, [active?.category_id, categories, selectedCategoryId]);

  useEffect(() => {
    if (!selectedCat) return;
    setDraftRate(selectedCat.hourly_rate == null ? "" : String(selectedCat.hourly_rate));
  }, [selectedCat]);

  useEffect(() => {
    if (!billingOpen || !selectedCat) return;
    setPaymentDetails(categoryBillingToDraft(selectedCat));
  }, [billingOpen, selectedCat]);

  const tabVisible = useTabVisible();

  // Close billing sheet + inline payment section when leaving this tab,
  // stopping the timer, or backgrounding the app — same policy as TrackerPill.
  useEffect(() => {
    if (!tabVisible) {
      setBillingOpen(false);
      setBillingExpanded(false);
    }
  }, [tabVisible]);

  useEffect(() => {
    if (!active) {
      setBillingOpen(false);
      setBillingExpanded(false);
    }
  }, [active]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        setBillingOpen(false);
        setBillingExpanded(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const saveRate = async (silent = false) => {
    if (!selectedCat) return;
    const parsed = parseHourlyRate(draftRate);
    // Garbage input (letters, symbols, "0123") — never silently report "saved".
    // On an explicit Save, tell the user the format is wrong and keep the
    // existing rate; on blur, stay quiet but still don't overwrite the rate.
    if (parsed.kind === "invalid") {
      if (!silent) toast.error("Invalid rate — enter a number like 25 or 25.50");
      return;
    }
    const rateNorm = parsed.kind === "cleared" ? null : parsed.value;
    setRateSaving(true);
    try {
      await updateCategoryRate(selectedCat.id, rateNorm);
      if (!silent) toast.success(rateNorm === null ? "Hourly rate cleared" : "Hourly rate saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setRateSaving(false);
    }
  };

  const savePaymentDetails = async () => {
    if (!selectedCat) return;
    if (!isPro) {
      setUpgradeOpen(true);
      return;
    }
    setPaymentSaving(true);
    try {
      await updateCategoryBilling(selectedCat.id, paymentDetails);
      toast.success("Payment details saved");
      setBillingOpen(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setPaymentSaving(false);
    }
  };

  const beginManage = (id: string, name: string) => {
    setManageCatId(id);
    setManageName(name);
  };

  const commitManageRename = async () => {
    if (!manageCatId) return;
    const next = manageName.trim();
    const current = categories.find((c) => c.id === manageCatId);
    if (!current || !next || next === current.name) {
      setManageCatId(null);
      return;
    }
    setManageBusy(true);
    try {
      await renameCategory(manageCatId, next);
      toast.success("Renamed");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't rename");
    } finally {
      setManageBusy(false);
      setManageCatId(null);
    }
  };

  const performDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    setManageCatId(null);
    try {
      await deleteCategory(id);
      toast.success("Category deleted");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete");
    }
  };

  const openCategoryPicker = (opts?: { focusAdd?: boolean }) => {
    setPickerOpen(true);
    setFocusNewCategory(!!opts?.focusAdd);
    if (opts?.focusAdd) {
      setCategoryQuery("");
    }
  };

  const chooseCategory = async (id: string) => {
    setPickerOpen(false);
    if (active) {
      await switchCategory(id);
      return;
    }
    setSelectedCategoryId(id);
  };

  const handleAddCategory = async (name: string) => {
    setAddingCategory(true);
    try {
      const cat = await addCategory(name);
      if (cat) {
        setSelectedCategoryId(cat.id);
        setCategoryQuery("");
      }
    } finally {
      setAddingCategory(false);
    }
  };

  return (
    <section
      data-tour="hero-tracker"
      className={`relative overflow-hidden rounded-[28px] hero-glass border px-5 pt-6 pb-5 transition-[border-color,background-color,box-shadow,transform] duration-[320ms] ease-out ${
        active
          ? "tracker-hero-clock border-[color-mix(in_srgb,var(--hero-accent)_45%,hsl(var(--border)/0.5))]"
          : "border-border/65"
      }`}
      style={{ "--hero-accent": accent } as CSSProperties}
    >
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-fg/70">
            {active ? "Recording" : "Time tracker"}
          </span>
          <button
            type="button"
            onClick={onOpenDetails}
            className="text-[12px] font-medium text-secondary-fg/80 hover:text-foreground transition-colors pressable"
          >
            All stats →
          </button>
        </div>

        {/* Hero timer */}
        <div className="mt-4 flex flex-col items-center text-center">
          {active && activeCat ? (
            <>
              <div className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.07] px-3 py-1 border border-border/60">
                <span
                  className="h-1.5 w-1.5 rounded-full animate-pulse shadow-[0_0_0_3px_color-mix(in_srgb,var(--hero-accent)_22%,transparent)]"
                  style={{ background: accent }}
                />
                <span className="text-[12px] font-medium text-foreground/85 truncate max-w-[14rem]">
                  {activeCat.name}
                </span>
              </div>

              {/* Task title + notes — one row, balanced around a centred
                  divider: the name hugs the divider from the left, the note
                  from the right, so the pair reads dead-centre and never wraps
                  (each side truncates within its half). */}
              <div className="mt-2 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1.5 px-2">
                <button
                  type="button"
                  onClick={() => { haptics.tap(); setTaskSheetOpen(true); }}
                  className="min-w-0 justify-self-end inline-flex items-center justify-end gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] pressable transition-colors hover:bg-foreground/[0.05]"
                  aria-label={active.task_title ? "Edit task name" : "Name this task"}
                >
                  {active.task_title ? (
                    <>
                      <span className="truncate font-medium text-foreground/90">{active.task_title}</span>
                      <Pencil className="h-3 w-3 shrink-0 text-secondary-fg/45" />
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-secondary-fg/65 whitespace-nowrap">
                      <Tag className="h-3 w-3" />
                      Task name
                    </span>
                  )}
                </button>
                <div className="h-3 w-px bg-border/60 shrink-0" />
                <button
                  type="button"
                  onClick={() => { haptics.tap(); setNoteSheetOpen(true); }}
                  className="min-w-0 justify-self-start inline-flex items-center justify-start gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] pressable transition-colors hover:bg-foreground/[0.05]"
                  aria-label={active.note ? "Edit notes" : "Add notes"}
                >
                  {active.note ? (
                    <>
                      <span className="truncate font-medium text-foreground/90">{active.note}</span>
                      <Pencil className="h-3 w-3 shrink-0 text-secondary-fg/45" />
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-secondary-fg/65 whitespace-nowrap">
                      <FileText className="h-3 w-3" />
                      Notes
                    </span>
                  )}
                </button>
              </div>

              <div className="mt-3 breathe">
                <LiveElapsed
                  format={fmtHMS}
                  className="font-display text-[3.4rem] font-semibold tabular-nums leading-none tracking-[-0.04em] text-foreground"
                />
              </div>
              {(() => {
                // Use only the snapshot rate captured when this session started.
                // Changing the category rate mid-session must not alter the live
                // earnings display — the session is billed at the rate it began with.
                const currentSessionRate = active?.snapshot_hourly_rate;
                if (!currentSessionRate || currentSessionRate <= 0) return null;
                return (
                  <FlipEarnings
                    rate={currentSessionRate}
                    currency={activeCat?.currency || "USD"}
                  />
                );
              })()}
              <button
                type="button"
                onClick={() => void handleStop()}
                disabled={stopBusy}
                className="tracker-stop-btn mt-4 inline-flex items-center gap-2 rounded-full text-white px-7 py-3 text-[14px] font-semibold pressable btn-volumetric-danger disabled:opacity-60"
              >
                <Square className="h-3.5 w-3.5" fill="currentColor" />
                {stopBusy ? "Stopping…" : "Stop"}
              </button>
              {categories.length > 1 && (
                <button
                  type="button"
                  onClick={() => openCategoryPicker()}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/75 bg-background/45 px-4 py-2 text-[12px] font-semibold text-secondary-fg/90 pressable hover:text-foreground"
                >
                  Switch category
                  <ChevronDown className="h-3 w-3" />
                </button>
              )}
            </>
          ) : (
            <>
              <span className="text-[11px] font-medium text-secondary-fg/70">Tracked today</span>
              <div className="mt-1 font-display text-[3.4rem] font-semibold tabular-nums leading-none tracking-[-0.04em] text-foreground">
                {fmtHM(todayTotalSec)}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (categories.length === 0) {
                    haptics.tap();
                    openCategoryPicker({ focusAdd: true });
                    return;
                  }
                  if (selectedCat) {
                    haptics.tap();
                    setPendingStartCatId(selectedCat.id);
                    return;
                  }
                  haptics.tap();
                  openCategoryPicker();
                }}
                className="tracker-start-btn gleam mt-4 inline-flex items-center gap-2 rounded-full text-primary-foreground px-8 py-3.5 text-[14px] font-semibold pressable btn-volumetric"
              >
                <Play className="h-3.5 w-3.5" fill="currentColor" />
                Start tracking
              </button>
            </>
          )}
        </div>

        {/* Quick category chips when idle */}
        {!active && topCats.length > 0 && (
          <div ref={chipsScrollRef} className="mt-4 -mx-1 flex gap-1.5 overflow-x-auto pb-1 px-1 no-scrollbar">
            {topCats.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { haptics.selection(); setSelectedCategoryId(c.id); }}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border py-1.5 pl-2 pr-3 text-[12px] font-medium transition-colors pressable ${
                  selectedCategoryId === c.id
                    ? "border-primary/50 bg-primary/[0.12] text-foreground ring-[1.5px] ring-primary/20"
                    : "border-border/65 bg-black/[0.05] dark:bg-white/[0.05] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.08]"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                <span className="max-w-[8rem] truncate">{c.name}</span>
              </button>
            ))}
            {moreCats.length > 0 && (
              <button
                type="button"
                onClick={() => openCategoryPicker()}
                className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/40 py-1.5 px-2.5 text-[12px] font-medium text-secondary-fg/85 hover:text-foreground pressable"
              >
                <ChevronDown className="h-3 w-3" />
                More
              </button>
            )}
            <button
              type="button"
              onClick={() => openCategoryPicker({ focusAdd: true })}
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-dashed border-border/90 bg-transparent py-1.5 px-2.5 text-[12px] font-medium text-secondary-fg/80 hover:text-foreground pressable"
            >
              <Plus className="h-3 w-3" />
              New
            </button>
          </div>
        )}
        {!active && topCats.length === 0 && (
          <p className="mt-4 text-center text-[13px] text-secondary-fg/75">
            Tap{" "}
            <button onClick={() => openCategoryPicker({ focusAdd: true })} className="font-semibold text-primary underline-offset-4 hover:underline">
              set up
            </button>{" "}
            to add your first category.
          </p>
        )}
        {/* Billing — collapsed by default, tap to expand. */}
        {!active && selectedCat && (
          <div className="mt-3 rounded-2xl border border-border/80 bg-card overflow-hidden shadow-sm">
            {/* Accordion header */}
            <button
              type="button"
              onClick={async () => {
                if (billingExpanded) {
                  setBillingExpanded(false);
                } else {
                  if (!isPro) {
                    setUpgradeOpen(true);
                    return;
                  }
                  if (getGatePref() === "unset") {
                    setBioGateIntent("expand");
                    return;
                  }
                  const allowed = await verifyBiometric("Access Rate & Billing");
                  if (allowed) setBillingExpanded(true);
                }
              }}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-foreground/[0.02] transition-colors"
              style={{ WebkitTapHighlightColor: "transparent" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-foreground/75">Rate & Billing</span>
                {!billingExpanded && selectedCat.hourly_rate != null && (
                  <span className="inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                    {fmtMoney(selectedCat.hourly_rate, selectedCat.currency || "USD")}/h
                  </span>
                )}
              </div>
              {!isPro ? (
                <Lock className="h-3 w-3 text-secondary-fg/50" />
              ) : (
                <ChevronDown
                  className={`h-3.5 w-3.5 text-secondary-fg/50 transition-transform duration-200 ${billingExpanded ? "rotate-180" : ""}`}
                />
              )}
            </button>

            {/* Accordion body — same height-tween as the timeline task cards
                (SortableBlock): a real height:auto animation, no max-height
                magic number, no press-scale on the header (which used to clip
                the rounded card and flash white behind it). Once open it rests
                at height:auto, so focusing the rate input / the keyboard never
                triggers a re-measure. */}
            <AnimatePresence initial={false}>
              {billingExpanded && (
                <motion.div
                  key="billing-expand"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "tween", duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                  style={{ overflow: "hidden" }}
                >
                  {/* Divider between header and content */}
                  <div className="h-px bg-border/40 mx-4" />

                  <div className="px-4 pb-4 flex flex-col gap-3.5 pt-3.5">
                {/* Hourly rate row */}
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/55 mb-1.5">Hourly rate</p>
                  <div className="flex items-center gap-2">
                    <Input
                      inputMode="decimal"
                      value={draftRate}
                      onChange={(e) => setDraftRate(e.target.value)}
                      onBlur={() => { if (rateDirty && !rateSaving) void saveRate(true); }}
                      onFocus={(e) => {
                        const len = e.target.value.length;
                        e.target.setSelectionRange(len, len);
                      }}
                      placeholder="0.00"
                      className="flex-1 h-10 rounded-xl bg-foreground/[0.04] text-[13px] font-mono tabular-nums border-border/70 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:border-primary/40"
                    />
                    {rateDirty && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={rateSaving}
                        onClick={() => void saveRate(false)}
                        className="h-10 rounded-xl text-[12px] font-semibold px-4 shrink-0"
                      >
                        {rateSaving ? "Saving…" : "Save"}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Payment method row */}
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/55 mb-1.5">Payment method</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isPro) { setUpgradeOpen(true); return; }
                      setBillingOpen(true);
                    }}
                    className="group relative flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left pressable active:scale-[0.99] transition-all"
                    style={(() => {
                      const m = getPaymentMethod(selectedCat.payment_method);
                      if (!m) return { borderColor: "hsl(var(--border) / 0.45)", background: "hsl(var(--foreground) / 0.03)" };
                      return {
                        borderColor: `hsl(${m.accent} / 0.35)`,
                        background: `linear-gradient(135deg, hsl(${m.accent} / 0.08) 0%, hsl(${m.accent} / 0.03) 100%)`,
                      };
                    })()}
                  >
                    {(() => {
                      const m = getPaymentMethod(selectedCat.payment_method);
                      const cur = (selectedCat.currency || "USD").toUpperCase();
                      if (m) {
                        const Icon = m.Icon;
                        return (
                          <>
                            <span
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                              style={{ background: `hsl(${m.accent} / 0.28)`, color: `hsl(${m.accent})` }}
                            >
                              <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
                            </span>
                            <span className="min-w-0 flex-1 text-[13px] font-semibold text-foreground truncate leading-tight">
                              {m.label}
                            </span>
                            <span
                              className="shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums tracking-[0.04em]"
                              style={{ background: `hsl(${m.accent} / 0.18)`, color: `hsl(${m.accent} / 0.9)` }}
                            >
                              {cur}
                            </span>
                          </>
                        );
                      }
                      return (
                        <>
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-secondary-fg">
                            <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
                          </span>
                          <span className="min-w-0 flex-1 text-[13px] font-medium text-secondary-fg/80 truncate leading-tight">
                            Add payment details
                          </span>
                          <span className="shrink-0 inline-flex items-center rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums tracking-[0.04em] text-secondary-fg/60">
                            {cur}
                          </span>
                        </>
                      );
                    })()}
                    <ChevronDown className="h-4 w-4 -rotate-90 text-secondary-fg/55 shrink-0" />
                  </button>
                </div>
              </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <Sheet
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setFocusNewCategory(false);
        }}
      >
        <SheetContent side="bottom" className="rounded-t-[28px] p-0 flex flex-col bg-popover border-border/75 transition-[padding-bottom] duration-200" style={{ maxHeight: "84vh", paddingBottom: "var(--keyboard-inset, 0px)" }} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-5 pt-3 pb-4 border-b border-border/65 shrink-0">
              <SheetTitle className="font-display text-[20px] font-semibold tracking-tight">
                {active ? "Switch category" : "Choose category"}
              </SheetTitle>
              <p className="text-[13px] text-secondary-fg/80 mt-1">
                {active ? "Pick a category and the current session will continue there." : "Pick a category, then press Start tracking."}
              </p>
              {categories.length > 6 && (
                <label className="mt-4 flex items-center gap-2 rounded-2xl border border-border/75 bg-card/55 px-3 py-2.5">
                  <Search className="h-4 w-4 text-secondary-fg shrink-0" />
                  <input
                    value={categoryQuery}
                    onChange={(event) => setCategoryQuery(event.target.value)}
                    placeholder="Search categories"
                    className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-secondary-fg/65"
                  />
                </label>
              )}
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {filteredCategories.length > 0 ? (
                <div className="grid grid-cols-1 gap-2.5">
                  {filteredCategories.map((c) => {
                    const isCurrent = active?.category_id === c.id;
                    const isSelected = !active && selectedCategoryId === c.id;
                    const isManaging = manageCatId === c.id;
                    // Each row turns into an inline rename + delete editor when
                    // the user taps the pencil icon — keeps category mgmt inside
                    // the picker instead of bouncing to a hidden tracker page.
                    if (isManaging) {
                      return (
                        <div
                          key={c.id}
                          className="rounded-2xl border border-primary/40 bg-primary/[0.06] px-3.5 py-3 space-y-2.5"
                          style={{ borderColor: `${c.color}88` }}
                        >
                          <div className="flex items-center gap-3">
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                            <Input
                              value={manageName}
                              onChange={(e) => setManageName(e.target.value)}
                              autoFocus
                              maxLength={40}
                              className="flex-1 h-9 bg-card/55 border-border/70 rounded-xl text-[14px] font-semibold"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commitManageRename();
                                if (e.key === "Escape") setManageCatId(null);
                              }}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={manageBusy || !manageName.trim()}
                              onClick={() => void commitManageRename()}
                              className="flex-1 h-9 rounded-xl text-[12px] font-semibold"
                            >
                              {manageBusy ? "Saving…" : "Save"}
                            </Button>
                            <button
                              type="button"
                              onClick={() => setManageCatId(null)}
                              className="h-9 px-3.5 rounded-xl border border-border/70 bg-card/40 text-[12px] font-medium text-secondary-fg/85 pressable hover:text-foreground"
                            >
                              Cancel
                            </button>
                            {!c.is_default && !isCurrent && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(c.id)}
                                className="h-9 w-9 inline-flex items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 text-destructive pressable hover:bg-destructive/10"
                                aria-label="Delete category"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {c.is_default && (
                            <p className="text-[11px] text-secondary-fg/70 leading-snug">
                              This is your default category — it can be renamed but not deleted.
                            </p>
                          )}
                          {isCurrent && !c.is_default && (
                            <p className="text-[11px] text-secondary-fg/70 leading-snug">
                              Stop tracking before deleting this category.
                            </p>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={c.id}
                        className={`group flex items-stretch gap-1 rounded-2xl border border-border/75 bg-card/60 transition-colors ${
                          isCurrent ? "opacity-90" : isSelected ? "ring-1 ring-primary/25 bg-primary/10" : "hover:bg-card/90"
                        }`}
                        style={{ borderColor: `${c.color}55` }}
                      >
                        <button
                          type="button"
                          onClick={() => chooseCategory(c.id)}
                          disabled={isCurrent}
                          className="flex flex-1 items-center gap-3 px-3.5 py-3.5 text-left pressable rounded-l-2xl min-w-0"
                        >
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground/95">{c.name}</span>
                          {isCurrent && <span className="text-[11px] font-semibold text-primary shrink-0">Current</span>}
                          {isSelected && !isCurrent && <span className="text-[11px] font-semibold text-primary shrink-0">Selected</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => beginManage(c.id, c.name)}
                          className="shrink-0 px-3 inline-flex items-center justify-center text-secondary-fg/65 hover:text-foreground pressable rounded-r-2xl"
                          aria-label={`Rename or delete ${c.name}`}
                          title="Rename or delete"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/75 px-4 py-6 text-center text-[13px] text-secondary-fg/80">
                  No categories match your search.
                </div>
              )}
            </div>

            <NewCategoryForm
              focusNewCategory={focusNewCategory}
              addingCategory={addingCategory}
              onAdd={handleAddCategory}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Name the running session ("what you worked on"). */}
      <SessionNoteSheet
        open={noteSheetOpen}
        onClose={() => setNoteSheetOpen(false)}
        initialNote={active?.note ?? ""}
        categoryName={activeCat?.name}
        categoryColor={activeCat?.color}
        onSave={(note) => { if (active) void updateEntryNote(active.id, note); }}
      />

      <Sheet open={billingOpen} onOpenChange={setBillingOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-[28px] border-border/75 bg-popover max-h-[90vh] overflow-y-auto p-0"
        >
          <div>
            <div className="px-5 pt-6 pb-4">
              <SheetHeader className="text-left space-y-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">
                  Payment for
                </p>
                <SheetTitle className="font-display text-[22px] font-semibold tracking-tight mt-1">
                  {selectedCat?.name ?? "Category"}
                </SheetTitle>
              </SheetHeader>
              <Callout variant="info" className="mt-3 py-2">
                <p className="text-[12px] leading-relaxed">
                  Select a payment method. Use a payment link for cards, never raw card numbers.
                </p>
              </Callout>
            </div>

            <div className="px-5 pb-6 space-y-4">
              {billingOpen && (
                <PaymentMethodFields
                  value={paymentDetails as PaymentFieldsValue}
                  onChange={(field, val) => setPaymentDetails((p) => ({ ...p, [field]: val }))}
                />
              )}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBillingOpen(false)}
                  className="h-12 flex-1 rounded-2xl text-[14px] font-medium border-soft"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={paymentSaving}
                  onClick={() => void savePaymentDetails()}
                  className="flex-[2] h-12 rounded-2xl text-[14px] font-semibold gleam btn-volumetric"
                >
                  {paymentSaving ? "Saving…" : "Save details"}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <BiometricGateSheet
        open={!!bioGateIntent}
        onClose={() => setBioGateIntent(false)}
        feature="billing"
        onResult={(success) => {
          if (success) {
            if (bioGateIntent === "expand") setBillingExpanded(true);
            else if (bioGateIntent === "payment") setBillingOpen(true);
          }
          setBioGateIntent(false);
        }}
      />

      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this category?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const target = categories.find((c) => c.id === confirmDeleteId);
                return target
                  ? `“${target.name}” will be removed. Any time tracked under it stays in your history but won't be assignable to this category anymore.`
                  : "This category will be removed.";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void performDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StartSessionPrompt
        categoryId={pendingStartCatId}
        onClose={() => setPendingStartCatId(null)}
        onStart={(title) => {
          if (!pendingStartCatId) return;
          const id = pendingStartCatId;
          setPendingStartCatId(null);
          haptics.impact("medium");
          void start(id, title.trim() ? { taskTitle: title.trim() } : undefined);
        }}
      />

      <SessionTaskSheet
        open={taskSheetOpen}
        onClose={() => setTaskSheetOpen(false)}
        initialTitle={active?.task_title ?? ""}
        categoryName={activeCat?.name}
        categoryColor={activeCat?.color}
        onSave={(task) => {
          if (active) void updateEntryTaskTitle(active.id, task);
        }}
      />

      {/* After Stop: ask whether to add a note. The session is already stopped. */}
      <AlertDialog open={!!notePrompt} onOpenChange={(o) => !o && setNotePrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a note?</AlertDialogTitle>
            <AlertDialogDescription>
              Session stopped. Want to add notes about what you worked on?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setNotePrompt(null)}>No</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setNoteEditor(notePrompt); setNotePrompt(null); }}>
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SessionNoteSheet
        open={!!noteEditor}
        onClose={() => setNoteEditor(null)}
        initialNote={noteEditor?.note ?? ""}
        categoryName={noteEditor?.categoryName}
        categoryColor={noteEditor?.categoryColor}
        onSave={(note) => { if (noteEditor) void updateEntryNote(noteEditor.entryId, note); }}
      />
    </section>
  );
}
