import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/daydraft";
import { isOpenUserTask, planBlockInstants, wallMsOnPlanDay, blockSlotEndHHMM, timeToMinutes } from "@/lib/daydraft";

/**
 * User tasks whose planned window has ended but are still "open" → mark missed (idempotent).
 * Returns the blocks it flipped (id + the resolved_at it stamped) so the caller can
 * update its local/cached state INSTANTLY instead of waiting on a refetch round-trip.
 * Empty array = nothing changed.
 *
 * Runs for ANY date (today, yesterday, older past days). Past-day tasks that were
 * never resolved correctly show as "open" dashed circles otherwise — this is wrong,
 * they should all be "missed". The existing `endMs >= now` filter is the only guard
 * needed: only tasks whose window has genuinely passed get marked.
 */
export async function applyAutoMissedBlocks(
  supabase: SupabaseClient,
  planDateYmd: string,
  blocks: Block[],
): Promise<Array<{ id: string; resolved_at: string }>> {
  const now = Date.now();
  // End instant per block. CRITICAL: this must be independent of the array order
  // we're handed — `blocks` arrives in *display* order (active-first, resolved at
  // the bottom), so a late-time resolved task sitting before an earlier active
  // task would make planBlockInstants' cursor walk see a "midnight wrap" and push
  // the active task's end to *tomorrow* — leaving a long-overdue task forever
  // "active" instead of missed (the exact bug this fixes).
  //
  // For the common, non-cross-midnight plan we derive each end directly from its
  // own start + duration on the plan day — purely per-block, order-proof. We only
  // fall back to the order-sensitive cursor walk when the plan genuinely spans
  // midnight (some slot's end clock time precedes its start), where positional
  // ordering is the only way to know which day a "00:30" slot belongs to.
  // Frameless tasks (duration_min = 0) have no explicit slot end, but they
  // should still be missed once the plan day is over. Use local midnight
  // (00:00 of the following day) as their deadline so they stay "open" all
  // day but become "missed" as soon as the day rolls over.
  const [py, pmo, pd] = planDateYmd.split("-").map(Number);
  const endOfDayMs = new Date(py, (pmo || 1) - 1, (pd || 1) + 1, 0, 0, 0, 0).getTime();

  const crossesMidnight = blocks.some(
    (b) => timeToMinutes(blockSlotEndHHMM(b)) < timeToMinutes(b.start_time),
  );
  const instants = crossesMidnight
    ? planBlockInstants(planDateYmd, blocks)
    : new Map(
        blocks.map((b) => {
          const startMs = wallMsOnPlanDay(planDateYmd, b.start_time);
          const endMs = startMs + Math.max(0, Number(b.duration_min || 0)) * 60_000;
          return [b.id, { startMs, endMs }];
        }),
      );
  // Grace: only auto-mark missed when the block existed before its slot end.
  // Without this, creating a plan retroactively (e.g. typing tasks at 21:00
  // with default 09:00 starts) instantly marks every block "missed".
  const GRACE_MS = 60_000;
  // Fallback threshold: if a block has been past its end for > 2 minutes,
  // mark it missed even when created_at is unavailable or after the end time.
  // This covers AI-generated plans where generation took until after the task's
  // scheduled end time, leaving those tasks permanently "active" under the
  // strict created_at < endMs check.
  const LONG_PAST_MS = 2 * 60_000;

  // Effective deadline per block: timed tasks use slot end; frameless use end-of-day.
  const blockEndMs = (b: Block): number => {
    if (Number(b.duration_min || 0) <= 0) return endOfDayMs;
    return instants.get(b.id)?.endMs ?? 0;
  };

  const autoMissBlocks = blocks
    .filter((b) => {
      if (!isOpenUserTask(b)) return false;
      const endMs = blockEndMs(b);
      if (!endMs || endMs >= now) return false;
      const pastEnd = now - endMs;
      const createdAtRaw = (b as { created_at?: string }).created_at;
      const createdMs = createdAtRaw ? Date.parse(createdAtRaw) : NaN;
      if (!Number.isFinite(createdMs)) return pastEnd > LONG_PAST_MS;
      if (createdMs + GRACE_MS < endMs) return true;
      return pastEnd > LONG_PAST_MS;
    });

  if (!autoMissBlocks.length) return [];

  const missed = autoMissBlocks.map((b) => ({
    id: b.id,
    // Stamp the exact deadline (slot end for timed tasks, midnight for frameless).
    resolved_at: new Date(blockEndMs(b)).toISOString(),
  }));

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
