import {
  Landmark,
  Globe2,
  CreditCard,
  Coins,
  Banknote,
  MoreHorizontal,
  Send,
  Smartphone,
  Mail,
  Leaf,
  type LucideIcon,
} from "lucide-react";

/**
 * Keys that map 1:1 onto `categoryBilling` storage columns. Methods reuse the
 * same physical columns where the semantics match (e.g. PayPal handle stored
 * in `payment_link`) — keeps the DB schema flat and avoids per-method tables.
 */
export type PaymentFieldKey =
  | "display_name"
  | "bank_name"
  | "iban"
  | "crypto_network"
  | "crypto_wallet"
  | "payment_link"
  | "notes";

export type PaymentField = {
  key: PaymentFieldKey;
  label: string;
  placeholder: string;
  helper?: string;
  multiline?: boolean;
  /** Renders a <select> instead of <input>. */
  options?: string[];
  /** Field that commonly holds an email — opts it into the soft email-typo
   *  check (advisory only; the field may also legitimately hold a handle,
   *  link, or phone, so the check stays silent unless it looks like an email). */
  emailish?: boolean;
};

/** Rail kind — drives the high-level Fiat/Crypto toggle and currency filter. */
export type PaymentKind = "fiat" | "crypto";

export type PaymentMethod = {
  id: string;
  label: string;
  /** Short flavour text shown under the method name in the picker. */
  blurb: string;
  Icon: LucideIcon;
  /** Section title shown above the conditional fields when selected. */
  detailTitle: string;
  fields: PaymentField[];
  /** HSL triplet — drives the chip accent so each method has its own identity. */
  accent: string;
  /**
   * Bucket the method falls into. Drives the segmented Fiat/Crypto control:
   * picking "Crypto" hides bank/Wise/PayPal etc and filters the currency
   * dropdown to coins only.
   */
  kind: PaymentKind;
};

/**
 * Crypto networks — ordered by how often a freelancer's client actually
 * pays on each chain (descending). The order is intentional:
 *
 *  1. Tron (TRC-20) tops the list because it carries the majority of all
 *     USDT transfers worldwide (cheapest gas → default for cross-border
 *     stablecoin payouts).
 *  2. Ethereum / BNB / Solana — the three other chains that nearly every
 *     stablecoin payer supports.
 *  3. Major EVM L2s next (Polygon, Arbitrum, Optimism, Base) — common for
 *     web3-native clients.
 *  4. Bitcoin family for plain BTC payments.
 *  5. Other big-cap L1s and L2s, then long-tail.
 *  6. "Other (specify in notes)" is the escape hatch so a niche chain
 *     isn't a blocker.
 */
const CRYPTO_NETWORKS = [
  // Tier 1 — dominant chains for stablecoin billing
  "Tron (TRC-20)",
  "Ethereum (ERC-20)",
  "BNB Chain (BEP-20)",
  "Solana",

  // Tier 2 — major EVM L2s
  "Polygon",
  "Arbitrum",
  "Optimism",
  "Base",

  // Tier 3 — BTC family + TON (high consumer awareness)
  "Bitcoin",
  "Bitcoin (Lightning)",
  "TON",

  // Tier 4 — other widely supported L1s
  "Avalanche (C-Chain)",
  "Near",
  "Aptos",
  "Sui",

  // Tier 5 — newer EVM L2s
  "zkSync Era",
  "Linea",
  "Scroll",
  "Mantle",
  "Blast",
  "Starknet",

  // Tier 6 — older / niche big caps
  "Cardano",
  "Polkadot",
  "Cosmos Hub",
  "Hedera",
  "Tezos",
  "Algorand",
  "Stellar",
  "XRP Ledger",
  "Litecoin",
  "Bitcoin Cash",
  "Dogecoin",
  "Fantom",

  // Escape hatch
  "Other (specify in notes)",
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: "Bank transfer",
    label: "Bank transfer",
    blurb: "Account + routing",
    Icon: Landmark,
    detailTitle: "Bank details",
    accent: "215 80% 56%",
    kind: "fiat",
    fields: [
      { key: "display_name", label: "Payee name", placeholder: "Full name or company on account" },
      { key: "bank_name", label: "Bank", placeholder: "Bank name" },
      { key: "iban", label: "Account / SWIFT", placeholder: "Account number or SWIFT/BIC" },
      { key: "notes", label: "Notes", placeholder: "Routing number, branch, memo…", multiline: true },
    ],
  },
  {
    id: "IBAN / SEPA",
    label: "IBAN · SEPA",
    blurb: "Eurozone & UK",
    Icon: Globe2,
    detailTitle: "IBAN / SEPA details",
    accent: "260 70% 60%",
    kind: "fiat",
    fields: [
      { key: "display_name", label: "Payee name", placeholder: "Full name on account" },
      { key: "iban", label: "IBAN", placeholder: "DE89 3704 0044 0532 0130 00" },
      { key: "bank_name", label: "BIC / SWIFT", placeholder: "Optional — needed for some non-SEPA payments" },
      { key: "notes", label: "Reference", placeholder: "Memo shown on the payer's statement", multiline: true },
    ],
  },
  {
    id: "Wise",
    label: "Wise",
    blurb: "Multi-currency",
    Icon: Send,
    detailTitle: "Wise details",
    accent: "150 70% 45%",
    kind: "fiat",
    fields: [
      { key: "display_name", label: "Payee name", placeholder: "Name on Wise account" },
      { key: "payment_link", label: "Wise email or wisetag", placeholder: "name@example.com or @wisetag", emailish: true },
      { key: "notes", label: "Notes", placeholder: "Preferred receiving currency, etc.", multiline: true },
    ],
  },
  {
    id: "PayPal",
    label: "PayPal",
    blurb: "Email handle",
    Icon: Mail,
    detailTitle: "PayPal details",
    accent: "215 85% 50%",
    kind: "fiat",
    fields: [
      { key: "payment_link", label: "PayPal email or paypal.me link", placeholder: "name@example.com or paypal.me/handle", emailish: true },
      { key: "notes", label: "Notes", placeholder: "Friends & family or goods & services?", multiline: true },
    ],
  },
  {
    id: "Stripe link",
    label: "Stripe",
    blurb: "Hosted checkout",
    Icon: CreditCard,
    detailTitle: "Stripe payment link",
    accent: "260 80% 60%",
    kind: "fiat",
    fields: [
      { key: "payment_link", label: "Stripe payment link", placeholder: "https://buy.stripe.com/…" },
      { key: "notes", label: "Notes", placeholder: "What this link covers, expiry, etc.", multiline: true },
    ],
  },
  {
    id: "Revolut",
    label: "Revolut",
    blurb: "Revtag / phone",
    Icon: Smartphone,
    detailTitle: "Revolut details",
    // Electric violet — Revolut's actual brand is dark grey/black which
    // disappears on our dark UI; this keeps the rail identifiable while
    // still feeling distinct from PayPal/Stripe's blues and purples.
    accent: "245 70% 62%",
    kind: "fiat",
    fields: [
      { key: "display_name", label: "Payee name", placeholder: "Full name on Revolut" },
      { key: "payment_link", label: "Revtag or phone", placeholder: "@revtag or +44 7…" },
      { key: "notes", label: "Notes", placeholder: "Reference shown on the transfer", multiline: true },
    ],
  },
  {
    id: "Venmo",
    label: "Venmo",
    blurb: "@username",
    Icon: Smartphone,
    detailTitle: "Venmo details",
    accent: "200 90% 58%",
    kind: "fiat",
    fields: [
      { key: "payment_link", label: "Venmo username", placeholder: "@username" },
      { key: "notes", label: "Notes", placeholder: "What it's for", multiline: true },
    ],
  },
  {
    id: "Interac e-Transfer",
    label: "Interac",
    blurb: "Canada · e-Transfer",
    Icon: Leaf,
    detailTitle: "Interac e-Transfer · Canada",
    accent: "0 80% 55%",
    kind: "fiat",
    fields: [
      { key: "display_name", label: "Payee name", placeholder: "Full legal name" },
      { key: "payment_link", label: "Email or phone", placeholder: "name@example.com or +1 416…", emailish: true },
      {
        key: "notes",
        label: "Security Q & A",
        placeholder: "e.g. Q: Your city?\nA: Ottawa\n\nLeave blank if your account auto-deposits.",
        multiline: true,
      },
    ],
  },
  {
    id: "Cash",
    label: "Cash",
    blurb: "In-person",
    Icon: Banknote,
    detailTitle: "Cash arrangement",
    accent: "120 50% 45%",
    kind: "fiat",
    fields: [
      {
        key: "notes",
        label: "Handoff note",
        placeholder: "Where & when to hand off, currency, any context…",
        multiline: true,
      },
    ],
  },
  {
    id: "Other",
    label: "Other",
    blurb: "Custom rail",
    Icon: MoreHorizontal,
    detailTitle: "Other payment",
    accent: "240 8% 50%",
    kind: "fiat",
    fields: [
      { key: "display_name", label: "Payee name", placeholder: "Full name or company" },
      { key: "payment_link", label: "Payment link or handle", placeholder: "Any URL or identifier" },
      { key: "notes", label: "Notes", placeholder: "Step-by-step for the payer", multiline: true },
    ],
  },
  {
    id: "Crypto wallet",
    label: "Crypto wallet",
    blurb: "Wallet + network",
    Icon: Coins,
    detailTitle: "Crypto wallet",
    accent: "30 90% 55%",
    kind: "crypto",
    fields: [
      { key: "crypto_network", label: "Network", placeholder: "Select network", options: CRYPTO_NETWORKS },
      { key: "crypto_wallet", label: "Wallet address", placeholder: "0x… · bc1… · TRX… · etc." },
      { key: "notes", label: "Notes", placeholder: "Token (USDT/USDC), memo/tag, network warning…", multiline: true },
    ],
  },
];

export const PAYMENT_METHOD_IDS: readonly string[] = PAYMENT_METHODS.map((m) => m.id);

export const FIAT_CURRENCY_CODES = [
  "USD", "EUR", "GBP", "CHF", "CAD", "AUD", "NZD", "JPY", "PLN", "UAH",
  "AED", "SEK", "NOK", "DKK", "CZK", "GEL", "TRY", "SGD", "HKD", "MXN",
  "BRL", "INR", "CNY", "KZT",
] as const;

export const CRYPTO_CURRENCY_CODES = [
  // Stablecoins (most common for billing)
  "USDT", "USDC", "DAI", "EURC",
  // Major coins
  "BTC", "ETH", "SOL", "BNB", "TON", "TRX", "MATIC", "LTC", "XRP", "ADA",
  "DOGE", "AVAX", "ATOM", "DOT", "NEAR", "APT", "SUI",
] as const;

export function getPaymentMethod(id: string | null | undefined): PaymentMethod | null {
  if (!id) return null;
  return PAYMENT_METHODS.find((m) => m.id === id) || null;
}

/** Pick the fallback method picker option label for a legacy/unknown id. */
export function legacyMethodOption(current: string | null | undefined): { id: string; label: string } | null {
  const t = (current || "").trim();
  if (!t) return null;
  if (PAYMENT_METHOD_IDS.includes(t)) return null;
  return { id: t, label: t };
}

/** Derive whether a currency code is crypto or fiat. Defaults to fiat for
 *  unknown codes — preserves backwards compatibility for legacy USD-only data. */
export function currencyKind(code: string | null | undefined): PaymentKind {
  if (!code) return "fiat";
  return (CRYPTO_CURRENCY_CODES as readonly string[]).includes(code.toUpperCase()) ? "crypto" : "fiat";
}

/** Derive the kind from the current payment-details draft. Method wins if
 *  set (because it's the user's explicit choice); otherwise fall back to
 *  currency code, then default to fiat. */
export function inferKind(payment: { payment_method?: string | null; currency?: string | null }): PaymentKind {
  const m = getPaymentMethod(payment?.payment_method);
  if (m) return m.kind;
  return currencyKind(payment?.currency);
}

/**
 * Which chains each coin actually settles on. Drives the network dropdown
 * for the Crypto wallet method so a user picking BTC only sees Bitcoin/
 * Lightning instead of the full 30-chain menu.
 *
 * Lists are ordered by real-world usage frequency (descending) so the
 * default value lands on the chain that matters most for that coin.
 * "Other (specify in notes)" is appended as an escape hatch for any coin
 * that bridges to chains we don't enumerate.
 */
const OTHER_NETWORK = "Other (specify in notes)";
const COIN_NETWORKS: Record<string, string[]> = {
  // Stablecoins — multi-chain by design. Ordering reflects how clients
  // actually pay (TRC-20 dominates USDT; ERC-20/Solana dominate USDC).
  USDT: [
    "Tron (TRC-20)", "Ethereum (ERC-20)", "BNB Chain (BEP-20)", "Solana",
    "Polygon", "Arbitrum", "Optimism", "Base", "TON",
    "Avalanche (C-Chain)", "Near", "Algorand",
  ],
  USDC: [
    "Ethereum (ERC-20)", "Solana", "Base", "Polygon",
    "Arbitrum", "Optimism", "BNB Chain (BEP-20)",
    "Avalanche (C-Chain)", "Tron (TRC-20)", "Near", "Stellar", "Algorand",
  ],
  DAI: [
    "Ethereum (ERC-20)", "Polygon", "Arbitrum", "Optimism",
    "Base", "BNB Chain (BEP-20)",
  ],
  EURC: ["Ethereum (ERC-20)", "Solana", "Stellar"],

  // Native single-chain coins
  BTC: ["Bitcoin", "Bitcoin (Lightning)"],
  ETH: [
    "Ethereum (ERC-20)", "Arbitrum", "Optimism", "Base", "Polygon",
    "zkSync Era", "Linea", "Scroll", "Mantle", "Blast", "Starknet",
  ],
  SOL: ["Solana"],
  BNB: ["BNB Chain (BEP-20)"],
  TON: ["TON"],
  TRX: ["Tron (TRC-20)"],
  MATIC: ["Polygon"],
  LTC: ["Litecoin"],
  XRP: ["XRP Ledger"],
  ADA: ["Cardano"],
  DOGE: ["Dogecoin"],
  AVAX: ["Avalanche (C-Chain)"],
  ATOM: ["Cosmos Hub"],
  DOT: ["Polkadot"],
  NEAR: ["Near"],
  APT: ["Aptos"],
  SUI: ["Sui"],
};

/** Networks the given coin runs on. Falls back to the full list when the
 *  coin is unknown so we never block the user from saving. */
export function networksForCurrency(code: string | null | undefined): string[] {
  const c = (code || "").toUpperCase().trim();
  const known = COIN_NETWORKS[c];
  if (known && known.length) return [...known, OTHER_NETWORK];
  return [...CRYPTO_NETWORKS];
}

export type { LucideIcon };
