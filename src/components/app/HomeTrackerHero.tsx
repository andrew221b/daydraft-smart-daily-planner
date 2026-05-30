import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Play, Square, Plus, Search, ChevronDown, Wallet, Pencil, Trash2 } from "lucide-react";
import { useTimeTracker, subscribeElapsed, getElapsedSec, fmtHMS, fmtHM } from "@/hooks/useTimeTracker";
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
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function FlipEarnings({ rate, currency }: { rate: number; currency: string }) {
  const [amt, setAmt] = useState(() => `+${fmtMoney(0, currency)}`);
  const [visible, setVisible] = useState(false);
  const [flipKey, setFlipKey] = useState(0);
  const visibleRef = useRef(false);
  const prevMinRef = useRef(-1);

  useEffect(() => {
    prevMinRef.current = -1;
    visibleRef.current = false;
    setVisible(false);
    return subscribeElapsed((sec) => {
      const earned = (sec / 3600) * rate;
      const min = Math.floor(sec / 60);
      if (!visibleRef.current && sec >= 0) {
        visibleRef.current = true;
        setAmt(`+${fmtMoney(earned, currency)}`);
        setVisible(true);
      }
      if (visibleRef.current && min !== prevMinRef.current && min > 0) {
        prevMinRef.current = min;
        setAmt(`+${fmtMoney(earned, currency)}`);
        setFlipKey((k) => k + 1);
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
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={flipKey}
          className="text-[14px] font-semibold text-success"
          initial={{ y: -12, rotateX: -40, opacity: 0 }}
          animate={{ y: 0, rotateX: 0, opacity: 1 }}
          exit={{ y: 12, rotateX: 40, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
          style={{ display: "inline-block", transformOrigin: "50% 50%" }}
        >
          {amt}
        </motion.span>
      </AnimatePresence>
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

export function HomeTrackerHero({ onOpenDetails }: { onOpenDetails: () => void }) {
  const { isPro } = useEntitlement();
  const {
    active,
    categories,
    start,
    stop,
    switchCategory,
    addCategory,
    deleteCategory,
    renameCategory,
    todayTotalSec,
    updateCategoryRate,
    updateCategoryBilling,
  } = useTimeTracker();
  const activeCat = categories.find((c) => c.id === active?.category_id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [focusNewCategory, setFocusNewCategory] = useState(false);
  const newCategoryInputRef = useRef<HTMLInputElement | null>(null);
  const [draftRate, setDraftRate] = useState("");
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingExpanded, setBillingExpanded] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetailsDraft>(emptyPaymentDetails);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Picker-sheet inline manage state — long-press a row to edit/delete it
  // without leaving the picker. Surfaces what was previously only
  // discoverable via the tracker page's swipe-row affordance.
  const [manageCatId, setManageCatId] = useState<string | null>(null);
  const [manageName, setManageName] = useState("");
  const [manageBusy, setManageBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const selectedCat = categories.find((c) => c.id === selectedCategoryId) || null;
  const savedRateStr = selectedCat?.hourly_rate == null ? "" : String(selectedCat.hourly_rate);
  const rateDirty = draftRate.replace(",", ".").trim() !== savedRateStr;
  const accent = activeCat?.color || selectedCat?.color || "hsl(var(--primary))";
  const topCats = categories.slice(0, 4);
  const moreCats = categories.slice(4);
  const filteredCategories = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, categoryQuery]);

  useEffect(() => {
    if (!pickerOpen || !focusNewCategory) return;
    const id = window.setTimeout(() => newCategoryInputRef.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, [pickerOpen, focusNewCategory]);

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

  const saveRate = async (silent = false) => {
    if (!selectedCat) return;
    const cleaned = draftRate.replace(",", ".").trim();
    const rateNum = cleaned === "" ? null : Number(cleaned);
    const rateNorm =
      rateNum === null || !Number.isFinite(rateNum) || rateNum < 0 ? null : Math.round(rateNum * 100) / 100;
    setRateSaving(true);
    try {
      await updateCategoryRate(selectedCat.id, rateNorm);
      if (!silent) toast.success("Hourly rate saved");
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
      // Sheet is now the single source of truth for currency + method + fields.
      // All three travel together so the editor can never leave the row in a
      // half-saved state where the method belongs to the wrong rail.
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
      setNewCategoryName("");
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

  const handleAddCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name || addingCategory) return;
    setAddingCategory(true);
    try {
      const cat = await addCategory(name);
      if (cat) {
        setSelectedCategoryId(cat.id);
        setNewCategoryName("");
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
          : "border-border/35"
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
              <div className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.07] px-3 py-1 border border-border/30">
                <span
                  className="h-1.5 w-1.5 rounded-full animate-pulse shadow-[0_0_0_3px_color-mix(in_srgb,var(--hero-accent)_22%,transparent)]"
                  style={{ background: accent }}
                />
                <span className="text-[12px] font-medium text-foreground/85 truncate max-w-[14rem]">
                  {activeCat.name}
                </span>
              </div>
              {/*
                Wrapper holds the breathing scale so it doesn't deform the
                text inside. The previous markup put `breathe` AND a layered
                text-shadow (26px + 48px blurs) on the same element — iOS
                Capacitor WebView allocates a fixed-bounds compositor layer
                for the shadow, and the scale animation made the rectangular
                edge of that layer visible behind the digits. Splitting them
                + dropping the shadow (the tracker-hero-clock conic sweep
                behind the whole card already provides the category-tinted
                ambient glow) makes the timer read as crisp numerals on a
                quietly-pulsing surface, not text inside a faint box.
              */}
              <div className="mt-3 breathe">
                <LiveElapsed
                  format={fmtHMS}
                  className="font-display text-[3.4rem] font-semibold tabular-nums leading-none tracking-[-0.04em] text-foreground"
                />
              </div>
              {activeCat?.hourly_rate && activeCat.hourly_rate > 0 && (
                <FlipEarnings
                  rate={activeCat.hourly_rate}
                  currency={activeCat.currency || "USD"}
                />
              )}
              <button
                type="button"
                onClick={() => { haptics.impact("medium"); void stop(); }}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-7 py-3 text-[14px] font-semibold pressable shadow-[0_8px_22px_-12px_rgba(0,0,0,0.45)]"
              >
                <Square className="h-3.5 w-3.5" fill="currentColor" />
                Stop
              </button>
              {categories.length > 1 && (
                <button
                  type="button"
                  onClick={() => openCategoryPicker()}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/45 bg-background/45 px-4 py-2 text-[12px] font-semibold text-secondary-fg/90 pressable hover:text-foreground"
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
                    haptics.impact("medium");
                    void start(selectedCat.id);
                    return;
                  }
                  haptics.tap();
                  openCategoryPicker();
                }}
                className="gleam mt-4 inline-flex items-center gap-2 rounded-full text-primary-foreground px-8 py-3.5 text-[14px] font-semibold pressable btn-volumetric"
              >
                <Play className="h-3.5 w-3.5" fill="currentColor" />
                Start tracking
              </button>
            </>
          )}
        </div>

        {/* Quick category chips when idle */}
        {!active && topCats.length > 0 && (
          <div className="mt-4 -mx-1 flex gap-1.5 overflow-x-auto pb-1 px-1 scrollbar-none">
            {topCats.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { haptics.selection(); setSelectedCategoryId(c.id); }}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border py-1.5 pl-2 pr-3 text-[12px] font-medium transition-colors pressable ${
                  selectedCategoryId === c.id
                    ? "border-primary/50 bg-primary/[0.12] text-foreground ring-[1.5px] ring-primary/20"
                    : "border-border/35 bg-black/[0.05] dark:bg-white/[0.05] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.08]"
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
                className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/40 py-1.5 px-2.5 text-[12px] font-medium text-secondary-fg/85 hover:text-foreground pressable"
              >
                <ChevronDown className="h-3 w-3" />
                More
              </button>
            )}
            <button
              type="button"
              onClick={() => openCategoryPicker({ focusAdd: true })}
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-dashed border-border/40 bg-transparent py-1.5 px-2.5 text-[12px] font-medium text-secondary-fg/80 hover:text-foreground pressable"
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

        {/* Billing — collapsed by default, tap to expand. Raised glass card so
            it reads as its own piece of hardware sitting on the hero. */}
        {!active && selectedCat && (
          <div
            className="mt-3 rounded-2xl overflow-hidden"
            style={{
              background: "linear-gradient(180deg, hsl(var(--card) / 0.65) 0%, hsl(var(--card) / 0.38) 100%)",
              boxShadow: [
                "inset 0 1px 0 hsl(0 0% 100% / 0.09)",
                "0 0 0 1px hsl(var(--border) / 0.55)",
                "0 8px 22px -14px hsl(0 0% 0% / 0.45)",
              ].join(", "),
            }}
          >
            <button
              type="button"
              onClick={() => setBillingExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 pressable"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/60">
                Rate & billing
              </span>
              <div className="flex items-center gap-2">
                {selectedCat.hourly_rate != null && (
                  <span className="text-[12px] font-semibold text-foreground/70 tabular-nums">
                    {fmtMoney(selectedCat.hourly_rate, selectedCat.currency || "USD")}/h
                  </span>
                )}
                <ChevronDown
                  className={`h-3.5 w-3.5 text-secondary-fg/50 transition-transform duration-200 ${billingExpanded ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {billingExpanded && (
              // Recessed "well" — the convex rate field + raised method button
              // visibly sit inside it, giving the section real depth layers.
              <div className="groove-track mx-1.5 mb-1.5 rounded-xl px-3 pb-3 pt-3 space-y-2.5">
                {/* Rate field — auto-saves on blur when dirty, no button needed
                    in the common case. Save button appears only after typing. */}
                <div className="flex items-end gap-2">
                  <label className="flex-1 space-y-1 block min-w-0">
                    <span className="text-[10px] font-semibold text-primary/80">
                      Rate / h{selectedCat.currency ? ` · ${selectedCat.currency.toUpperCase()}` : ""}
                    </span>
                    {/* Convex primary pebble — mirrors the Start button's depth */}
                    <div
                      className="h-10 rounded-xl flex items-center px-3 transition-shadow"
                      style={{
                        background: "linear-gradient(180deg, hsl(var(--primary) / 0.12) 0%, hsl(var(--primary) / 0.05) 100%)",
                        boxShadow: [
                          "inset 0 1px 0 hsl(0 0% 100% / 0.12)",
                          "inset 0 -1px 0 hsl(var(--primary) / 0.18)",
                          rateDirty ? "0 0 0 1.5px hsl(var(--primary) / 0.55)" : "0 0 0 1.5px hsl(var(--primary) / 0.28)",
                          "0 4px 10px -5px hsl(var(--primary) / 0.25)",
                        ].join(", "),
                      }}
                    >
                      <Input
                        inputMode="decimal"
                        value={draftRate}
                        onChange={(e) => setDraftRate(e.target.value)}
                        onBlur={() => { if (rateDirty && !rateSaving) void saveRate(true); }}
                        placeholder="—"
                        className="h-7 flex-1 bg-transparent border-0 px-0 text-[13px] font-mono tabular-nums focus-visible:ring-0 shadow-none"
                      />
                    </div>
                  </label>
                  {rateDirty && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={rateSaving}
                      onClick={() => void saveRate(false)}
                      className="h-10 rounded-xl text-[12px] font-semibold px-4"
                    >
                      {rateSaving ? "Saving…" : "Save"}
                    </Button>
                  )}
                </div>

                {/* Single source of truth for currency + method + reqs.
                    Trigger displays current state; tap opens the unified sheet. */}
                <div className="space-y-1">
                  <span className="text-[10px] text-secondary-fg/70">Payment method</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isPro) { setUpgradeOpen(true); return; }
                      setBillingOpen(true);
                    }}
                    className="pebble-idle group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left pressable active:scale-[0.99] transition-transform"
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
                              style={{
                                background: `linear-gradient(180deg, hsl(${m.accent} / 0.28) 0%, hsl(${m.accent} / 0.14) 100%)`,
                                boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.18), inset 0 -1px 0 hsl(${m.accent} / 0.25), 0 0 0 1px hsl(${m.accent} / 0.32)`,
                                color: `hsl(${m.accent})`,
                              }}
                            >
                              <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
                            </span>
                            <span className="min-w-0 flex-1 text-[13px] font-semibold text-foreground truncate leading-tight">
                              {m.label}
                            </span>
                            <span className="shrink-0 inline-flex items-center rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums tracking-[0.04em] text-foreground/75">
                              {cur}
                            </span>
                          </>
                        );
                      }
                      return (
                        <>
                          <span className="pebble-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground/55">
                            <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
                          </span>
                          <span className="min-w-0 flex-1 text-[13px] font-medium text-secondary-fg/85 truncate leading-tight">
                            Add payment details
                          </span>
                          <span className="shrink-0 inline-flex items-center rounded-md bg-foreground/[0.04] px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums tracking-[0.04em] text-secondary-fg/65">
                            {cur}
                          </span>
                        </>
                      );
                    })()}
                    <ChevronDown className="h-4 w-4 -rotate-90 text-secondary-fg/55 shrink-0 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </div>
              </div>
            )}
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
        <SheetContent side="bottom" className="rounded-t-[28px] p-0 max-h-[84vh] overflow-hidden bg-background border-border/45">
          <div className="flex max-h-[84vh] flex-col">
            <div className="px-5 pt-7 pb-4 border-b border-border/35">
              <SheetTitle className="font-display text-[20px] font-semibold tracking-tight">
                {active ? "Switch category" : "Choose category"}
              </SheetTitle>
              <p className="text-[13px] text-secondary-fg/80 mt-1">
                {active ? "Pick a category and the current session will continue there." : "Pick a category, then press Start tracking."}
              </p>
              {categories.length > 6 && (
                <label className="mt-4 flex items-center gap-2 rounded-2xl border border-border/45 bg-card/55 px-3 py-2.5">
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

            <div className="flex-1 overflow-y-auto px-5 py-4">
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
                              className="flex-1 h-9 bg-card/55 border-border/40 rounded-xl text-[14px] font-semibold"
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
                              className="h-9 px-3.5 rounded-xl border border-border/40 bg-card/40 text-[12px] font-medium text-secondary-fg/85 pressable hover:text-foreground"
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
                        className={`group flex items-stretch gap-1 rounded-2xl border border-border/45 bg-card/60 transition-colors ${
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
                <div className="rounded-2xl border border-dashed border-border/45 px-4 py-6 text-center text-[13px] text-secondary-fg/80">
                  No categories match your search.
                </div>
              )}
            </div>

            <form onSubmit={handleAddCategory} className="border-t border-border/35 px-5 py-4">
              <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border/45 bg-card/35 px-3 py-2.5">
                <Plus className="h-4 w-4 text-secondary-fg shrink-0" />
                <input
                  ref={newCategoryInputRef}
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="New category name"
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-secondary-fg/65"
                  autoFocus={categories.length === 0 || focusNewCategory}
                />
                {newCategoryName.trim() && (
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
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={billingOpen} onOpenChange={setBillingOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-[28px] border-border/45 bg-popover max-h-[90vh] flex flex-col p-0"
          style={{ paddingBottom: "var(--keyboard-inset, 0px)" }}
        >
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 pt-6 pb-4">
              <SheetHeader className="text-left space-y-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">
                  Payment for
                </p>
                <SheetTitle className="font-display text-[22px] font-semibold tracking-tight mt-1">
                  {selectedCat?.name ?? "Category"}
                </SheetTitle>
              </SheetHeader>
              <p className="text-[12px] text-secondary-fg/85 mt-2 leading-relaxed">
                Pick how this client pays you — only the relevant fields will appear. Use a payment link for cards, never raw card numbers.
              </p>
            </div>

            <div className="px-5 pb-6 space-y-4">
              <PaymentMethodFields
                value={paymentDetails as PaymentFieldsValue}
                onChange={(field, val) => setPaymentDetails((p) => ({ ...p, [field]: val }))}
              />

              <Button
                type="button"
                disabled={paymentSaving}
                onClick={() => void savePaymentDetails()}
                className="w-full h-12 rounded-2xl text-[14px] font-semibold gleam btn-volumetric"
              >
                {paymentSaving ? "Saving…" : "Save payment details"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
    </section>
  );
}
