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

  it("returns null when there's no tracking, regardless of when completion happens", async () => {
    // Wall-clock from slot start is no longer used as a fallback —
    // batch-completing at end-of-day was producing wildly inflated
    // "actual" numbers (a 12:00 slot looked like "2h 23m actual"
    // when the user just tapped done at 14:23). We now return null
    // when tracking is absent; the UI shows "planned" instead.
    const planDate = "2026-05-09";
    const before = new Date(2026, 4, 9, 8, 30, 0, 0).getTime();
    const after = new Date(2026, 4, 9, 10, 35, 0, 0).getTime();
    expect(
      await resolveActualMinutesOnComplete(supabaseNoEntries, "u1", "b1", planDate, "10:30", before),
    ).toBeNull();
    expect(
      await resolveActualMinutesOnComplete(supabaseNoEntries, "u1", "b1", planDate, "10:30", after),
    ).toBeNull();
  });

  it("returns summed tracker minutes when tracking exists", async () => {
    // 9:00-9:15 = 15 min on the timer.
    const supabaseWithEntries = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({
              data: [
                {
                  started_at: new Date(2026, 4, 9, 9, 0, 0, 0).toISOString(),
                  ended_at: new Date(2026, 4, 9, 9, 15, 0, 0).toISOString(),
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof resolveActualMinutesOnComplete>[0];
    const planDate = "2026-05-09";
    const end = new Date(2026, 4, 9, 9, 15, 0, 0).getTime();
    const result = await resolveActualMinutesOnComplete(
      supabaseWithEntries, "u1", "b1", planDate, "09:00", end,
    );
    expect(result).toBe(15);
  });
});
