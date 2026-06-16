import { useState, useMemo, useCallback, memo } from "react";
import { Check, Search, TrendingUp, Banknote } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { haptics } from "@/lib/haptics";
import { useSheetSwipeDown } from "@/hooks/useSheetSwipeDown";
import type { RatesMap } from "@/hooks/useExchangeRates";

export const CURRENCY_LABELS: Record<string, string> = {
  // Fiat
  USD: "US Dollar",   EUR: "Euro",          GBP: "British Pound",
  CHF: "Swiss Franc", CAD: "Canadian Dollar", AUD: "Australian Dollar",
  NZD: "New Zealand Dollar", JPY: "Japanese Yen", PLN: "Polish Złoty",
  UAH: "Ukrainian Hryvnia", AED: "UAE Dirham", SEK: "Swedish Krona",
  NOK: "Norwegian Krone",   DKK: "Danish Krone", CZK: "Czech Koruna",
  GEL: "Georgian Lari",     TRY: "Turkish Lira", SGD: "Singapore Dollar",
  HKD: "Hong Kong Dollar",  MXN: "Mexican Peso", BRL: "Brazilian Real",
  INR: "Indian Rupee",      CNY: "Chinese Yuan", KZT: "Kazakhstani Tenge",
  // Stablecoins
  USDT: "Tether",   USDC: "USD Coin", DAI: "DAI",  EURC: "Euro Coin",
  // Crypto
  BTC: "Bitcoin",   ETH: "Ethereum",  SOL: "Solana",  BNB: "BNB",
  TON: "Toncoin",   TRX: "TRON",     MATIC: "Polygon", LTC: "Litecoin",
  XRP: "XRP",       ADA: "Cardano",  DOGE: "Dogecoin",
};

const FIAT_CODES = [
  "USD", "EUR", "GBP", "CHF", "CAD", "AUD", "NZD", "JPY", "PLN", "UAH",
  "AED", "SEK", "NOK", "DKK", "CZK", "GEL", "TRY", "SGD", "HKD", "MXN",
  "BRL", "INR", "CNY", "KZT",
];

const CRYPTO_CODES = [
  "BTC", "ETH", "SOL", "BNB", "TON", "TRX", "MATIC", "LTC", "XRP", "ADA",
  "DOGE", "USDT", "USDC", "DAI", "EURC",
];

function fmtRate(code: string, rates: RatesMap): string {
  const rate = rates[code];
  if (!rate || code === "USD") return "";

  // ratePerUSD < 1 means 1 unit of this currency buys more than $1
  // (e.g. BTC: rate ≈ 0.0000105, so 1 BTC = ~$95,000)
  // Show as "1 CODE = $X" for crypto / high-value currencies — far more readable.
  if (rate < 0.1) {
    const usdPer = 1 / rate;
    if (usdPer >= 1_000) return `1 ${code} = $${Math.round(usdPer).toLocaleString()}`;
    return `1 ${code} = $${usdPer.toFixed(2)}`;
  }

  // For stablecoins pegged to USD just show the peg
  if (rate >= 0.99 && rate <= 1.01) return "≈ 1 USD";

  // Normal fiat: "$1 = 0.92 EUR", "$1 = 150 JPY"
  if (rate >= 100) return `$1 = ${Math.round(rate).toLocaleString()} ${code}`;
  return `$1 = ${rate.toFixed(2)} ${code}`;
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selected: string;
  rates: RatesMap;
  ratesLoading: boolean;
  onSelect: (code: string) => void;
};

export function CurrencyPickerSheet({
  open,
  onOpenChange,
  selected,
  rates,
  ratesLoading,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");

  const { fiatFiltered, cryptoFiltered } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const fiat = q
      ? FIAT_CODES.filter((c) => c.toLowerCase().includes(q) || (CURRENCY_LABELS[c] || "").toLowerCase().includes(q))
      : FIAT_CODES;
    const crypto = q
      ? CRYPTO_CODES.filter((c) => c.toLowerCase().includes(q) || (CURRENCY_LABELS[c] || "").toLowerCase().includes(q))
      : CRYPTO_CODES;
    return { fiatFiltered: fiat, cryptoFiltered: crypto };
  }, [query]);

  const pick = useCallback((code: string) => {
    haptics.tap();
    onSelect(code);
    onOpenChange(false);
  }, [onSelect, onOpenChange]);

  const swipe = useSheetSwipeDown(() => onOpenChange(false));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover max-h-[86vh] p-0 flex flex-col overflow-hidden"
        style={swipe.sheetStyle ?? undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        <SheetTitle className="sr-only">Select currency</SheetTitle>
        {/* Primary edge wash — matches premium cards across the app: a thin
            gradient line + a faint inner halo that lifts the sheet off the
            background without committing to a hard-coloured fill. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.55) 50%, transparent 100%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[120px]"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 0%, hsl(var(--primary) / 0.10), transparent 72%)",
          }}
        />

        {/* Drag handle — swipe down to dismiss. Generous top inset so the
            handle clears the rounded corner curve and the header below
            doesn't graze the sheet's top edge. */}
        <div
          className="relative shrink-0 flex justify-center pt-4 pb-2"
          {...swipe.handleProps}
          aria-label="Swipe down to close"
          role="button"
        >
          <div className="h-1 w-10 rounded-full bg-foreground/20" />
        </div>

        {/* Header */}
        <div className="relative shrink-0 px-5 pt-3 pb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="min-w-[56px] text-[14px] font-medium text-secondary-fg hover:text-foreground pressable py-1 transition-colors text-left"
          >
            Cancel
          </button>
          <div className="flex-1 text-center">
            <p className="font-display text-[16px] font-semibold tracking-tight text-foreground/95">
              Display currency
            </p>
            {ratesLoading ? (
              <p className="text-[11px] text-secondary-fg/55 mt-0.5">Loading live rates…</p>
            ) : (
              <p className="text-[11px] text-secondary-fg/60 mt-0.5">Live rates · refreshed daily</p>
            )}
          </div>
          <div className="min-w-[56px]" />
        </div>

        {/* Search */}
        <div className="relative shrink-0 px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-secondary-fg/55 pointer-events-none" />
            <input
              type="text"
              placeholder="USD, Euro, Bitcoin…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-11 pl-10 pr-3 rounded-2xl border border-border/75 bg-foreground/[0.035] text-[14px] placeholder:text-secondary-fg/45 focus:outline-none focus:border-primary/45 focus:bg-foreground/[0.06] transition-colors shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06)] dark:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.05)]"
            />
          </div>
        </div>

        {/* List */}
        <div
          className="relative flex-1 overflow-y-auto px-5 space-y-5 pt-1"
          style={{ paddingBottom: "max(24px, calc(16px + env(safe-area-inset-bottom, 0px)))" }}
        >
          {fiatFiltered.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/65 mb-2.5 px-1 flex items-center gap-1.5">
                <Banknote className="h-3 w-3" strokeWidth={2.4} />
                Fiat
                <span className="text-secondary-fg/45 font-medium tracking-normal normal-case ml-1">
                  · {fiatFiltered.length}
                </span>
              </p>
              <div className="space-y-1.5">
                {fiatFiltered.map((code) => (
                  <CurrencyRow
                    key={code}
                    code={code}
                    label={CURRENCY_LABELS[code] || ""}
                    rate={fmtRate(code, rates)}
                    selected={selected === code}
                    onPick={pick}
                  />
                ))}
              </div>
            </section>
          )}

          {cryptoFiltered.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/65 mb-2.5 px-1 flex items-center gap-1.5">
                <TrendingUp className="h-3 w-3" strokeWidth={2.4} />
                Crypto
                <span className="text-secondary-fg/45 font-medium tracking-normal normal-case ml-1">
                  · {cryptoFiltered.length}
                </span>
              </p>
              <div className="space-y-1.5">
                {cryptoFiltered.map((code) => (
                  <CurrencyRow
                    key={code}
                    code={code}
                    label={CURRENCY_LABELS[code] || ""}
                    rate={fmtRate(code, rates)}
                    selected={selected === code}
                    onPick={pick}
                  />
                ))}
              </div>
            </section>
          )}

          {fiatFiltered.length === 0 && cryptoFiltered.length === 0 && (
            <p className="text-[13px] text-secondary-fg/70 text-center py-10">
              No match for "{query}"
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const CurrencyRow = memo(function CurrencyRow({
  code,
  label,
  rate,
  selected,
  onPick,
}: {
  code: string;
  label: string;
  rate: string;
  selected: boolean;
  onPick: (c: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(code)}
      aria-pressed={selected}
      className={[
        "group relative w-full flex items-center gap-3 rounded-2xl border px-3.5 py-3 pressable transition-[border-color,background-color,box-shadow,transform] duration-200",
        selected
          ? "border-primary/45 bg-primary/[0.10] shadow-[0_0_0_1px_hsl(var(--primary)/0.20),0_10px_28px_-14px_hsl(var(--primary)/0.55)] dark:shadow-[0_0_0_1px_hsl(var(--primary)/0.28),0_12px_30px_-14px_hsl(var(--primary)/0.65)]"
          : "border-border/70 bg-surface/55 hover:border-border/95 hover:bg-surface/85 dark:bg-card/35 dark:hover:bg-card/55 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)] dark:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.03)]",
      ].join(" ")}
    >
      {/* 3D code chip — dimensional avatar that reads on both themes. */}
      <span
        aria-hidden
        className={[
          "relative flex h-9 w-[44px] shrink-0 items-center justify-center rounded-[10px] text-[10px] font-bold tabular-nums tracking-[0.04em] transition-colors",
          selected
            ? "bg-gradient-to-br from-primary/22 to-primary/[0.08] text-primary"
            : "bg-foreground/[0.06] text-foreground/75 group-hover:text-foreground/90 dark:bg-white/[0.05]",
        ].join(" ")}
        style={{
          boxShadow: selected
            ? "inset 0 1px 0 hsl(0 0% 100% / 0.10), inset 0 0 0 1px hsl(var(--primary) / 0.30), 0 2px 6px -2px hsl(var(--primary) / 0.30)"
            : "inset 0 1px 0 hsl(0 0% 100% / 0.06), inset 0 0 0 1px hsl(var(--border) / 0.45)",
        }}
      >
        {code.slice(0, 4)}
      </span>

      <div className="min-w-0 flex-1 text-left">
        <p className="text-[14px] font-semibold text-foreground leading-tight">{code}</p>
        {label && (
          <p className="mt-0.5 text-[11px] text-secondary-fg/75 truncate">{label}</p>
        )}
      </div>

      {rate && (
        <p className="text-[11px] tabular-nums text-secondary-fg/65 shrink-0 mr-1">{rate}</p>
      )}

      <span
        aria-hidden
        className={[
          "ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow] duration-150",
          selected
            ? "bg-primary text-primary-foreground shadow-[0_4px_12px_hsl(var(--primary)/0.45)]"
            : "bg-foreground/[0.04] ring-1 ring-inset ring-border/40",
        ].join(" ")}
      >
        <Check
          className="h-3.5 w-3.5 transition-[opacity,transform] duration-150"
          style={{
            opacity: selected ? 1 : 0,
            transform: selected ? "scale(1)" : "scale(0.6)",
          }}
          strokeWidth={3}
        />
      </span>
    </button>
  );
});
