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

  // Evaluate the tab-route chunks EARLY so React.lazy never SUSPENDS on a tab
  // tap. This is the real fix for the "tap Plan → 1–2s freeze" bug:
  //
  //   If a chunk isn't evaluated yet when the user taps, the lazy import
  //   resolves mid-navigation and the chunk's *synchronous module evaluation*
  //   (DayView pulls in dnd-kit + the sheets) blocks the main thread — and every
  //   paint — for a second or two. Even a route transition can't hide that,
  //   because the block happens while React is suspended waiting on the module,
  //   before it can commit anything (the tab indicator visibly lags behind it).
  //
  // Importing only EVALUATES the module (cheap — it just defines components);
  // the expensive first RENDER is handled off the paint path by the idle
  // pre-mount in PersistentTabs + the route transition in TabBar. So we want the
  // eval done as soon as possible, even under the Face-ID overlay. We stagger
  // one chunk per slot (so no single eval batches with the others) and lead with
  // DayView — the Plan tab is the heaviest and most-visited. requestIdleCallback
  // carries a short timeout so the warm-up still runs promptly on a busy thread.
  useEffect(() => {
    const chunks = [
      () => import("@/pages/app/DayView"),
      () => import("@/pages/app/Reports"),
      () => import("@/pages/app/Settings"),
      () => import("@/pages/app/Focus"),
      () => import("@/pages/app/Home"),
    ];
    let cancelled = false;
    let idleHandle: ReturnType<typeof requestIdleCallback> | undefined;
    let timerHandle: ReturnType<typeof setTimeout> | undefined;

    const schedule = (cb: () => void) => {
      if (typeof requestIdleCallback !== "undefined") {
        idleHandle = requestIdleCallback(cb, { timeout: 600 });
      } else {
        timerHandle = setTimeout(cb, 60);
      }
    };
    const warmNext = (i: number) => {
      if (cancelled || i >= chunks.length) return;
      void chunks[i]();
      schedule(() => warmNext(i + 1));
    };

    warmNext(0); // start straight away — evaluation is cheap, paint stays free
    return () => {
      cancelled = true;
      if (idleHandle !== undefined && typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleHandle);
      }
      if (timerHandle !== undefined) clearTimeout(timerHandle);
    };
  }, []);

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
