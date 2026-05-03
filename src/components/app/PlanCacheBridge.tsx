import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { PLAN_DASHBOARD_ROOT } from "@/lib/planQueryKeys";

/** When DayView (or elsewhere) mutates today’s plan, refresh any cached Today data. */
export function PlanCacheBridge() {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const onRefresh = () => {
      void qc.invalidateQueries({ queryKey: [PLAN_DASHBOARD_ROOT, user.id] });
    };
    window.addEventListener("dd-today-refresh", onRefresh);
    return () => window.removeEventListener("dd-today-refresh", onRefresh);
  }, [user?.id, qc]);

  return null;
}
