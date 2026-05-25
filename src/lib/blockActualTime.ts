import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDateStr } from "@/lib/daydraft";

/** Wall-clock minutes from scheduled slot start on `planDate` to `endMs` (local calendar day + start_time). */
export function wallMinutesFromSlotStart(planDateYmd: string, startHHMM: string, endMs: number): number {
  const [h, m] = startHHMM.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  const slotStart = parseDateStr(planDateYmd);
  slotStart.setHours(h, m, 0, 0);
  return Math.max(0, Math.round((endMs - slotStart.getTime()) / 60000));
}

/**
 * Resolve `actual_minutes` when a block is marked complete:
 *   - sum any `time_entries` for the block (including an open session)
 *   - if there's tracking → return that
 *   - otherwise → return null
 *
 * We *deliberately* don't fall back to wall-clock from slot start. That
 * heuristic looked plausible but produced wildly misleading numbers in
 * the common case: a user batch-completing tasks at end-of-day saw a
 * 12:00 slot reported as "2h 23m actual" simply because they tapped
 * done at 14:23. Without tracking we have no honest signal — let the
 * UI show "planned" instead of inventing one.
 *
 * `planDateYmd` / `startHHMM` are kept in the signature for backward
 * compatibility with callers and tests, even though they're unused now.
 */
export function resolveActualMinutesOnComplete(
  entries: { started_at: string; ended_at: string | null; block_id: string | null }[],
  blockId: string,
  _planDateYmd: string,
  _startHHMM: string,
  endMs: number,
): number | null {
  const blockEntries = entries.filter((e) => e.block_id === blockId);
  let trackedSec = 0;
  for (const e of blockEntries) {
    const s = new Date(e.started_at).getTime();
    const en = e.ended_at ? new Date(e.ended_at).getTime() : endMs;
    trackedSec += Math.max(0, (en - s) / 1000);
  }
  const trackedMin = Math.round(trackedSec / 60);
  return trackedMin > 0 ? Math.max(1, trackedMin) : null;
}

/** Focus session armed timer → minutes (null if never armed). */
export function minutesFromFocusArmSeconds(actualSec: number): number | null {
  if (actualSec <= 0) return null;
  return Math.max(1, Math.round(actualSec / 60));
}

/** For a completed task block: prefer recorded actual minutes, else planned duration. */
export function effectiveDoneMinutes(b: {
  completed: boolean;
  duration_min: number;
  actual_minutes?: number | null;
  resolution?: string | null;
}): number {
  const done = b.resolution === "done" || (b.completed && !b.resolution);
  if (!done) return 0;
  return typeof b.actual_minutes === "number" ? b.actual_minutes : b.duration_min;
}
