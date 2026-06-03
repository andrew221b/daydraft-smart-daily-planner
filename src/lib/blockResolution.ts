import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/daydraft";
import { isOpenUserTask, todayDateStr, planBlockInstants, shiftDate } from "@/lib/daydraft";

/**
 * User tasks whose planned window has ended but are still "open" → mark missed (idempotent).
 * Returns true if any row was updated.
 */
export async function applyAutoMissedBlocks(
  supabase: SupabaseClient,
  planDateYmd: string,
  blocks: Block[],
): Promise<boolean> {
  const now = Date.now();
  // Cross-midnight aware slot ends: a task packed past midnight ("00:30") must
  // resolve to the real next-day instant, not this morning — otherwise it would
  // be marked missed the moment it's created.
  const instants = planBlockInstants(planDateYmd, blocks as any);

  // Policy: write missed for today's plan, OR a yesterday plan that's still an
  // in-progress overnight session (its last slot end is still in the future).
  // A fully-past historical day stays read-only to avoid mutating history.
  if (planDateYmd !== todayDateStr()) {
    let lastEnd = 0;
    for (const v of instants.values()) lastEnd = Math.max(lastEnd, v.endMs);
    const isActiveNightPlan = planDateYmd === shiftDate(todayDateStr(), -1) && lastEnd > now;
    if (!isActiveNightPlan) return false;
  }
  // Grace: only auto-mark missed when the block existed before its slot end.
  // Without this, creating a plan retroactively (e.g. typing tasks at 21:00
  // with default 09:00 starts) instantly marks every block "missed".
  const GRACE_MS = 60_000;
  // Fallback threshold: if a block has been past its end for > 10 minutes,
  // mark it missed even when created_at is unavailable or after the end time.
  // This covers AI-generated plans where generation took until after the task's
  // scheduled end time, leaving those tasks permanently "active" under the
  // strict created_at < endMs check.
  const LONG_PAST_MS = 10 * 60_000;
  const ids = blocks
    .filter((b) => {
      if (!isOpenUserTask(b)) return false;
      const endMs = instants.get(b.id)?.endMs ?? 0;
      if (!endMs || endMs >= now) return false;
      const pastEnd = now - endMs;
      const createdAtRaw = (b as any).created_at as string | undefined;
      const createdMs = createdAtRaw ? Date.parse(createdAtRaw) : NaN;
      // No created_at: still mark missed if the slot clearly ended long ago.
      if (!Number.isFinite(createdMs)) return pastEnd > LONG_PAST_MS;
      // Normal case: block was created before its end time (real planned task).
      if (createdMs + GRACE_MS < endMs) return true;
      // Created at or after end time (retroactive / late AI generation): only
      // mark missed once it's been past the end long enough that it's unambiguous.
      return pastEnd > LONG_PAST_MS;
    })
    .map((b) => b.id);
  if (!ids.length) return false;
  const iso = new Date().toISOString();
  const { error } = await supabase
    .from("blocks")
    .update({ resolution: "missed", resolved_at: iso, completed: false })
    .in("id", ids);
  if (error) {
    console.error(error);
    return false;
  }
  return true;
}
