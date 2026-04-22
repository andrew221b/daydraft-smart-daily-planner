-- Wipe ALL preview data including auth users (cascades to profiles, plans, blocks, etc. via user_id matching).
DELETE FROM public.blocks;
DELETE FROM public.plans;
DELETE FROM public.block_templates;
DELETE FROM public.quick_captures;
DELETE FROM public.streaks;
DELETE FROM public.subscriptions;
DELETE FROM public.user_patterns;
DELETE FROM public.push_subscriptions;
DELETE FROM public.calendar_tokens;
DELETE FROM public.profiles;
DELETE FROM auth.users;