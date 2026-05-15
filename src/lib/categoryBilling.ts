import type { ReportPaymentDetails } from "@/lib/reportExport";

/** Raw category row from Supabase (snake_case billing fields). */
export type CategoryBillingRow = {
  currency?: string | null;
  payment_method?: string | null;
  billing_display_name?: string | null;
  billing_bank_name?: string | null;
  billing_iban?: string | null;
  billing_crypto_network?: string | null;
  billing_crypto_wallet?: string | null;
  billing_payment_link?: string | null;
  billing_notes?: string | null;
};

export function categoryRowToPaymentDetails(row: CategoryBillingRow | null | undefined): ReportPaymentDetails | null {
  if (!row) return null;
  const d: ReportPaymentDetails = {
    currency: row.currency ?? null,
    paymentMethod: row.payment_method ?? null,
    displayName: row.billing_display_name ?? null,
    bankName: row.billing_bank_name ?? null,
    iban: row.billing_iban ?? null,
    cryptoNetwork: row.billing_crypto_network ?? null,
    cryptoWallet: row.billing_crypto_wallet ?? null,
    paymentLink: row.billing_payment_link ?? null,
    notes: row.billing_notes ?? null,
  };
  return paymentDetailsHasContent(d) ? d : null;
}

export function paymentDetailsHasContent(d: ReportPaymentDetails | null | undefined): boolean {
  if (!d) return false;
  return !!(
    d.displayName?.trim() ||
    d.currency?.trim() ||
    d.paymentMethod?.trim() ||
    d.bankName?.trim() ||
    d.iban?.trim() ||
    d.cryptoNetwork?.trim() ||
    d.cryptoWallet?.trim() ||
    d.paymentLink?.trim() ||
    d.notes?.trim()
  );
}

/** Category-specific fields override global defaults for export. */
export function billingDraftToCategoryUpdate(draft: {
  currency?: string;
  payment_method?: string;
  display_name: string;
  bank_name: string;
  iban: string;
  crypto_network: string;
  crypto_wallet: string;
  payment_link: string;
  notes: string;
}) {
  const b = (v: string) => {
    const t = v.trim();
    return t ? t : null;
  };
  return {
    currency: (draft.currency || "USD").trim().toUpperCase() || "USD",
    payment_method: b(draft.payment_method || ""),
    billing_display_name: b(draft.display_name),
    billing_bank_name: b(draft.bank_name),
    billing_iban: b(draft.iban),
    billing_crypto_network: b(draft.crypto_network),
    billing_crypto_wallet: b(draft.crypto_wallet),
    billing_payment_link: b(draft.payment_link),
    billing_notes: b(draft.notes),
  };
}

export function categoryBillingToDraft(row: CategoryBillingRow & Record<string, unknown>): {
  currency: string;
  payment_method: string;
  display_name: string;
  bank_name: string;
  iban: string;
  crypto_network: string;
  crypto_wallet: string;
  payment_link: string;
  notes: string;
} {
  return {
    currency: String(row.currency ?? "USD"),
    payment_method: String(row.payment_method ?? ""),
    display_name: String(row.billing_display_name ?? ""),
    bank_name: String(row.billing_bank_name ?? ""),
    iban: String(row.billing_iban ?? ""),
    crypto_network: String(row.billing_crypto_network ?? ""),
    crypto_wallet: String(row.billing_crypto_wallet ?? ""),
    payment_link: String(row.billing_payment_link ?? ""),
    notes: String(row.billing_notes ?? ""),
  };
}

export function mergeCategoryPayment(
  cat: CategoryBillingRow | null | undefined,
  global: ReportPaymentDetails | null | undefined,
): ReportPaymentDetails | null {
  const c = categoryRowToPaymentDetails(cat);
  const g = global && paymentDetailsHasContent(global) ? global : null;
  if (!c && !g) return null;
  if (!c) return g;
  if (!g) return c;
  return {
    currency: c.currency?.trim() || g.currency || null,
    paymentMethod: c.paymentMethod?.trim() || g.paymentMethod || null,
    displayName: c.displayName?.trim() || g.displayName || null,
    bankName: c.bankName?.trim() || g.bankName || null,
    iban: c.iban?.trim() || g.iban || null,
    cryptoNetwork: c.cryptoNetwork?.trim() || g.cryptoNetwork || null,
    cryptoWallet: c.cryptoWallet?.trim() || g.cryptoWallet || null,
    paymentLink: c.paymentLink?.trim() || g.paymentLink || null,
    notes: [c.notes?.trim(), g.notes?.trim()].filter(Boolean).join("\n\n") || null,
  };
}
