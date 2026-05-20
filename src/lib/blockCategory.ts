/**
 * Per-block tracker-category assignment.
 *
 * Stored client-side because the blocks table doesn't carry a category_id
 * column today. The contract is "the user picked this category for the
 * task but hasn't started timing it yet" — once a real time_entry exists,
 * that linkage is the source of truth and this localStorage entry is
 * effectively a draft preference.
 *
 * If/when blocks.tracker_category_id ships in the DB, swap the read/write
 * to hit Supabase here; callers stay the same.
 */

const KEY = (blockId: string) => `dd_block_cat_${blockId}`;

export function getAssignedCategoryId(blockId: string): string | null {
  if (!blockId) return null;
  try {
    const v = localStorage.getItem(KEY(blockId));
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setAssignedCategoryId(blockId: string, categoryId: string): void {
  if (!blockId || !categoryId) return;
  try { localStorage.setItem(KEY(blockId), categoryId); } catch { /* ignore */ }
}

export function clearAssignedCategoryId(blockId: string): void {
  if (!blockId) return;
  try { localStorage.removeItem(KEY(blockId)); } catch { /* ignore */ }
}

/**
 * Best-effort cleanup: remove orphan keys for block ids that no longer
 * exist. Pass the set of block ids currently in the plan; everything
 * else gets dropped. Cheap — runs on Plan mount.
 */
export function pruneAssignedCategories(liveBlockIds: Iterable<string>): void {
  try {
    const live = new Set(liveBlockIds);
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("dd_block_cat_")) continue;
      const id = k.slice("dd_block_cat_".length);
      if (!live.has(id)) toDelete.push(k);
    }
    // Keep at most 200 stale keys before purge to avoid scanning costs on
    // tiny plans.
    if (toDelete.length > 200) {
      toDelete.forEach((k) => localStorage.removeItem(k));
    }
  } catch { /* ignore */ }
}
