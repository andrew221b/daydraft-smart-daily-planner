-- Free-tier hard cap: ANY day with blocks (AI or manual) counts as a planning
-- day. Once 5 distinct dates are used, inserting blocks for a *new* date is
-- rejected. Adding more blocks to a day that's already counted stays free.
--
-- This duplicates the JS check in supabase/functions/generate-plan/index.ts and
-- the client-side gate in DayView.addBulkRows — but lives at the DB layer so a
-- direct PostgREST call can't slip past.

CREATE OR REPLACE FUNCTION public.enforce_free_plan_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_plan_date date;
  v_tier text;
  v_used int;
  FREE_LIMIT constant int := 5;
BEGIN
  -- Resolve the user + plan date from the row being inserted.
  v_user_id := NEW.user_id;
  SELECT date INTO v_plan_date FROM public.plans WHERE id = NEW.plan_id;
  IF v_plan_date IS NULL THEN
    RETURN NEW; -- orphan or in-flight; let other constraints handle it.
  END IF;

  -- Determine tier. Anything other than active/trialing-with-future-end is free.
  SELECT
    CASE
      WHEN status = 'active' THEN 'pro'
      WHEN status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at > now() THEN 'trial'
      ELSE 'free'
    END
  INTO v_tier
  FROM public.subscriptions
  WHERE user_id = v_user_id
  LIMIT 1;

  -- No subscription row → free.
  IF v_tier IS NULL OR v_tier = 'free' THEN
    -- Count distinct dates with at least one block, EXCLUDING the target date
    -- (so re-adding to an already-counted day is always allowed).
    SELECT COUNT(DISTINCT p.date)
    INTO v_used
    FROM public.plans p
    JOIN public.blocks b ON b.plan_id = p.id
    WHERE p.user_id = v_user_id
      AND p.date <> v_plan_date;

    IF v_used >= FREE_LIMIT THEN
      RAISE EXCEPTION 'PLAN_QUOTA_REACHED: free trial limit reached — % planning days used. Upgrade to Pro for unlimited plans.', FREE_LIMIT
        USING ERRCODE = 'P0001', HINT = 'upgrade_required';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_free_plan_quota_trigger ON public.blocks;
CREATE TRIGGER enforce_free_plan_quota_trigger
  BEFORE INSERT ON public.blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_free_plan_quota();
