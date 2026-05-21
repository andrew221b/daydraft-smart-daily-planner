import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { todayDateStr } from "@/lib/daydraft";
import {
  fetchPlanDashboard,
  fetchDayPlan,
  planDashboardQueryKey,
  planDayQueryKey,
} from "@/lib/planQueries";
import { entitlementQueryKey, fetchEntitlement } from "@/hooks/useEntitlement";
import { fetchRollingEntries, rollingEntriesQueryKey } from "@/lib/timeEntriesQuery";

/**
 * Warms the React Query cache for everything any tab might want, the moment
 * the user is authenticated. By the time the user taps Reports / Plan /
 * Tracker / Settings, the data is already sitting in `QueryClient` — pages
 * render with content on first paint instead of flashing an empty state.
 *
 * Pages that already mount their own queries on visit (Home, Reports, etc.)
 * will hit this warm cache and skip the network round-trip entirely. Page
 * components keep their `useQuery` calls so each surface remains self-
 * contained; the prefetch is just an eager seed.
 *
 * Runs once per authenticated user and is harmlessly idempotent (React Query
 * de-duplicates concurrent fetches by key).
 */
export function EagerPrefetcher() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const seededForRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user?.id) return;
    if (seededForRef.current === user.id) return;
    seededForRef.current = user.id;

    const userId = user.id;
    const date = todayDateStr();

    // Defer to idle so the auth-resolved render lands first; on slow phones
    // doing 4 parallel network calls inside the same frame visibly delays
    // first paint.
    const seed = () => {
      void queryClient.prefetchQuery({
        queryKey: planDashboardQueryKey(userId, date),
        queryFn: () => fetchPlanDashboard(userId, date),
        staleTime: 30_000,
      });
      void queryClient.prefetchQuery({
        queryKey: planDayQueryKey(userId, date),
        queryFn: () => fetchDayPlan(userId, date),
        staleTime: 30_000,
      });
      void queryClient.prefetchQuery({
        queryKey: entitlementQueryKey(userId),
        queryFn: () => fetchEntitlement(userId),
        staleTime: 5 * 60_000,
      });
      void queryClient.prefetchQuery({
        queryKey: rollingEntriesQueryKey(userId),
        queryFn: () => fetchRollingEntries(userId),
        staleTime: 60_000,
      });
    };

    let idleHandle: ReturnType<typeof requestIdleCallback> | undefined;
    let timerHandle: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestIdleCallback !== "undefined") {
      idleHandle = requestIdleCallback(seed, { timeout: 1500 });
    } else {
      timerHandle = setTimeout(seed, 50);
    }
    return () => {
      if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
      if (timerHandle !== undefined) clearTimeout(timerHandle);
    };
  }, [loading, user?.id, queryClient]);

  return null;
}
