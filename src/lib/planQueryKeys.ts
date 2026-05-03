export const PLAN_DASHBOARD_ROOT = "plan-dashboard" as const;

export const planDashboardQueryKey = (userId: string, date: string) =>
  [PLAN_DASHBOARD_ROOT, userId, date] as const;
