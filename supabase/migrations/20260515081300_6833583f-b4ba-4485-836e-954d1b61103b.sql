ALTER TABLE public.time_categories
  ADD COLUMN IF NOT EXISTS hourly_rate numeric,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS billing_display_name text,
  ADD COLUMN IF NOT EXISTS billing_bank_name text,
  ADD COLUMN IF NOT EXISTS billing_iban text,
  ADD COLUMN IF NOT EXISTS billing_crypto_network text,
  ADD COLUMN IF NOT EXISTS billing_crypto_wallet text,
  ADD COLUMN IF NOT EXISTS billing_payment_link text,
  ADD COLUMN IF NOT EXISTS billing_notes text,
  ADD COLUMN IF NOT EXISTS daily_cap_minutes integer,
  ADD COLUMN IF NOT EXISTS cap_notify_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_time_categories_user_id ON public.time_categories(user_id);