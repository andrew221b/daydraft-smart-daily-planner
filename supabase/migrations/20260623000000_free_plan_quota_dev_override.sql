-- Bug fix: enforce_free_plan_quota() determined tier purely from
-- subscriptions.status, with no awareness of profiles.is_developer — even
-- though generate-plan/index.ts treats is_developer = true as full Pro
-- (profRow?.is_developer === true -> tier = "pro"). Any developer-flagged
-- account with no subscriptions row was silently capped at 5 plan-days by
-- this trigger despite the app believing it had unlimited Pro access.
--
-- Fix: short-circuit to "unlimited" for is_developer accounts, before the
-- subscriptions lookup, mirroring the edge function's own tier rule exactly.

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
  v_is_developer boolean;
  FREE_LIMIT constant int := 5;
BEGIN
  v_user_id := NEW.user_id;

  SELECT is_developer INTO v_is_developer FROM public.profiles WHERE id = v_user_id;
  IF v_is_developer THEN
    RETURN NEW;
  END IF;

  SELECT date INTO v_plan_date FROM public.plans WHERE id = NEW.plan_id;
  IF v_plan_date IS NULL THEN
    RETURN NEW; -- orphan or in-flight; let other constraints handle it.
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
    SELECT EXISTS (
      SELECT 1 FROM public.blocks b JOIN public.plans p ON p.id = b.plan_id
      WHERE p.user_id = v_user_id AND p.date = v_plan_date
    ) INTO v_already_counted;

    IF v_already_counted THEN
      RETURN NEW;
    END IF;

    SELECT COUNT(DISTINCT p.date) INTO v_used
    FROM public.plans p JOIN public.blocks b ON b.plan_id = p.id
    WHERE p.user_id = v_user_id;

    IF v_used >= FREE_LIMIT THEN
      RAISE EXCEPTION 'PLAN_QUOTA_REACHED: free trial limit reached — % planning days used. Upgrade to Pro for unlimited plans.', FREE_LIMIT
        USING ERRCODE = 'P0001', HINT = 'upgrade_required';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
