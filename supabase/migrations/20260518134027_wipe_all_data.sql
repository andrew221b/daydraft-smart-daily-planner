-- One-shot factory reset: empties every user-owned table and deletes all
-- auth.users. Schema and RLS policies are untouched. After this runs:
--   • The DB is in the same shape a brand-new project would have.
--   • Anyone signing in re-creates a fresh profile via handle_new_user().
--
-- Safe to leave in /migrations: it has no effect on an already-empty DB.

BEGIN;

-- Public-schema user data. CASCADE handles any FK we haven't listed
-- (e.g. tables added later); RESTART IDENTITY resets sequences.
TRUNCATE TABLE
  public.blocks,
  public.plans,
  public.time_entries,
  public.time_categories,
  public.quick_captures,
  public.block_templates,
  public.push_subscriptions,
  public.user_patterns,
  public.profiles
RESTART IDENTITY CASCADE;

-- Tables that may or may not exist depending on migration history
-- (subscriptions, calendar_tokens, streaks, billing_payment_details).
-- TRUNCATE in a separate DO block so a missing table doesn't abort the txn.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.subscriptions',
    'public.calendar_tokens',
    'public.streaks',
    'public.billing_payment_details'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE %s RESTART IDENTITY CASCADE', t);
    END IF;
  END LOOP;
END $$;

-- Auth users last. The handle_new_user() trigger only fires on INSERT,
-- so DELETE is safe and won't re-create rows.
DELETE FROM auth.users;

COMMIT;
