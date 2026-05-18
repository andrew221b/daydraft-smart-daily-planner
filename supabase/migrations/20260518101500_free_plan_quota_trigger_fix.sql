-- Fix: the previous trigger blocked re-adding tasks to a day that already had
-- blocks, because it counted "other dates with blocks ≥ 5". The correct rule:
-- if the target date is already counted (has any block), this insert is free.
-- Only block when the target date is NEW and the total distinct used dates
-- already ≥ 5.

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
  v_already_counted boolean;
  FREE_LIMIT constant int := 5;
BEGIN
  v_user_id := NEW.user_id;
  SELECT date INTO v_plan_date FROM public.plans WHERE id = NEW.plan_id;
  IF v_plan_date IS NULL THEN
    RETURN NEW;
  END IF;

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

  IF v_tier IS NULL OR v_tier = 'free' THEN
    -- Is the target date already counted (has any existing block)?
    SELECT EXISTS (
      SELECT 1
      FROM public.blocks b
      JOIN public.plans p ON p.id = b.plan_id
      WHERE p.user_id = v_user_id
        AND p.date = v_plan_date
    ) INTO v_already_counted;

    IF v_already_counted THEN
      RETURN NEW; -- adding more tasks to an already-counted day is free
    END IF;

    -- Target date is new. Reject if user is already at the limit.
    SELECT COUNT(DISTINCT p.date)
    INTO v_used
    FROM public.plans p
    JOIN public.blocks b ON b.plan_id = p.id
    WHERE p.user_id = v_user_id;

    IF v_used >= FREE_LIMIT THEN
      RAISE EXCEPTION 'PLAN_QUOTA_REACHED: free trial limit reached — % planning days used. Upgrade to Pro for unlimited plans.', FREE_LIMIT
        USING ERRCODE = 'P0001', HINT = 'upgrade_required';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
