
-- Drop unused Stripe columns
ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id;

-- Add Apple IAP columns
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'apple',
  ADD COLUMN IF NOT EXISTS environment TEXT,
  ADD COLUMN IF NOT EXISTS apple_original_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS apple_product_id TEXT,
  ADD COLUMN IF NOT EXISTS apple_latest_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS last_notification_type TEXT,
  ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;

-- Validate platform/environment values via trigger (avoid CHECK with future-proof values)
CREATE OR REPLACE FUNCTION public.validate_subscription_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.platform IS NOT NULL AND NEW.platform NOT IN ('apple','stripe','web','manual') THEN
    RAISE EXCEPTION 'invalid platform: %', NEW.platform;
  END IF;
  IF NEW.environment IS NOT NULL AND NEW.environment NOT IN ('sandbox','production') THEN
    RAISE EXCEPTION 'invalid environment: %', NEW.environment;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_validate ON public.subscriptions;
CREATE TRIGGER subscriptions_validate
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.validate_subscription_row();

-- Unique index for idempotent IAP upserts
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_apple_orig_tx_idx
  ON public.subscriptions (apple_original_transaction_id)
  WHERE apple_original_transaction_id IS NOT NULL;

-- Allow service role (edge functions) to write
DROP POLICY IF EXISTS "service role manage subscriptions" ON public.subscriptions;
CREATE POLICY "service role manage subscriptions"
  ON public.subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
