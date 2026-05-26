import { useState, useMemo, useCallback, memo } from "react";
import { Check, Search, TrendingUp } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { haptics } from "@/lib/haptics";
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/45 bg-popover max-h-[82vh] p-0 flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        {/* Drag handle */}
        <div className="shrink-0 flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-foreground/20" />
        </div>

        {/* Header */}
        <div className="shrink-0 px-5 pt-2 pb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="min-w-[56px] text-[15px] text-secondary-fg hover:text-foreground pressable py-1 transition-colors text-left"
          >
            Cancel
          </button>
          <div className="flex-1 text-center">
            <p className="text-[15px] font-semibold text-foreground/95">Display currency</p>
            {ratesLoading && (
              <p className="text-[11px] text-secondary-fg/55 mt-0.5">Loading live rates…</p>
            )}
          </div>
          <div className="min-w-[56px]" />
        </div>

        {/* Search */}
        <div className="shrink-0 px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-secondary-fg/55 pointer-events-none" />
            <input
              type="text"
              placeholder="USD, Euro, Bitcoin…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-10 pl-9 pr-3 rounded-2xl border border-border/40 bg-foreground/[0.04] text-[14px] placeholder:text-secondary-fg/45 focus:outline-none focus:border-primary/45 transition-colors"
            />
          </div>
        </div>

        {/* List */}
        <div
          className="flex-1 overflow-y-auto px-5 space-y-4"
          style={{ paddingBottom: "max(24px, calc(16px + env(safe-area-inset-bottom, 0px)))" }}
        >
          {fiatFiltered.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/55 mb-2 px-1">
                Fiat
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
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/55 mb-2 px-1 flex items-center gap-1.5">
                <TrendingUp className="h-3 w-3" />
                Crypto
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
      className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3 pressable transition-colors ${
        selected
          ? "border-primary/35 bg-primary/[0.07]"
          : "border-border/30 bg-foreground/[0.02] hover:bg-foreground/[0.05]"
      }`}
    >
      <span
        className="h-6 w-6 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-colors"
        style={{
          borderColor: selected ? "hsl(var(--primary))" : "hsl(var(--border) / 0.55)",
          background: selected ? "hsl(var(--primary) / 0.18)" : "transparent",
        }}
      >
        <Check
          className="h-3.5 w-3.5 text-primary transition-[opacity,transform] duration-150"
          style={{
            opacity: selected ? 1 : 0,
            transform: selected ? "scale(1)" : "scale(0.5)",
          }}
          strokeWidth={3}
        />
      </span>

      <div className="min-w-0 flex-1 text-left">
        <p className="text-[14px] font-semibold text-foreground/95">{code}</p>
        {label && <p className="text-[11px] text-secondary-fg/65 truncate">{label}</p>}
      </div>

      {rate && (
        <p className="text-[11px] tabular-nums text-secondary-fg/55 shrink-0">{rate}</p>
      )}
    </button>
  );
});
