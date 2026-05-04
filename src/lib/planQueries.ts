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
  planBlocks: Block[];
  planSummary: string | null;
};

export type DayPlanData = {
  plan: { id: string; ai_summary: string | null; ai_subtext: string | null } | null;
  blocks: Block[];
};

/** Single round-trip for Today glance: plan row + ordered blocks. */
export async function fetchPlanDashboard(userId: string, date: string): Promise<PlanDashboardData> {
  const { data: p, error: planError } = await supabase
    .from("plans")
    .select("id, ai_summary")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (planError) throw planError;
  if (!p) {
    return { hasPlanForDate: false, planBlocks: [], planSummary: null };
  }
  const { data: bs, error: blockError } = await supabase
    .from("blocks")
    .select("*")
    .eq("plan_id", p.id)
    .order("position");
  if (blockError) throw blockError;
  const list = (bs || []) as Block[];
  return {
    hasPlanForDate: list.length > 0,
    planBlocks: list,
    planSummary: list.length > 0 ? (p.ai_summary || null) : null,
  };
}

export async function fetchDayPlan(userId: string, date: string): Promise<DayPlanData> {
  const { data: p, error: planError } = await supabase
    .from("plans")
    .select("id, ai_summary, ai_subtext")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (planError) throw planError;
  if (!p) return { plan: null, blocks: [] };
  const { data: bs, error: blockError } = await supabase
    .from("blocks")
    .select("*")
    .eq("plan_id", p.id)
    .order("position");
  if (blockError) throw blockError;
  return {
    plan: p,
    blocks: (bs || []) as Block[],
  };
}
