export const PLAN_DASHBOARD_ROOT = "plan-dashboard" as const;
export const PLAN_DAY_ROOT = "plan-day" as const;

export const planDashboardQueryKey = (userId: string, date: string) =>
  [PLAN_DASHBOARD_ROOT, userId, date] as const;

export const planDayQueryKey = (userId: string, date: string) =>
  [PLAN_DAY_ROOT, userId, date] as const;
