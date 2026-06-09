-- Track when a block was created as a carry/move copy of another block.
-- Presence of source_block_id (non-null) means "this is a copy" — the client
-- uses this to delete the copy cleanly on subsequent moves instead of leaving
-- a "moved to…" stub on every intermediate day.
alter table blocks
  add column if not exists source_block_id uuid references blocks(id) on delete set null;
