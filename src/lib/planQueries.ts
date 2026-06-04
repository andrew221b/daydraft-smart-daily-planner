import { supabase } from "@/integrations/supabase/client";
import type { Block } from "@/lib/daydraft";

export {
  PLAN_DASHBOARD_ROOT,
  PLAN_DAY_ROOT,
  planDashboardQueryKey,
  planDayQueryKey,
} from "@/lib/planQueryKeys";

export type PlanDashboardData = {
  hasPlanForDate: boolean;
  planId: string | null;
  planBlocks: Block[];
  planSummary: string | null;
};

export type DayPlanData = {
  plan: { id: string; ai_summary: string | null; ai_subtext: string | null } | null;
  blocks: Block[];
};

/**
 * Single round-trip for Today glance: plan row + ordered blocks.
 *
 * Uses a PostgREST nested select so the blocks ride back on the plan row,
 * collapsing the previous two sequential queries into one. The previous
 * code fetched the plan, then on success fetched its blocks — two RTTs
 * even though the second one only needed the first one's id.
 */
export async function fetchPlanDashboard(userId: string, date: string): Promise<PlanDashboardData> {
  const { data: p, error: planError } = await supabase
    .from("plans")
    .select("id, ai_summary, blocks(*)")
    .eq("user_id", userId)
    .eq("date", date)
    .order("position", { foreignTable: "blocks" })
    .maybeSingle();
  if (planError) throw planError;
  if (!p) {
    return { hasPlanForDate: false, planId: null, planBlocks: [], planSummary: null };
  }
  const list = (((p).blocks ?? []) as Block[]);
  return {
    hasPlanForDate: list.length > 0,
    planId: p.id,
    planBlocks: list,
    planSummary: list.length > 0 ? ((p).ai_summary || null) : null,
  };
}

export async function fetchDayPlan(userId: string, date: string): Promise<DayPlanData> {
  const { data: p, error: planError } = await supabase
    .from("plans")
    .select("id, ai_summary, ai_subtext, blocks(*)")
    .eq("user_id", userId)
    .eq("date", date)
    .order("position", { foreignTable: "blocks" })
    .maybeSingle();
  if (planError) throw planError;
  if (!p) return { plan: null, blocks: [] };
  const { blocks: blockList, ...planRow } = p as { blocks: Block[] | null } & {
    id: string;
    ai_summary: string | null;
    ai_subtext: string | null;
  };
  return {
    plan: { id: planRow.id, ai_summary: planRow.ai_summary, ai_subtext: planRow.ai_subtext },
    blocks: (blockList ?? []) as Block[],
  };
}
