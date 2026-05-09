import { describe, expect, it } from "vitest";
import { wallMinutesFromSlotStart } from "@/lib/blockActualTime";

describe("wallMinutesFromSlotStart", () => {
  it("returns ~2 minutes between 9:00 slot and 9:02 end on same calendar day", () => {
    const planDate = "2026-05-09";
    const end = new Date(2026, 4, 9, 9, 2, 0, 0).getTime();
    expect(wallMinutesFromSlotStart(planDate, "09:00", end)).toBe(2);
  });
});
