import { supabase } from "@/integrations/supabase/client";
import type { Block } from "@/lib/daydraft";

export { PLAN_DASHBOARD_ROOT, planDashboardQueryKey } from "@/lib/planQueryKeys";

export type PlanDashboardData = {
  hasPlanForDate: boolean;
  planBlocks: Block[];
  planSummary: string | null;
};

/** Single round-trip for Today glance: plan row + ordered blocks. */
export async function fetchPlanDashboard(userId: string, date: string): Promise<PlanDashboardData> {
  const { data: p } = await supabase
    .from("plans")
    .select("id, ai_summary")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (!p) {
    return { hasPlanForDate: false, planBlocks: [], planSummary: null };
  }
  const { data: bs } = await supabase.from("blocks").select("*").eq("plan_id", p.id).order("position");
  const list = (bs || []) as Block[];
  return {
    hasPlanForDate: list.length > 0,
    planBlocks: list,
    planSummary: list.length > 0 ? (p.ai_summary || null) : null,
  };
}
