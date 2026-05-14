-- Per-category payment instructions (optional). When set, exports can prefer these over profile defaults.
ALTER TABLE public.time_categories
  ADD COLUMN IF NOT EXISTS billing_display_name text;

ALTER TABLE public.time_categories
  ADD COLUMN IF NOT EXISTS billing_bank_name text;

ALTER TABLE public.time_categories
  ADD COLUMN IF NOT EXISTS billing_iban text;

ALTER TABLE public.time_categories
  ADD COLUMN IF NOT EXISTS billing_crypto_network text;

ALTER TABLE public.time_categories
  ADD COLUMN IF NOT EXISTS billing_crypto_wallet text;

ALTER TABLE public.time_categories
  ADD COLUMN IF NOT EXISTS billing_payment_link text;

ALTER TABLE public.time_categories
  ADD COLUMN IF NOT EXISTS billing_notes text;

COMMENT ON COLUMN public.time_categories.billing_display_name IS 'Optional payee line for this category in billing exports.';
COMMENT ON COLUMN public.time_categories.billing_payment_link IS 'Optional checkout / invoice link for this category.';
