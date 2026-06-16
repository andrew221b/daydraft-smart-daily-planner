-- Manual start-time adjustments on tracked sessions are now an immutable audit
-- record, separate from the user-editable `note`. Previously the reason for
-- "+30m" was appended to the note, which meant the user could delete the reason
-- from notes while keeping the added time — defeating the point of requiring it.
--
--   adjustment_seconds : cumulative manually-added time in seconds (signed;
--                        positive = start moved earlier = time added).
--   adjustment_reason  : append-only audit log, one "+30m — reason" line per
--                        adjustment. Set only by the time-adjust flow; never
--                        editable through the notes UI.
--
-- Both columns are read alongside the row (never filtered on), so no index is
-- needed. They inherit the table's existing RLS.
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS adjustment_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_reason text;
