import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";
import { idbGet, idbSet } from "@/lib/idbCache";

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
  "id,category_id,started_at,ended_at,note,block_id,task_title,source,snapshot_hourly_rate,snapshot_currency";

export type RollingEntry = {
  id: string;
  category_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  block_id: string | null;
  task_title: string | null;
  source: string | null;
  snapshot_hourly_rate: number | null;
  snapshot_currency: string | null;
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

const idbKeyFor = (userId: string) => `rolling-entries:${userId}`;

/**
 * Local-first read.
 *
 * On a warm React Query cache this is rarely called — React Query returns
 * the cached array directly. On a cold start (or after `invalidateQueries`),
 * this hits IndexedDB synchronously-ish (one event-loop tick) and *then*
 * fires the live Supabase query. Both writers feed the IDB layer on success
 * so the next cold start is also instant.
 *
 * Why the in-place approach instead of returning the IDB read first and
 * the live result second:
 *   - React Query expects a single `queryFn` result.
 *   - The caller already hydrates incrementally on `useQuery`'s
 *     `placeholderData: keepPreviousData`, which gives the same instant-paint
 *     UX once IDB has primed the cache via `hydrateRollingEntries`.
 */
export async function fetchRollingEntries(userId: string): Promise<RollingEntry[]> {
  const since = rollingWindowStart();
  const { data, error } = await supabase
    .from("time_entries")
    .select(ROLLING_ENTRIES_SELECT)
    .eq("user_id", userId)
    .gte("started_at", since.toISOString())
    .order("started_at", { ascending: false });
  if (error) {
    // Network down or auth hiccup — fall back to whatever we cached last
    // time so the user keeps seeing their data offline.
    const cached = await idbGet<RollingEntry[]>(idbKeyFor(userId));
    if (cached) return cached;
    throw error;
  }
  const list = (data ?? []) as RollingEntry[];
  // Fire-and-forget IDB write; do not block the response.
  void idbSet(idbKeyFor(userId), list);
  return list;
}

/**
 * Pre-warm the React Query cache from IndexedDB. Call once on app start
 * after the user id is known — paints the tracker totals immediately on
 * cold launches without waiting for the network.
 */
export async function hydrateRollingEntries(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  const cached = await idbGet<RollingEntry[]>(idbKeyFor(userId));
  if (!cached) return;
  const existing = queryClient.getQueryData<RollingEntry[]>(rollingEntriesQueryKey(userId));
  // Don't overwrite a live result with a stale snapshot.
  if (existing && existing.length) return;
  queryClient.setQueryData(rollingEntriesQueryKey(userId), cached);
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
  const now = Date.now();
  return entries.filter((e) => {
    const startedMs = new Date(e.started_at).getTime();
    const endedMs = e.ended_at ? new Date(e.ended_at).getTime() : now;
    // Include if the entry overlaps the requested range:
    // It starts before the range ends AND ends after the range starts.
    return startedMs <= toMs && endedMs >= fromMs;
  });
}
