import { useEffect, useState, useCallback } from "react";
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

export const FREE_PLAN_QUOTA = 5; // plans per rolling 7 days

const computeTier = (status: string, trialEndsAt: string | null): Tier => {
  if (status === "active") return "pro";
  if (status === "trialing" && trialEndsAt && new Date(trialEndsAt) > new Date()) return "trial";
  // expired / canceled / refunded / past_due / free → free tier
  return "free";
};

export const useEntitlement = () => {
  const { user } = useAuth();
  const [ent, setEnt] = useState<Entitlement | null>(null);
  const [planQuotaUsed, setPlanQuotaUsed] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setEnt(null); setLoading(false); return; }
    const { data: sub } = await supabase.from("subscriptions").select("*").eq("user_id", user.id).maybeSingle();
    const status = sub?.status ?? "free";
    const trialEndsAt = sub?.trial_ends_at ?? null;
    const tier = computeTier(status, trialEndsAt);
    const daysLeftInTrial = trialEndsAt
      ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000))
      : null;
    setEnt({
      tier, status, plan: sub?.plan ?? null,
      trialEndsAt, daysLeftInTrial,
      currentPeriodEnd: sub?.current_period_end ?? null,
    });

    // Quota: count distinct plan dates in last 7 days
    const since = new Date(); since.setDate(since.getDate() - 6);
    const { data: plans } = await supabase.from("plans").select("date")
      .eq("user_id", user.id).gte("date", since.toISOString().slice(0, 10));
    const uniq = new Set((plans || []).map((p: any) => p.date));
    setPlanQuotaUsed(uniq.size);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const isPro = ent?.tier === "pro" || ent?.tier === "trial";
  const planQuotaLimit = isPro ? Infinity : FREE_PLAN_QUOTA;
  const planQuotaRemaining = isPro ? Infinity : Math.max(0, FREE_PLAN_QUOTA - planQuotaUsed);
  const overQuota = !isPro && planQuotaUsed >= FREE_PLAN_QUOTA;

  return { entitlement: ent, loading, isPro, planQuotaUsed, planQuotaLimit, planQuotaRemaining, overQuota, refresh };
};

/**
 * Provider-agnostic checkout entry-point. Wired later to App Store / Stripe / Paddle
 * via the same interface — no UI changes required.
 */
export const startCheckout = async (
  _plan: "monthly" | "annual",
  opts?: { onUnavailable?: () => void }
) => {
  // Stub for now. Real flow will call an edge function that returns a checkout URL
  // (or invoke a native StoreKit bridge inside Capacitor).
  opts?.onUnavailable?.();
};