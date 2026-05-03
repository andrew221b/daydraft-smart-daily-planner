import { describe, expect, it } from "vitest";
import { dayShapeHint, firstTaskCompleteMessage } from "@/lib/microDelights";
import type { Block } from "@/lib/daydraft";

const task = (over: Partial<Block>): Block => ({
  id: "1",
  plan_id: "p",
  user_id: "u",
  start_time: "09:00",
  duration_min: 30,
  title: "t",
  type: "deep_work",
  kind: "task",
  completed: false,
  position: 0,
  ...over,
});

describe("microDelights", () => {
  it("firstTaskCompleteMessage is stable for a seed", () => {
    expect(firstTaskCompleteMessage("2026-05-03")).toBe(firstTaskCompleteMessage("2026-05-03"));
  });

  it("dayShapeHint returns null for empty, single, or lone heavy pair", () => {
    expect(dayShapeHint([])).toBeNull();
    expect(dayShapeHint([task({ id: "a" })])).toBeNull();
    expect(dayShapeHint([task({ id: "a" }), task({ id: "b", duration_min: 90, type: "deep_work" })])).toBeNull();
  });

  it("dayShapeHint airy for two short tasks", () => {
    const blocks = [task({ id: "a", duration_min: 45 }), task({ id: "b", duration_min: 45, start_time: "10:00" })];
    expect(dayShapeHint(blocks)).toContain("Airy");
  });

  it("dayShapeHint flags heavy deep work", () => {
    const blocks: Block[] = [
      task({ id: "a", duration_min: 120, type: "deep_work" }),
      task({ id: "b", duration_min: 120, type: "deep_work" }),
    ];
    expect(dayShapeHint(blocks)).toContain("deep work");
  });

  it("dayShapeHint skips calendar rows", () => {
    const blocks: Block[] = [
      task({ id: "a", duration_min: 200, type: "deep_work", is_calendar_event: true }),
    ];
    expect(dayShapeHint(blocks)).toBeNull();
  });
});
