import { AnimatePresence, motion } from "framer-motion";
import { Banknote, Check, ChevronDown, Coins, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CRYPTO_CURRENCY_CODES,
  FIAT_CURRENCY_CODES,
  PAYMENT_METHODS,
  currencyKind,
  getPaymentMethod,
  inferKind,
  legacyMethodOption,
  networksForCurrency,
  type PaymentField,
  type PaymentKind,
  type PaymentMethod,
} from "@/lib/paymentMethods";
import { haptics } from "@/lib/haptics";

/** All the raw billing fields the picker can drive — superset of any one method. */
export type PaymentFieldsValue = {
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

type FieldKey = keyof Omit<PaymentFieldsValue, "payment_method" | "currency">;

const FIAT_LIST = FIAT_CURRENCY_CODES as readonly string[];
const CRYPTO_LIST = CRYPTO_CURRENCY_CODES as readonly string[];

/**
 * Method-aware payment-fields editor with a top-level Fiat ↔ Crypto kind
 * toggle. The toggle drives:
 *   • Which payment methods are listed (banks/PayPal/Wise vs. Crypto wallet)
 *   • Which currencies are offered in the inline picker (when shown)
 *   • The auto-reset behaviour when the user flips kinds (any selected
 *     method or currency that doesn't match the new kind is cleared)
 *
 * In compact mode (TrackerPill row) the kind toggle + currency picker are
 * hidden — the parent shows its own inline currency field and we just
 * filter the method chips by the kind inferred from `value.currency`.
 */
export function PaymentMethodFields({
  value,
  onChange,
  compact = false,
}: {
  value: PaymentFieldsValue;
  onChange: (field: keyof PaymentFieldsValue, val: string) => void;
  /** Use the tighter layout intended for inline category cards. Hides the
   *  kind toggle and currency picker — both stay in the parent's chrome. */
  compact?: boolean;
}) {
  // Kind is the source of truth. We track it as local state so the user can
  // flip to Crypto even before they pick a method or currency. Initial
  // value is derived from the current method/currency so the editor opens
  // on the right tab when reopening an existing entry.
  const [kind, setKind] = useState<PaymentKind>(() => inferKind(value));

  // Keep kind in sync if the parent swaps to a completely different draft
  // (e.g. user opened a different category). We compare *what the data
  // implies* to avoid fighting the user mid-edit: only re-derive if the
  // parent's signals point at a different kind than ours.
  const lastSeenSignature = useRef(`${value.payment_method}|${value.currency}`);
  useEffect(() => {
    const sig = `${value.payment_method}|${value.currency}`;
    if (sig === lastSeenSignature.current) return;
    lastSeenSignature.current = sig;
    const derived = inferKind(value);
    if (derived !== kind) setKind(derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.payment_method, value.currency]);

  const methods = useMemo(
    () => PAYMENT_METHODS.filter((m) => m.kind === kind),
    [kind],
  );

  // When there's only one method for a kind (Crypto wallet is the only crypto
  // rail), there's no decision to make — auto-select it so the user lands
  // straight on the network + wallet fields instead of an awkward 1-card grid.
  useEffect(() => {
    if (methods.length !== 1) return;
    const only = methods[0];
    if (value.payment_method === only.id) return;
    onChange("payment_method", only.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methods.length, kind]);

  const method = getPaymentMethod(value.payment_method);
  // Only show the "legacy/unknown" pill when the current method either
  // (a) isn't in the catalogue at all, or (b) is in the catalogue but
  // belongs to the OTHER kind — that way switching to Crypto with a stale
  // Wise method shows it as a soft chip to clear.
  const legacy = (() => {
    const lo = legacyMethodOption(value.payment_method);
    if (lo) return lo;
    if (method && method.kind !== kind) {
      return { id: method.id, label: `${method.label} (other rail)` };
    }
    return null;
  })();

  const setMethod = (id: string) => {
    if (id === value.payment_method) {
      haptics.selection();
      onChange("payment_method", "");
      return;
    }
    haptics.selection();
    onChange("payment_method", id);
  };

  const switchKind = (next: PaymentKind) => {
    if (next === kind) return;
    haptics.selection();
    setKind(next);

    // Clear the method when its kind doesn't match the new tab — keeps
    // the picker honest. Currency does the same: if it's a stablecoin and
    // the user flips to Fiat, snap to USD; flipping to Crypto with a fiat
    // code in place snaps to USDT (the most common payout coin).
    const currentMethod = getPaymentMethod(value.payment_method);
    if (currentMethod && currentMethod.kind !== next) {
      onChange("payment_method", "");
    }

    const curKind = currencyKind(value.currency);
    if (curKind !== next) {
      onChange("currency", next === "fiat" ? "USD" : "USDT");
    }
  };

  return (
    <div className="space-y-3">
      {!compact && (
        <>
          <KindToggle kind={kind} onChange={switchKind} />
          <CurrencyPickerInline kind={kind} value={value.currency} onChange={(v) => onChange("currency", v)} />
        </>
      )}

      {methods.length > 1 && (
        <MethodGrid
          methods={methods}
          selectedId={value.payment_method}
          onPick={setMethod}
          compact={compact}
          legacy={legacy}
          onClearLegacy={() => onChange("payment_method", "")}
        />
      )}

      <AnimatePresence mode="popLayout" initial={false}>
        {method && method.kind === kind ? (
          <motion.div
            key={method.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 360, damping: 30, mass: 0.7 }}
            className="relative overflow-hidden rounded-2xl p-3.5 space-y-2.5"
            style={{
              // Accent-tinted glass that holds the recessed inputs. Same
              // gradient direction as the pebble chips above (top → bottom)
              // so the whole sheet reads as one piece of lit hardware.
              background:
                "linear-gradient(180deg, hsl(var(--m-accent) / 0.12) 0%, hsl(var(--background) / 0.55) 60%, hsl(var(--background) / 0.42) 100%)",
              boxShadow: [
                // Subtle top highlight (light catches the top edge of the card)
                "inset 0 1px 0 hsl(0 0% 100% / 0.07)",
                // Faint bottom inset shadow (card sits in its own shade)
                "inset 0 -1px 0 hsl(var(--m-accent) / 0.18)",
                // Accent hairline ring around the whole shape
                "0 0 0 1px hsl(var(--m-accent) / 0.28)",
                // Outer glow — lifts the card off the sheet's neutral bg
                "0 14px 32px -18px hsl(var(--m-accent) / 0.45)",
                "0 4px 12px -8px hsl(var(--m-accent) / 0.20)",
              ].join(", "),
              ["--m-accent" as string]: method.accent,
            } as CSSProperties}
          >
            <div className="flex items-center gap-2 px-0.5">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                style={{ background: "hsl(var(--m-accent) / 0.20)", color: "hsl(var(--m-accent))" }}
              >
                <method.Icon className="h-3 w-3" strokeWidth={2.4} />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/80">
                {method.detailTitle}
              </span>
            </div>
            <div className="space-y-2">
              {method.fields.map((f, idx) => {
                // crypto_network options are derived from the selected coin
                // so a user picking BTC sees Bitcoin/Lightning, USDT sees the
                // top stablecoin chains, etc. — not the full 30-row menu.
                // If the user already saved a network that doesn't match the
                // current coin (e.g. switched USDT→BTC), keep it in the list
                // so we never silently drop their data.
                const effective: PaymentField =
                  f.key === "crypto_network"
                    ? (() => {
                        const base = networksForCurrency(value.currency);
                        const current = value.crypto_network?.trim();
                        const opts = current && !base.includes(current)
                          ? [current, ...base]
                          : base;
                        return { ...f, options: opts };
                      })()
                    : f;
                return (
                  <FieldRow key={f.key} field={effective} value={value[f.key as FieldKey] ?? ""} onChange={(v) => onChange(f.key as FieldKey, v)} />
                );
              })}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="no-method"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="rounded-2xl border border-dashed border-border/40 bg-background/25 px-4 py-5 text-center"
          >
            <p className="text-[12px] text-secondary-fg/70 leading-relaxed">
              {kind === "fiat" ? (
                <>Pick a payment method above —<br />we'll only ask for the fields it actually needs.</>
              ) : (
                <>Pick a crypto rail above —<br />then add the network and wallet address.</>
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────── */

function KindToggle({
  kind,
  onChange,
}: {
  kind: PaymentKind;
  onChange: (k: PaymentKind) => void;
}) {
  // Fiat = sapphire (--primary), Crypto = warm amber so the kind itself
  // carries colour identity, not just the icon. Stored as raw HSL so we
  // can tint shadows / fills from one source of truth per kind.
  const fiatHsl = "211 95% 60%";
  const cryptoHsl = "32 95% 58%";
  const tintHsl = kind === "fiat" ? fiatHsl : cryptoHsl;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between px-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/70">
          Payment rail
        </span>
      </div>
      <div
        role="tablist"
        aria-label="Payment rail"
        className="relative grid grid-cols-2 gap-1 rounded-2xl p-1"
        style={{
          // Track has the opposite of the pill — slightly recessed,
          // top inset shadow, dark hairline on the bottom. Makes the pill
          // look like it's sitting in a groove.
          background:
            "linear-gradient(180deg, hsl(var(--foreground) / 0.06) 0%, hsl(var(--foreground) / 0.03) 100%)",
          boxShadow: [
            "inset 0 1.5px 2px hsl(0 0% 0% / 0.10)",
            "inset 0 -1px 0 hsl(0 0% 100% / 0.04)",
            "0 0 0 1px hsl(var(--border) / 0.50)",
          ].join(", "),
        }}
      >
        {/* Sliding pill — gradient-tinted by the active kind, plus the
            standard pebble shadow stack so the active rail visibly LIFTS
            out of the recessed track. Transform-only animation keeps fast
            taps perfectly responsive. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-xl transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            transform: kind === "crypto" ? "translateX(calc(100% + 4px))" : "translateX(0)",
            background: `linear-gradient(180deg, hsl(${tintHsl} / 0.28) 0%, hsl(${tintHsl} / 0.12) 100%)`,
            boxShadow: [
              `inset 0 1px 0 hsl(0 0% 100% / 0.18)`,
              `inset 0 -1px 0 hsl(${tintHsl} / 0.30)`,
              `0 0 0 1px hsl(${tintHsl} / 0.48)`,
              `0 4px 12px -6px hsl(${tintHsl} / 0.55)`,
              `0 1px 3px hsl(${tintHsl} / 0.20)`,
            ].join(", "),
          }}
        />
        <KindTab active={kind === "fiat"} onClick={() => onChange("fiat")} icon={Banknote} label="Fiat" tintHsl={fiatHsl} />
        <KindTab active={kind === "crypto"} onClick={() => onChange("crypto")} icon={Coins} label="Crypto" tintHsl={cryptoHsl} />
      </div>
    </div>
  );
}

function KindTab({
  active,
  onClick,
  icon: Icon,
  label,
  tintHsl,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Banknote;
  label: string;
  tintHsl: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "relative z-[1] h-9 inline-flex items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-semibold tracking-[0.01em] transition-colors duration-150",
        active ? "text-foreground" : "text-secondary-fg/70 hover:text-foreground/85",
      ].join(" ")}
      style={active ? { textShadow: `0 0 18px hsl(${tintHsl} / 0.35)` } : undefined}
    >
      <Icon
        className="h-[15px] w-[15px]"
        strokeWidth={2.4}
        style={active ? { color: `hsl(${tintHsl})` } : undefined}
      />
      {label}
    </button>
  );
}

function CurrencyPickerInline({
  kind,
  value,
  onChange,
}: {
  kind: PaymentKind;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const list = kind === "fiat" ? FIAT_LIST : CRYPTO_LIST;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.toLowerCase().includes(q));
  }, [list, query]);

  // If the current value doesn't belong to the current kind list, blank
  // the trigger label so the picker visually reflects the new kind.
  const displayValue = list.includes(value.toUpperCase()) ? value.toUpperCase() : "";
  // Match the kind toggle's colour identity — sapphire for fiat, amber
  // for crypto — so currency chrome + rail chrome agree.
  const tintHsl = kind === "fiat" ? "211 95% 60%" : "32 95% 58%";
  const placeholder = kind === "fiat" ? "Select currency" : "Select coin";

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between px-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/70">
          Currency
        </span>
      </div>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQuery(""); }}
        aria-expanded={open}
        className="w-full h-11 inline-flex items-center justify-between gap-2.5 rounded-2xl px-3.5 text-left transition-[transform,box-shadow,background-color] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.99]"
        style={{
          background: displayValue
            ? `linear-gradient(180deg, hsl(${tintHsl} / 0.14) 0%, hsl(var(--card) / 0.55) 100%)`
            : "linear-gradient(180deg, hsl(var(--card) / 0.65) 0%, hsl(var(--card) / 0.40) 100%)",
          boxShadow: displayValue
            ? [
                "inset 0 1px 0 hsl(0 0% 100% / 0.10)",
                `inset 0 -1px 0 hsl(${tintHsl} / 0.30)`,
                `0 0 0 1.5px hsl(${tintHsl} / 0.42)`,
                `0 4px 14px -8px hsl(${tintHsl} / 0.45)`,
              ].join(", ")
            : [
                "inset 0 1px 0 hsl(0 0% 100% / 0.06)",
                "inset 0 -1px 0 hsl(0 0% 0% / 0.10)",
                "0 0 0 1px hsl(var(--border) / 0.55)",
                "0 2px 6px -3px hsl(0 0% 0% / 0.18)",
              ].join(", "),
        }}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ background: displayValue ? `hsl(${tintHsl})` : "hsl(var(--foreground) / 0.25)" }}
          />
          <span
            className="text-[13.5px] font-semibold tabular-nums tracking-[0.02em] text-foreground truncate"
            style={displayValue ? { textShadow: `0 0 16px hsl(${tintHsl} / 0.25)` } : undefined}
          >
            {displayValue || placeholder}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 text-secondary-fg/65 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="cur-list"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-2xl border border-border/45 bg-background/60 p-2 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.03)]">
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-secondary-fg/55 pointer-events-none" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={kind === "fiat" ? "USD, Euro…" : "USDT, Bitcoin…"}
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-border/40 bg-card/55 text-[13px] placeholder:text-secondary-fg/45 focus:outline-none focus:border-primary/45 transition-colors"
                />
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-[200px] overflow-y-auto pl-1 pb-1 pr-1">
                {filtered.map((code) => {
                  const selected = code === displayValue;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => { haptics.tap(); onChange(code); setOpen(false); setQuery(""); }}
                      aria-pressed={selected}
                      className={[
                        "h-9 inline-flex items-center justify-center rounded-xl text-[12px] font-semibold tabular-nums tracking-[0.02em]",
                        "transition-[transform,box-shadow,background-color] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]",
                        "active:scale-[0.96]",
                        selected ? "text-foreground" : "text-foreground/85",
                      ].join(" ")}
                      style={
                        selected
                          ? {
                              background: `linear-gradient(180deg, hsl(${tintHsl} / 0.32) 0%, hsl(${tintHsl} / 0.16) 100%)`,
                              boxShadow: [
                                "inset 0 1px 0 hsl(0 0% 100% / 0.18)",
                                `inset 0 -1px 0 hsl(${tintHsl} / 0.40)`,
                                `0 0 0 1.5px hsl(${tintHsl} / 0.55)`,
                                `0 4px 14px -6px hsl(${tintHsl} / 0.50)`,
                                `0 1px 3px hsl(${tintHsl} / 0.20)`,
                              ].join(", "),
                              textShadow: `0 0 12px hsl(${tintHsl} / 0.30)`,
                            }
                          : {
                              background:
                                "linear-gradient(180deg, hsl(var(--foreground) / 0.05) 0%, hsl(var(--foreground) / 0.02) 100%)",
                              boxShadow: [
                                "inset 0 1px 0 hsl(0 0% 100% / 0.06)",
                                "inset 0 -1px 0 hsl(0 0% 0% / 0.08)",
                                "0 0 0 1px hsl(var(--border) / 0.45)",
                                "0 1px 3px -1px hsl(0 0% 0% / 0.12)",
                              ].join(", "),
                            }
                      }
                    >
                      {code}
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <p className="col-span-full py-4 text-center text-[12px] text-secondary-fg/65">
                    No match for "{query}"
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MethodGrid({
  methods,
  selectedId,
  onPick,
  compact,
  legacy,
  onClearLegacy,
}: {
  methods: PaymentMethod[];
  selectedId: string;
  onPick: (id: string) => void;
  compact: boolean;
  legacy: { id: string; label: string } | null;
  onClearLegacy: () => void;
}) {
  const gridCols = compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 px-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/70">
          Payment method
        </span>
        {selectedId && (
          <button
            type="button"
            onClick={() => { haptics.selection(); onPick(""); }}
            className="text-[10px] font-medium text-secondary-fg/60 hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <div className={`grid ${gridCols} gap-1.5`}>
        {methods.map((m) => (
          <MethodChip
            key={m.id}
            method={m}
            selected={selectedId === m.id}
            onPick={onPick}
            compact={compact}
          />
        ))}
        {legacy && (
          <button
            key={legacy.id}
            type="button"
            onClick={onClearLegacy}
            className="relative flex items-center gap-2 rounded-2xl px-2.5 py-2 text-left transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97]"
            title="Different rail — tap to clear"
            style={{
              background:
                "linear-gradient(180deg, hsl(var(--foreground) / 0.04) 0%, hsl(var(--foreground) / 0.015) 100%)",
              // Outer dashed-feel ring (faint) + soft inner highlight so the
              // chip still reads as "alternative / removable" but matches
              // the pebble vocabulary of its siblings.
              boxShadow: [
                "inset 0 1px 0 hsl(0 0% 100% / 0.05)",
                "inset 0 -1px 0 hsl(0 0% 0% / 0.06)",
                "0 0 0 1px hsl(var(--border) / 0.40)",
                "0 1px 3px -1px hsl(0 0% 0% / 0.10)",
              ].join(", "),
            }}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-foreground/60"
              style={{
                background:
                  "linear-gradient(180deg, hsl(var(--foreground) / 0.07) 0%, hsl(var(--foreground) / 0.03) 100%)",
                boxShadow:
                  "inset 0 1px 0 hsl(0 0% 100% / 0.06), inset 0 -1px 0 hsl(0 0% 0% / 0.05)",
              }}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold leading-tight truncate">{legacy.label}</span>
              <span className="block text-[10px] leading-tight mt-0.5 truncate text-secondary-fg/65">
                Tap to clear
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * MethodChip is its own component + memoed indirectly via React render
 * shape (each chip's prop set only changes when *that chip's* state
 * changes). This was the core cause of the "highlight lags by one tap"
 * issue: the previous version's shared button block rebuilt the whole
 * grid every render, leaving stale interactive state between fast taps.
 * Now each chip is self-contained and CSS handles the active state
 * synchronously via `aria-pressed`.
 */
/**
 * MethodChip — convex "pebble" button.
 *
 * Three layered effects build the 3D feel:
 *   1. Gradient FILL (top → bottom): brighter at the top, softer below,
 *      simulating overhead light.
 *   2. INSET shadow stack: 1px white highlight on the top edge + 1px dark
 *      line on the bottom edge → looks like the button has thickness, the
 *      top "catches the light" and the bottom sits in its own shadow.
 *   3. Outer DROP shadow: gives the chip lift off the surface.
 *
 * Pressed state (via `active:`) slides the gradient direction and removes
 * lift, so the user feels the tap mechanically.
 */
function MethodChip({
  method,
  selected,
  onPick,
  compact,
}: {
  method: PaymentMethod;
  selected: boolean;
  onPick: (id: string) => void;
  compact: boolean;
}) {
  const Icon = method.Icon;
  return (
    <button
      type="button"
      onClick={() => onPick(method.id)}
      aria-pressed={selected}
      className={[
        "group relative flex items-center gap-2 rounded-2xl px-2.5 py-2 text-left",
        "transition-[transform,box-shadow,background-color] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "active:scale-[0.97]",
        selected ? "text-foreground" : "text-foreground/85",
      ].join(" ")}
      style={
        {
          "--m-accent": method.accent,
          // Convex fill — selected uses an accent-tinted glass, idle uses a
          // neutral one. The white→transparent top highlight is the same in
          // both so the "pebble" reads consistently.
          background: selected
            ? "linear-gradient(180deg, hsl(var(--m-accent) / 0.22) 0%, hsl(var(--m-accent) / 0.10) 55%, hsl(var(--m-accent) / 0.06) 100%)"
            : "linear-gradient(180deg, hsl(var(--foreground) / 0.05) 0%, hsl(var(--foreground) / 0.02) 100%)",
          boxShadow: selected
            ? [
                // top highlight (light catching the edge)
                "inset 0 1px 0 hsl(0 0% 100% / 0.18)",
                // bottom shadow (self-cast on the surface beneath the edge)
                "inset 0 -1px 0 hsl(var(--m-accent) / 0.35)",
                // crisp accent ring — the "selected" tell, not a border so it doesn't add geometry
                "0 0 0 1.5px hsl(var(--m-accent) / 0.45)",
                // outer drop shadow gives lift
                "0 6px 18px -10px hsl(var(--m-accent) / 0.55)",
                "0 2px 6px -2px hsl(var(--m-accent) / 0.25)",
              ].join(", ")
            : [
                "inset 0 1px 0 hsl(0 0% 100% / 0.06)",
                "inset 0 -1px 0 hsl(0 0% 0% / 0.10)",
                "0 0 0 1px hsl(var(--border) / 0.55)",
                "0 2px 6px -3px hsl(0 0% 0% / 0.18)",
              ].join(", "),
        } as CSSProperties
      }
    >
      {/* Icon disc — also pebble-styled to echo the parent shape */}
      <span
        className="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-xl transition-colors duration-150"
        style={
          selected
            ? {
                background:
                  "linear-gradient(180deg, hsl(var(--m-accent) / 0.30) 0%, hsl(var(--m-accent) / 0.16) 100%)",
                boxShadow:
                  "inset 0 1px 0 hsl(0 0% 100% / 0.18), inset 0 -1px 0 hsl(var(--m-accent) / 0.30), 0 0 0 1px hsl(var(--m-accent) / 0.35)",
                color: `hsl(${method.accent})`,
              }
            : {
                background:
                  "linear-gradient(180deg, hsl(var(--foreground) / 0.08) 0%, hsl(var(--foreground) / 0.04) 100%)",
                boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.08), inset 0 -1px 0 hsl(0 0% 0% / 0.06)",
                color: "hsl(var(--foreground) / 0.7)",
              }
        }
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
      </span>
      <span className="relative z-[1] min-w-0 flex-1">
        <span className="block text-[12px] font-semibold leading-tight truncate">{method.label}</span>
        {!compact && (
          <span className="block text-[10px] leading-tight mt-0.5 truncate text-secondary-fg/65">
            {method.blurb}
          </span>
        )}
      </span>
      {selected && (
        <Check className="relative z-[1] h-3 w-3 shrink-0" style={{ color: `hsl(${method.accent})` }} strokeWidth={3} />
      )}
    </button>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: PaymentField;
  value: string;
  onChange: (v: string) => void;
}) {
  // Inputs sit "recessed" inside the parent detail card: a soft top inset
  // shadow makes them look like they're milled into the surface, opposite
  // of the convex method chips above. Together the contrast (raised
  // chips, sunken fields) reads as a single coherent piece of hardware.
  const inputShadow = [
    "inset 0 1px 2px hsl(0 0% 0% / 0.08)",
    "inset 0 0 0 1px hsl(var(--border) / 0.45)",
  ].join(", ");

  if (field.options) {
    return (
      <label className="block space-y-1">
        <span className="text-[10px] font-medium text-secondary-fg/75 px-0.5">{field.label}</span>
        <div className="relative">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-full appearance-none rounded-xl border-0 bg-card/55 pl-3 pr-8 text-[13px] text-foreground outline-none transition-colors focus:bg-card/75"
            style={{ boxShadow: inputShadow }}
          >
            <option value="">{field.placeholder}</option>
            {field.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-fg/60" />
        </div>
      </label>
    );
  }

  if (field.multiline) {
    return (
      <label className="block space-y-1">
        <span className="text-[10px] font-medium text-secondary-fg/75 px-0.5">{field.label}</span>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="min-h-[68px] rounded-xl border-0 bg-card/55 text-[13px] leading-snug placeholder:text-secondary-fg/55 focus-visible:ring-0"
          style={{ boxShadow: inputShadow }}
        />
      </label>
    );
  }

  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-medium text-secondary-fg/75 px-0.5">{field.label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className="h-10 rounded-xl border-0 bg-card/55 text-[13px] placeholder:text-secondary-fg/55 focus-visible:ring-0"
        style={{ boxShadow: inputShadow }}
      />
    </label>
  );
}
