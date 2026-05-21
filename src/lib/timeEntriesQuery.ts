import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";

/**
 * One shared 60-day rolling window of time_entries, keyed by user id. Home,
 * Reports, Tracker, and the home tracker hero all derive what they need from
 * this single cache. Previously each surface ran its own SELECT against
 * `time_entries` with overlapping ranges — switching tabs paid the network
 * round-trip every time. With one source of truth a tab switch is a free
 * cache read.
 *
 * 60 days covers every in-app surface: today (Home), this week (Tracker week
 * tab + Reports `week`), this month (Tracker month tab + Reports `month`).
 * Exporting a wider report range still re-queries on demand via
 * `fetchExtendedEntries` but that path is paywalled and rare.
 */
export const ROLLING_ENTRIES_DAYS = 60;

export const ROLLING_ENTRIES_SELECT =
  "id,category_id,started_at,ended_at,note,block_id,source";

export type RollingEntry = {
  id: string;
  category_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  block_id: string | null;
  source: string | null;
};

export const ROLLING_ENTRIES_ROOT = "rolling-time-entries" as const;

export const rollingEntriesQueryKey = (userId: string | undefined) =>
  [ROLLING_ENTRIES_ROOT, userId ?? ""] as const;

function rollingWindowStart(): Date {
  const since = new Date();
  since.setDate(since.getDate() - ROLLING_ENTRIES_DAYS);
  since.setHours(0, 0, 0, 0);
  return since;
}

export async function fetchRollingEntries(userId: string): Promise<RollingEntry[]> {
  const since = rollingWindowStart();
  const { data, error } = await supabase
    .from("time_entries")
    .select(ROLLING_ENTRIES_SELECT)
    .eq("user_id", userId)
    .gte("started_at", since.toISOString())
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RollingEntry[];
}

/** Force a refresh of the shared entries cache after a mutation. */
export async function invalidateRollingEntries(
  queryClient: QueryClient,
  userId: string | undefined,
) {
  if (!userId) return;
  await queryClient.invalidateQueries({ queryKey: rollingEntriesQueryKey(userId) });
}

export type EntriesRange = { from: Date; to: Date };

/** Cheap in-memory filter — assumes the rolling window already covers `range`. */
export function filterEntriesByRange(
  entries: RollingEntry[] | undefined,
  range: EntriesRange,
): RollingEntry[] {
  if (!entries?.length) return [];
  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();
  return entries.filter((e) => {
    const startedMs = new Date(e.started_at).getTime();
    return startedMs >= fromMs && startedMs <= toMs;
  });
}
