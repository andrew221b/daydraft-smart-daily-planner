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
  const ids = blocks
    .filter((b) => {
      if (!isOpenUserTask(b)) return false;
      const endMs = wallMsOnPlanDay(planDateYmd, blockSlotEndHHMM(b));
      return endMs < now;
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
