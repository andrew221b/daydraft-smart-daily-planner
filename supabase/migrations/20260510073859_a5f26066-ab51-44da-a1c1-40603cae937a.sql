ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_context_custom TEXT;
ALTER TABLE public.blocks ADD COLUMN IF NOT EXISTS parallel_with UUID;