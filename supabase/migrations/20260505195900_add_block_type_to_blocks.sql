ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS block_type TEXT;

UPDATE public.blocks
SET block_type = CASE
  WHEN kind IN ('break', 'lunch') THEN 'rest'
  ELSE 'work'
END
WHERE block_type IS NULL;

ALTER TABLE public.blocks
  ALTER COLUMN block_type SET DEFAULT 'work';

ALTER TABLE public.blocks
  ALTER COLUMN block_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blocks_block_type_check'
  ) THEN
    ALTER TABLE public.blocks
      ADD CONSTRAINT blocks_block_type_check
      CHECK (block_type IN ('work', 'rest', 'personal'));
  END IF;
END $$;
