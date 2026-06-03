-- Snapshot the tracked task's title at session start so it survives block deletion.
-- Nullable: sessions started without a linked block (manual Tracker) have no title.
alter table time_entries add column if not exists task_title text default null;
