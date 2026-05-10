-- Planned window end (HH:MM local to plan day). When null, client derives start_time + duration_min.
ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS slot_end_time TEXT;

COMMENT ON COLUMN blocks.slot_end_time IS 'End of scheduled window (HH:MM); Focus & reminders count down to this on the plan date';

-- Backfill: end minute-of-day capped at 23:59.
UPDATE blocks AS b
SET slot_end_time =
  lpad((LEAST(
    split_part(b.start_time, ':', 1)::int * 60 + split_part(b.start_time, ':', 2)::int + coalesce(b.duration_min, 0),
    23 * 60 + 59
  ) / 60)::text, 2, '0')
  || ':'
  || lpad((LEAST(
    split_part(b.start_time, ':', 1)::int * 60 + split_part(b.start_time, ':', 2)::int + coalesce(b.duration_min, 0),
    23 * 60 + 59
  ) % 60)::text, 2, '0')
WHERE b.slot_end_time IS NULL
  AND b.start_time ~ '^\d{2}:\d{2}$'
  AND coalesce(b.duration_min, 0) > 0;
