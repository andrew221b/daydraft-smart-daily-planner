import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/daydraft";
import { blockSlotEndHHMM, isOpenUserTask, todayDateStr, wallMsOnPlanDay } from "@/lib/daydraft";

/**
 * User tasks whose planned window has ended but are still "open" → mark missed (idempotent).
 * Returns true if any row was updated.
 */
export async function applyAutoMissedBlocks(
  supabase: SupabaseClient,
  planDateYmd: string,
  blocks: Block[],
): Promise<boolean> {
  // Policy: only write missed for the *current* day. Past plans are shown read-only in UI
  // to avoid retroactively mutating history when a user revisits an old date.
  if (planDateYmd !== todayDateStr()) return false;

  const now = Date.now();
  // Grace: only auto-mark missed when the block existed before its slot end.
  // Without this, creating a plan retroactively (e.g. typing tasks at 21:00
  // with default 09:00 starts) instantly marks every block "missed".
  const GRACE_MS = 60_000;
  const ids = blocks
    .filter((b) => {
      if (!isOpenUserTask(b)) return false;
      const endMs = wallMsOnPlanDay(planDateYmd, blockSlotEndHHMM(b));
      if (endMs >= now) return false;
      const createdAtRaw = (b as any).created_at as string | undefined;
      const createdMs = createdAtRaw ? Date.parse(createdAtRaw) : NaN;
      // If we don't know when it was created, be conservative — don't mark missed.
      if (!Number.isFinite(createdMs)) return false;
      // Skip blocks whose entire window was already in the past at creation time.
      return createdMs + GRACE_MS < endMs;
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
