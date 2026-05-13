CREATE TABLE IF NOT EXISTS public.billing_payment_details (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  iban TEXT,
  bank_name TEXT,
  crypto_wallet TEXT,
  crypto_network TEXT,
  payment_link TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_payment_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own billing payment details select"
  ON public.billing_payment_details
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own billing payment details insert"
  ON public.billing_payment_details
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own billing payment details update"
  ON public.billing_payment_details
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "own billing payment details delete"
  ON public.billing_payment_details
  FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS billing_payment_details_set_updated_at ON public.billing_payment_details;
CREATE TRIGGER billing_payment_details_set_updated_at
  BEFORE UPDATE ON public.billing_payment_details
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
