import { useEffect, useState } from "react";
import { getLocalizedPrices, type PlanPrices } from "@/lib/revenueCat";

/**
 * Fetch the current RevenueCat offering's localized prices once on mount.
 * Empty `{}` on web / when RevenueCat isn't configured — the paywall then falls
 * back to its default labels. Native: returns prices in the user's store
 * currency so EUR/UAH/INR/… render correctly instead of a hardcoded "$".
 */
export function usePlanPrices(): PlanPrices {
  const [prices, setPrices] = useState<PlanPrices>({});
  useEffect(() => {
    let alive = true;
    void getLocalizedPrices().then((p) => { if (alive) setPrices(p); });
    return () => { alive = false; };
  }, []);
  return prices;
}
