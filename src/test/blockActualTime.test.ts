import { describe, expect, it } from "vitest";
import { resolveActualMinutesOnComplete, wallMinutesFromSlotStart } from "@/lib/blockActualTime";

describe("wallMinutesFromSlotStart", () => {
  it("returns ~2 minutes between 9:00 slot and 9:02 end on same calendar day", () => {
    const planDate = "2026-05-09";
    const end = new Date(2026, 4, 9, 9, 2, 0, 0).getTime();
    expect(wallMinutesFromSlotStart(planDate, "09:00", end)).toBe(2);
  });

  it("returns 0 when completion is before slot start", () => {
    const planDate = "2026-05-09";
    const end = new Date(2026, 4, 9, 8, 30, 0, 0).getTime(); // 8:30 < 9:00
    expect(wallMinutesFromSlotStart(planDate, "09:00", end)).toBe(0);
  });
});

describe("resolveActualMinutesOnComplete", () => {
  // Mocked Supabase: no tracker entries.
  const supabaseNoEntries = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof resolveActualMinutesOnComplete>[0];

  it("returns null when completed before slot start and no tracking", async () => {
    const planDate = "2026-05-09";
    const end = new Date(2026, 4, 9, 8, 30, 0, 0).getTime();
    const result = await resolveActualMinutesOnComplete(
      supabaseNoEntries, "u1", "b1", planDate, "10:30", end,
    );
    expect(result).toBeNull();
  });

  it("returns wall minutes when completed after slot start with no tracking", async () => {
    const planDate = "2026-05-09";
    const end = new Date(2026, 4, 9, 10, 35, 0, 0).getTime();
    const result = await resolveActualMinutesOnComplete(
      supabaseNoEntries, "u1", "b1", planDate, "10:30", end,
    );
    expect(result).toBe(5);
  });
});
