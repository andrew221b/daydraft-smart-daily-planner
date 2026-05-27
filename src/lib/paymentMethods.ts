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
};

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
};

const CRYPTO_NETWORKS = [
  "Ethereum (ERC-20)",
  "Bitcoin",
  "Tron (TRC-20)",
  "Solana",
  "BNB Chain (BEP-20)",
  "Polygon",
  "TON",
  "Arbitrum",
  "Optimism",
  "Base",
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: "Bank transfer",
    label: "Bank transfer",
    blurb: "Account + routing",
    Icon: Landmark,
    detailTitle: "Bank details",
    accent: "215 80% 56%",
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
    fields: [
      { key: "display_name", label: "Payee name", placeholder: "Name on Wise account" },
      { key: "payment_link", label: "Wise email or wisetag", placeholder: "name@example.com or @wisetag" },
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
    fields: [
      { key: "payment_link", label: "PayPal email or paypal.me link", placeholder: "name@example.com or paypal.me/handle" },
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
    fields: [
      { key: "payment_link", label: "Stripe payment link", placeholder: "https://buy.stripe.com/…" },
      { key: "notes", label: "Notes", placeholder: "What this link covers, expiry, etc.", multiline: true },
    ],
  },
  {
    id: "Crypto wallet",
    label: "Crypto",
    blurb: "Wallet + network",
    Icon: Coins,
    detailTitle: "Crypto wallet",
    accent: "30 90% 55%",
    fields: [
      { key: "crypto_network", label: "Network", placeholder: "Select network", options: CRYPTO_NETWORKS },
      { key: "crypto_wallet", label: "Wallet address", placeholder: "0x… · bc1… · TRX… · etc." },
      { key: "notes", label: "Notes", placeholder: "Token (USDT/USDC), memo/tag, network warning…", multiline: true },
    ],
  },
  {
    id: "Revolut",
    label: "Revolut",
    blurb: "Revtag / phone",
    Icon: Smartphone,
    detailTitle: "Revolut details",
    accent: "220 15% 25%",
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
    fields: [
      { key: "display_name", label: "Payee name", placeholder: "Full legal name" },
      { key: "payment_link", label: "Email or phone", placeholder: "name@example.com or +1 416…" },
      {
        key: "notes",
        label: "Security Q & A",
        placeholder: "Q: …\nA: …\n\nLeave blank if your account auto-deposits.",
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
    fields: [
      { key: "display_name", label: "Payee name", placeholder: "Full name or company" },
      { key: "payment_link", label: "Payment link or handle", placeholder: "Any URL or identifier" },
      { key: "notes", label: "Notes", placeholder: "Step-by-step for the payer", multiline: true },
    ],
  },
];

export const PAYMENT_METHOD_IDS: readonly string[] = PAYMENT_METHODS.map((m) => m.id);

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

export type { LucideIcon };
