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
 * When marking a block complete without a prior `actual_minutes` write:
 * - Prefer summed time on `time_entries` for this block (includes an open session up to `endMs`)
 * - Otherwise use wall time from slot start → completion, capped at 24h
 * - If completion happens BEFORE the slot's planned start (and no tracking exists),
 *   we have no honest signal for actual time — return null and let callers omit
 *   the "actual" line rather than fabricating a "1m" value.
 */
export async function resolveActualMinutesOnComplete(
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
  planDateYmd: string,
  startHHMM: string,
  endMs: number,
): Promise<number | null> {
  const { data: entries, error } = await supabase
    .from("time_entries")
    .select("started_at, ended_at")
    .eq("user_id", userId)
    .eq("block_id", blockId);
  if (error) throw error;
  let trackedSec = 0;
  for (const e of entries || []) {
    const s = new Date(e.started_at).getTime();
    const en = e.ended_at ? new Date(e.ended_at).getTime() : endMs;
    trackedSec += Math.max(0, (en - s) / 1000);
  }
  const trackedMin = Math.round(trackedSec / 60);
  if (trackedMin > 0) return Math.max(1, trackedMin);
  const wall = wallMinutesFromSlotStart(planDateYmd, startHHMM, endMs);
  if (wall <= 0) return null;
  return Math.max(1, Math.min(wall, 24 * 60));
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
