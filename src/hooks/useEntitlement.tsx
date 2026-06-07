import { useCallback, useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type Tier = "free" | "trial" | "pro";

export interface Entitlement {
  tier: Tier;
  status: string;
  plan: string | null;
  trialEndsAt: string | null;
  daysLeftInTrial: number | null;
  currentPeriodEnd: string | null;
}

export const FREE_PLAN_QUOTA = 5; // total free planning days, lifetime

const computeTier = (status: string, trialEndsAt: string | null): Tier => {
  if (status === "active") return "pro";
  if (status === "trialing" && trialEndsAt && new Date(trialEndsAt) > new Date()) return "trial";
  return "free";
};

export const entitlementQueryKey = (userId: string | undefined) =>
  ["entitlement", userId ?? ""] as const;

type EntitlementSnapshot = {
  ent: Entitlement | null;
  planQuotaUsed: number;
  isDeveloper: boolean;
};

/**
 * Single shared fetch backing every `useEntitlement` consumer (paywall sheets,
 * Reports, Settings, DayView, Focus, HomeTrackerHero, TrackerPill, etc.). Before
 * this was a per-mount hook that re-ran two Supabase round-trips on every page
 * navigation; with React Query the result is cached and de-duplicated across
 * the tree.
 */
async function fetchEntitlement(userId: string): Promise<EntitlementSnapshot> {
  const [subRes, plansRes, profileRes] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("plans").select("date, blocks(id)").eq("user_id", userId),
    supabase.from("profiles").select("is_developer").eq("id", userId).maybeSingle(),
  ]);
  const sub = subRes.data;
  const status = sub?.status ?? "free";
  const trialEndsAt = sub?.trial_ends_at ?? null;
  const tier = computeTier(status, trialEndsAt);
  const daysLeftInTrial = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;
  const ent: Entitlement = {
    tier,
    status,
    plan: sub?.plan ?? null,
    trialEndsAt,
    daysLeftInTrial,
    currentPeriodEnd: sub?.current_period_end ?? null,
  };
  const uniq = new Set(
    (plansRes.data || [])
      .filter((p: { blocks?: { id: string }[] | null }) => Array.isArray(p.blocks) && p.blocks.length > 0)
      .map((p: { date: string }) => p.date),
  );
  return { ent, planQuotaUsed: uniq.size, isDeveloper: profileRes.data?.is_developer ?? false };
}

export const useEntitlement = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // RevenueCat client-side Pro flag — instant UI reflection after a
  // purchase/restore/renewal, ahead of the webhook persisting to `subscriptions`.
  // Dynamic import keeps the RC plugin out of the main web chunk.
  const [rcPro, setRcPro] = useState(false);
  useEffect(() => {
    let active = true;
    void import("@/lib/revenueCat").then(({ getRcPro }) => { if (active) setRcPro(getRcPro()); });
    const on = (e: Event) => setRcPro(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener("dd-rc-pro", on as EventListener);
    return () => { active = false; window.removeEventListener("dd-rc-pro", on as EventListener); };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: entitlementQueryKey(user?.id),
    queryFn: () => fetchEntitlement(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    await queryClient.invalidateQueries({ queryKey: entitlementQueryKey(user.id) });
  }, [user?.id, queryClient]);

  const ent = data?.ent ?? null;
  const planQuotaUsed = data?.planQuotaUsed ?? 0;
  const subscriptionPro = ent?.tier === "pro" || ent?.tier === "trial";
  const isDeveloper = data?.isDeveloper ?? false;
  const isPro = subscriptionPro || rcPro || isDeveloper;
  const planQuotaLimit = isPro ? Infinity : FREE_PLAN_QUOTA;
  const planQuotaRemaining = isPro ? Infinity : Math.max(0, FREE_PLAN_QUOTA - planQuotaUsed);
  const overQuota = !isPro && planQuotaUsed >= FREE_PLAN_QUOTA;

  return {
    entitlement: ent,
    loading: !!user?.id && isLoading,
    isPro,
    isDeveloper,
    subscriptionPro,
    planQuotaUsed,
    planQuotaLimit,
    planQuotaRemaining,
    overQuota,
    refresh,
  };
};

export { fetchEntitlement };

/**
 * Checkout entry-point — runs the native RevenueCat purchase sheet (App Store /
 * Play Billing). On success the global RC listener has already flipped the UI to
 * Pro; the webhook persists `subscriptions` for server-side gating.
 *
 * `onUnavailable` fires when purchases can't run (web, missing keys, no offering),
 * preserving the existing caller contract. `onSuccess` fires on a completed buy;
 * a user cancellation resolves silently.
 */
export const startCheckout = async (
  plan: "weekly" | "monthly" | "annual",
  opts?: { onUnavailable?: () => void; onSuccess?: () => void; onError?: () => void },
) => {
  const { purchasePlan } = await import("@/lib/revenueCat");
  const { outcome } = await purchasePlan(plan);
  switch (outcome) {
    case "purchased": opts?.onSuccess?.(); return;
    case "cancelled": return; // user backed out — no toast
    case "error": (opts?.onError ?? opts?.onUnavailable)?.(); return;
    default: opts?.onUnavailable?.(); return; // "unavailable"
  }
};
