import { describe, expect, it } from "vitest";
import { planDashboardQueryKey, PLAN_DASHBOARD_ROOT } from "@/lib/planQueryKeys";

describe("planQueryKeys", () => {
  it("builds stable query keys", () => {
    expect(planDashboardQueryKey("u1", "2026-05-01")).toEqual([PLAN_DASHBOARD_ROOT, "u1", "2026-05-01"]);
  });
});
