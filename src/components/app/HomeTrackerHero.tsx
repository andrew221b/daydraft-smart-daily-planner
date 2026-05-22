import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Check, Play, Square, Plus, Search, ChevronDown, Wallet } from "lucide-react";
import { useTimeTracker, fmtHMS, fmtHM } from "@/hooks/useTimeTracker";
import { LiveElapsed } from "@/components/app/LiveElapsed";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { categoryBillingToDraft } from "@/lib/categoryBilling";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";

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

const currencyOptions = [
  "USD", "EUR", "GBP", "CHF", "CAD", "AUD", "NZD", "JPY", "PLN", "UAH", "AED", "SEK", "NOK", "DKK", "CZK", "GEL", "TRY", "SGD", "HKD", "MXN", "BRL", "INR", "CNY", "KZT",
  "USDT", "USDC", "DAI", "EURC", "BTC", "ETH", "SOL", "BNB", "TON", "TRX", "MATIC", "LTC", "XRP", "ADA", "DOGE",
];

const paymentMethodOptions = ["", "Bank transfer", "IBAN", "Wise", "PayPal", "Stripe link", "Crypto wallet", "Other"];

/**
 * Earlier builds listed "USDT" and "USDC" as payment methods, which conflated
 * stablecoins (currencies — they already live in the Currency dropdown) with
 * rails. The list has been cleaned up to rails only. Keep any legacy saved
 * value visible in the dropdown so a user still sees their previous choice
 * and can pick the new "Crypto wallet" rail without the select going blank.
 */
function paymentMethodOptionsFor(current: string): string[] {
  if (!current || paymentMethodOptions.includes(current)) return paymentMethodOptions;
  return [...paymentMethodOptions, current];
}

export function HomeTrackerHero({ onOpenDetails }: { onOpenDetails: () => void }) {
  const { isPro } = useEntitlement();
  const {
    active,
    categories,
    start,
    stop,
    switchCategory,
    addCategory,
    todayTotalSec,
    updateCategoryRate,
    updateCategoryBilling,
  } = useTimeTracker();
  // The live HH:MM:SS digits are rendered via <LiveElapsed> below — that
  // component writes textContent directly without re-rendering this tree.
  const activeCat = categories.find((c) => c.id === active?.category_id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [focusNewCategory, setFocusNewCategory] = useState(false);
  const newCategoryInputRef = useRef<HTMLInputElement | null>(null);
  const [draftRate, setDraftRate] = useState("");
  const [draftCurrency, setDraftCurrency] = useState("USD");
  const [draftPaymentMethod, setDraftPaymentMethod] = useState("");
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingExpanded, setBillingExpanded] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetailsDraft>(emptyPaymentDetails);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const selectedCat = categories.find((c) => c.id === selectedCategoryId) || null;
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
    setDraftCurrency(String(selectedCat.currency || "USD"));
    setDraftPaymentMethod(String(selectedCat.payment_method || ""));
  }, [selectedCat]);

  useEffect(() => {
    if (!billingOpen || !selectedCat) return;
    setPaymentDetails(categoryBillingToDraft(selectedCat));
  }, [billingOpen, selectedCat]);

  const saveCategoryBilling = async () => {
    if (!selectedCat) return;
    const cleaned = draftRate.replace(",", ".").trim();
    const rateNum = cleaned === "" ? null : Number(cleaned);
    const rateNorm =
      rateNum === null || !Number.isFinite(rateNum) || rateNum < 0 ? null : Math.round(rateNum * 100) / 100;
    setCategorySaving(true);
    try {
      await Promise.all([
        updateCategoryRate(selectedCat.id, rateNorm),
        updateCategoryBilling(selectedCat.id, {
          ...categoryBillingToDraft(selectedCat),
          currency: draftCurrency,
          payment_method: draftPaymentMethod,
        }),
      ]);
      toast.success("Saved for this category");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setCategorySaving(false);
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
      toast.success("Payment details saved for this category");
      setBillingOpen(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setPaymentSaving(false);
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
      // `shrink-0` is critical here: this section sits inside Home's flex
      // column inside Shell's scrollable <main>. Without it, the column's
      // implicit shrink behaviour squeezes this card when the expanded
      // Rate & Billing form pushes its natural height up — and combined
      // with the `overflow-hidden` we need for the rotating conic-gradient
      // sweep clip, the form's inputs get visually cut off.
      className={`relative shrink-0 overflow-hidden rounded-[28px] hero-glass border px-5 pt-6 pb-5 transition-[border-color,background-color,box-shadow,transform] duration-500 ease-out ${
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
              <div className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.05] px-3 py-1 border border-border/30">
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
                  className="font-display text-[3.4rem] font-semibold tabular-nums leading-none tracking-[-0.04em] text-foreground block"
                />
              </div>
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
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-foreground/[0.04] px-4 py-2 text-[12px] font-semibold text-foreground/80 pressable hover:text-foreground hover:bg-foreground/[0.07]"
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
                className="gleam mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-primary text-primary-foreground px-8 py-3.5 text-[14px] font-semibold pressable shadow-[0_10px_28px_-12px_hsl(var(--primary)/0.6)] border border-primary/20"
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
                // Selected uses *tinted text on tinted bg* (the iOS pattern)
                // — `text-primary-foreground` is white, which vanishes on the
                // 12%-blue tint in light mode. Unselected uses a foreground
                // tint instead of `bg-white/*` so the chip is visible on a
                // white surface.
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border py-1.5 pl-2 pr-3 text-[12px] font-medium transition-colors pressable ${
                  selectedCategoryId === c.id
                    ? "border-primary/50 bg-primary/[0.12] text-primary ring-[1.5px] ring-primary/20"
                    : "border-border/50 bg-foreground/[0.04] text-foreground/85 hover:bg-foreground/[0.07]"
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
                className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border/55 bg-foreground/[0.04] py-1.5 px-2.5 text-[12px] font-medium text-foreground/75 hover:text-foreground hover:bg-foreground/[0.07] pressable"
              >
                <ChevronDown className="h-3 w-3" />
                More
              </button>
            )}
            <button
              type="button"
              onClick={() => openCategoryPicker({ focusAdd: true })}
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 bg-transparent py-1.5 px-2.5 text-[12px] font-medium text-foreground/70 hover:text-foreground pressable"
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

        {/* Billing — collapsed by default, tap to expand */}
        {!active && selectedCat && (
          <div className="mt-3 rounded-2xl border border-border/30 bg-background/25 overflow-hidden">
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
                  <span className="text-[12px] font-medium text-foreground/65 tabular-nums">
                    {selectedCat.hourly_rate}/{selectedCat.currency || "USD"}/h
                  </span>
                )}
                <ChevronDown
                  className={`h-3.5 w-3.5 text-secondary-fg/50 transition-transform duration-200 ${billingExpanded ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {billingExpanded && (
              <div className="px-3.5 pb-3.5 space-y-2.5 border-t border-border/25 pt-3">
                <div className="grid grid-cols-[1fr_100px] gap-2">
                  <label className="space-y-1 block min-w-0">
                    <span className="text-[10px] text-secondary-fg/70">Rate / h</span>
                    <Input
                      inputMode="decimal"
                      value={draftRate}
                      onChange={(e) => setDraftRate(e.target.value)}
                      placeholder="—"
                      className="h-9 rounded-xl border-border/40 bg-card/40 text-[13px]"
                    />
                  </label>
                  <label className="space-y-1 block min-w-0">
                    <span className="text-[10px] text-secondary-fg/70">Currency</span>
                    <select
                      value={draftCurrency}
                      onChange={(e) => setDraftCurrency(e.target.value)}
                      className="h-9 w-full rounded-xl border border-border/40 bg-card/40 px-2 text-[12px] text-foreground outline-none focus:border-primary/50"
                    >
                      {currencyOptions.map((code) => <option key={code} value={code}>{code}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-[10px] text-secondary-fg/70">Payment method</span>
                  <select
                    value={draftPaymentMethod}
                    onChange={(e) => setDraftPaymentMethod(e.target.value)}
                    className="h-9 w-full rounded-xl border border-border/40 bg-card/40 px-2 text-[12px] text-foreground outline-none focus:border-primary/50"
                  >
                    {paymentMethodOptionsFor(draftPaymentMethod).map((method) => <option key={method || "blank"} value={method}>{method || "Not set"}</option>)}
                  </select>
                </label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={categorySaving}
                    onClick={() => void saveCategoryBilling()}
                    className="flex-1 h-9 rounded-xl text-[12px] font-semibold"
                  >
                    {categorySaving ? "Saving…" : "Save"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isPro) { setUpgradeOpen(true); return; }
                      setBillingOpen(true);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/40 bg-card/35 text-[12px] font-medium text-secondary-fg/80 pressable hover:text-foreground"
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    Details
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
              <h3 className="font-display text-[20px] font-semibold tracking-tight">
                {active ? "Switch category" : "Choose category"}
              </h3>
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
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => chooseCategory(c.id)}
                        disabled={isCurrent}
                        className={`flex items-center gap-3 rounded-2xl border border-border/45 bg-card/60 px-3.5 py-3.5 text-left pressable transition-colors ${
                          isCurrent ? "opacity-70" : isSelected ? "ring-1 ring-primary/25 bg-primary/10" : "hover:bg-card/90"
                        }`}
                        style={{ borderColor: `${c.color}55` }}
                      >
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground/95">{c.name}</span>
                        {isCurrent && <span className="text-[11px] font-semibold text-primary">Current</span>}
                        {isSelected && <span className="text-[11px] font-semibold text-primary">Selected</span>}
                      </button>
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
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover max-h-[88vh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="text-[17px]">
              Payment · {selectedCat?.name ?? "Category"}
            </SheetTitle>
          </SheetHeader>
          <p className="text-[12px] text-secondary-fg mt-1 mb-3">
            Saved on this category. Pro exports merge these fields with your global payment profile where you leave blanks. Use a payment link for cards — never raw card numbers.
          </p>
          <div className="space-y-3 pb-4">
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-[10px] text-secondary-fg/80">Currency</span>
                <select
                  value={paymentDetails.currency}
                  onChange={(e) => setPaymentDetails((p) => ({ ...p, currency: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-border/45 bg-card px-2 text-[12px] text-foreground outline-none focus:border-primary/50"
                >
                  {currencyOptions.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] text-secondary-fg/80">Method</span>
                <select
                  value={paymentDetails.payment_method}
                  onChange={(e) => setPaymentDetails((p) => ({ ...p, payment_method: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-border/45 bg-card px-2 text-[12px] text-foreground outline-none focus:border-primary/50"
                >
                  {paymentMethodOptionsFor(paymentDetails.payment_method).map((method) => <option key={method || "blank"} value={method}>{method || "Not set"}</option>)}
                </select>
              </label>
            </div>
            <Input
              value={paymentDetails.display_name}
              onChange={(e) => setPaymentDetails((p) => ({ ...p, display_name: e.target.value }))}
              placeholder="Payee name"
              className="rounded-xl"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={paymentDetails.bank_name}
                onChange={(e) => setPaymentDetails((p) => ({ ...p, bank_name: e.target.value }))}
                placeholder="Bank"
                className="rounded-xl"
              />
              <Input
                value={paymentDetails.iban}
                onChange={(e) => setPaymentDetails((p) => ({ ...p, iban: e.target.value }))}
                placeholder="IBAN"
                className="rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={paymentDetails.crypto_network}
                onChange={(e) => setPaymentDetails((p) => ({ ...p, crypto_network: e.target.value }))}
                placeholder="Crypto network"
                className="rounded-xl"
              />
              <Input
                value={paymentDetails.crypto_wallet}
                onChange={(e) => setPaymentDetails((p) => ({ ...p, crypto_wallet: e.target.value }))}
                placeholder="Wallet"
                className="rounded-xl"
              />
            </div>
            <Input
              value={paymentDetails.payment_link}
              onChange={(e) => setPaymentDetails((p) => ({ ...p, payment_link: e.target.value }))}
              placeholder="Payment link (Stripe, Wise…)"
              className="rounded-xl"
            />
            <Textarea
              value={paymentDetails.notes}
              onChange={(e) => setPaymentDetails((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Notes for client"
              className="min-h-[72px] rounded-xl"
            />
            <Button
              type="button"
              disabled={paymentSaving}
              onClick={() => void savePaymentDetails()}
              className="w-full h-11 rounded-xl"
            >
              {paymentSaving ? "Saving…" : "Save payment details"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
    </section>
  );
}
