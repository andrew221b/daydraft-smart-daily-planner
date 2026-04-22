-- One-shot reset for current test user
DO $$
DECLARE uid uuid := '5b717c2c-cf20-45c8-af9a-c2aec6d32668';
BEGIN
  DELETE FROM public.blocks             WHERE user_id = uid;
  DELETE FROM public.plans              WHERE user_id = uid;
  DELETE FROM public.block_templates    WHERE user_id = uid;
  DELETE FROM public.quick_captures     WHERE user_id = uid;
  DELETE FROM public.time_entries       WHERE user_id = uid;
  DELETE FROM public.time_categories    WHERE user_id = uid;
  DELETE FROM public.push_subscriptions WHERE user_id = uid;
  DELETE FROM public.calendar_tokens    WHERE user_id = uid;
  DELETE FROM public.user_patterns      WHERE user_id = uid;
  DELETE FROM public.subscriptions      WHERE user_id = uid;
  DELETE FROM public.streaks            WHERE user_id = uid;
  UPDATE public.profiles
     SET onboarded = false,
         tour_seen = '{}'::jsonb,
         energy_zones = NULL,
         passkey_enabled = false,
         notifications_enabled = false,
         install_prompted_at = NULL
   WHERE id = uid;
END $$;