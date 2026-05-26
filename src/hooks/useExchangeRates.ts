import { useQuery } from "@tanstack/react-query";

// Maps CoinGecko IDs → ticker symbol
const CRYPTO_ID_MAP: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  binancecoin: "BNB",
  "the-open-network": "TON",
  tron: "TRX",
  "matic-network": "MATIC",
  litecoin: "LTC",
  ripple: "XRP",
  cardano: "ADA",
  dogecoin: "DOGE",
};

const CRYPTO_IDS = Object.keys(CRYPTO_ID_MAP).join(",");

// ratePerUSD[code] = how many units of `code` equal 1 USD.
// Conversion formula: result = amount * ratePerUSD[to] / ratePerUSD[from]
export type RatesMap = Record<string, number>;

async function fetchFiatRates(): Promise<RatesMap> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
  if (!res.ok) throw new Error("fiat-rates-unavailable");
  const data = await res.json();
  if (data.result !== "success") throw new Error("fiat-rates-error");
  return data.rates as RatesMap; // already ratePerUSD
}

async function fetchCryptoRates(): Promise<RatesMap> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${CRYPTO_IDS}&vs_currencies=usd`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("crypto-rates-unavailable");
  const data = await res.json();
  const out: RatesMap = {};
  for (const [id, prices] of Object.entries(data) as [string, { usd: number }][]) {
    const ticker = CRYPTO_ID_MAP[id];
    if (ticker && prices.usd > 0) {
      // 1 USD = (1 / usdPrice) units of crypto
      out[ticker] = 1 / prices.usd;
    }
  }
  return out;
}

export function useExchangeRates() {
  return useQuery<RatesMap>({
    queryKey: ["exchange-rates"],
    queryFn: async () => {
      const [fiat, crypto] = await Promise.allSettled([fetchFiatRates(), fetchCryptoRates()]);
      const rates: RatesMap = { USD: 1 };
      if (fiat.status === "fulfilled") Object.assign(rates, fiat.value);
      if (crypto.status === "fulfilled") Object.assign(rates, crypto.value);
      // Stablecoins pegged 1:1 to USD
      rates["USDT"] = 1;
      rates["USDC"] = 1;
      rates["DAI"] = 1;
      // EURC pegged to EUR
      if (rates["EUR"]) rates["EURC"] = rates["EUR"];
      return rates;
    },
    staleTime: 60 * 60_000,   // 1 hour — rates don't change that fast
    gcTime: 2 * 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/** Convert `amount` from one currency to another using the rates map. */
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: RatesMap,
): number {
  const fromRate = rates[from.toUpperCase()] ?? 1;
  const toRate = rates[to.toUpperCase()] ?? 1;
  return amount * (toRate / fromRate);
}
