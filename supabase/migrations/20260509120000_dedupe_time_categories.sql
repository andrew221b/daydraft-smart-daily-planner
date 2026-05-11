-- Merge duplicate tracker categories (same user + case-insensitive name),
-- re-point time entries, delete extras, then enforce uniqueness.

WITH ranked AS (
  SELECT
    id,
    user_id,
    lower(trim(name)) AS nk,
    is_default,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(trim(name))
      ORDER BY is_default DESC, created_at ASC
    ) AS rn
  FROM public.time_categories
),
reassign AS (
  SELECT r.id AS dup_id, k.id AS keeper_id
  FROM ranked r
  JOIN ranked k ON r.user_id = k.user_id AND r.nk = k.nk AND k.rn = 1
  WHERE r.rn > 1
)
UPDATE public.time_entries e
SET category_id = r.keeper_id
FROM reassign r
WHERE e.category_id = r.dup_id;

-- CTE scope is per-statement; repeat `ranked` for this DELETE.
WITH ranked AS (
  SELECT
    id,
    user_id,
    lower(trim(name)) AS nk,
    is_default,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(trim(name))
      ORDER BY is_default DESC, created_at ASC
    ) AS rn
  FROM public.time_categories
)
DELETE FROM public.time_categories c
WHERE c.id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_time_categories_user_name_lower
ON public.time_categories (user_id, (lower(trim(name))));
