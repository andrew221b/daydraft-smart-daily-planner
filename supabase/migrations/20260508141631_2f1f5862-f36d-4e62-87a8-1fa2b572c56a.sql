-- Wipe runaway categories accumulated by an earlier bug; clear time entries too
DELETE FROM public.time_entries;
DELETE FROM public.time_categories;

-- Re-seed a single default "Work" category for every existing profile
INSERT INTO public.time_categories (user_id, name, color, is_default)
SELECT p.id, 'Work', '#6366f1', true
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.time_categories tc WHERE tc.user_id = p.id
);