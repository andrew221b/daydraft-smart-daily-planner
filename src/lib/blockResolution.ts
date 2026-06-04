import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/daydraft";
import { isOpenUserTask, todayDateStr, planBlockInstants, shiftDate } from "@/lib/daydraft";

/**
 * User tasks whose planned window has ended but are still "open" → mark missed (idempotent).
 * Returns the blocks it flipped (id + the resolved_at it stamped) so the caller can
 * update its local/cached state INSTANTLY instead of waiting on a refetch round-trip.
 * Empty array = nothing changed.
 */
export async function applyAutoMissedBlocks(
  supabase: SupabaseClient,
  planDateYmd: string,
  blocks: Block[],
): Promise<Array<{ id: string; resolved_at: string }>> {
  const now = Date.now();
  // Cross-midnight aware slot ends: a task packed past midnight ("00:30") must
  // resolve to the real next-day instant, not this morning — otherwise it would
  // be marked missed the moment it's created.
  const instants = planBlockInstants(planDateYmd, blocks);

  // Policy: write missed for today's plan, OR a yesterday plan that's still an
  // in-progress overnight session (its last slot end is still in the future).
  // A fully-past historical day stays read-only to avoid mutating history.
  if (planDateYmd !== todayDateStr()) {
    let lastEnd = 0;
    for (const v of instants.values()) lastEnd = Math.max(lastEnd, v.endMs);
    const isActiveNightPlan = planDateYmd === shiftDate(todayDateStr(), -1) && lastEnd > now;
    if (!isActiveNightPlan) return [];
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
  const autoMissBlocks = blocks
    .filter((b) => {
      if (!isOpenUserTask(b)) return false;
      if (Number((b as { duration_min?: number }).duration_min) <= 0) return false;
      const endMs = instants.get(b.id)?.endMs ?? 0;
      if (!endMs || endMs >= now) return false;
      const pastEnd = now - endMs;
      const createdAtRaw = (b as { created_at?: string }).created_at;
      const createdMs = createdAtRaw ? Date.parse(createdAtRaw) : NaN;
      if (!Number.isFinite(createdMs)) return pastEnd > LONG_PAST_MS;
      if (createdMs + GRACE_MS < endMs) return true;
      return pastEnd > LONG_PAST_MS;
    });

  if (!autoMissBlocks.length) return [];

  const missed = autoMissBlocks.map((b) => {
    // Stamp the exact time the slot ended, rather than the current time
    const endMs = instants.get(b.id)?.endMs;
    return { id: b.id, resolved_at: endMs ? new Date(endMs).toISOString() : new Date().toISOString() };
  });

  const results = await Promise.all(
    missed.map((m) =>
      supabase
        .from("blocks")
        .update({ resolution: "missed", resolved_at: m.resolved_at, completed: false })
        .eq("id", m.id),
    ),
  );
  const error = results.find((r) => r.error)?.error;

  if (error) {
    console.error(error);
    return [];
  }
  return missed;
}
