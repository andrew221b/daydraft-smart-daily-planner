import { describe, it, expect } from "vitest";
import { isUserTask, normalizeSchedule, type Block } from "@/lib/daydraft";

describe("isUserTask", () => {
  it("treats only non-calendar tasks as user tasks", () => {
    expect(isUserTask({ kind: "task", is_calendar_event: true })).toBe(false);
    expect(isUserTask({ kind: "task", is_calendar_event: false })).toBe(true);
    expect(isUserTask({ kind: "task" })).toBe(true);
    expect(isUserTask({ kind: "break" })).toBe(false);
  });
});

describe("normalizeSchedule", () => {
  const task = (id: string, start: string, dur: number, kind: Block["kind"] = "task"): Block =>
    ({ id, plan_id: "p", user_id: "u", start_time: start, duration_min: dur, title: id, type: "deep_work", kind, completed: false, position: 0 });
  const mkBreak = (from: number, to: number): Block =>
    ({ id: `brk-${from}-${to}`, plan_id: "p", user_id: "u", start_time: `${String(Math.floor(from / 60)).padStart(2, "0")}:${String(from % 60).padStart(2, "0")}`, duration_min: to - from, title: "Break", type: "routine", kind: "break", completed: false, position: 0 });
  // Compact "<id>@<start>" view, with "·" for invisible gap markers.
  const shape = (r: Block[] | null) => (r === null ? null : r.map((b) => `${b.kind === "break" ? "·" : b.id}@${b.start_time}`));

  it("anchor fits an existing gap → nothing downstream moves", () => {
    const r = normalizeSchedule([task("A", "09:00", 30), task("B", "14:00", 30), task("C", "11:00", 30)], new Set(["C"]), mkBreak);
    expect(shape(r)).toEqual(["A@09:00", "·@09:30", "C@11:00", "·@11:30", "B@14:00"]);
  });

  it("anchor longer than the gap → next task cascades forward to clear it", () => {
    const r = normalizeSchedule([task("A", "09:00", 30), task("B", "10:00", 60), task("C", "09:45", 60)], new Set(["C"]), mkBreak);
    expect(shape(r)).toEqual(["A@09:00", "·@09:30", "C@09:45", "B@10:45"]);
  });

  it("minimal movement: a non-conflicting downstream task keeps its exact time", () => {
    const r = normalizeSchedule([task("A", "09:00", 30), task("B", "10:00", 60), task("D", "12:00", 60), task("C", "09:45", 60)], new Set(["C"]), mkBreak);
    expect(shape(r)).toEqual(["A@09:00", "·@09:30", "C@09:45", "B@10:45", "·@11:45", "D@12:00"]);
  });

  it("frameless (0-min) anchor pushes nothing and shares the next start", () => {
    const r = normalizeSchedule([task("A", "09:00", 30), task("B", "10:00", 30), task("C", "10:00", 0)], new Set(["C"]), mkBreak);
    // B and C both land at 10:00; the 0-min anchor advances no cursor → no push.
    expect(shape(r)).toEqual(["A@09:00", "·@09:30", "B@10:00", "C@10:00"]);
  });

  it("editing a task earlier repositions it to the front; later tasks yield", () => {
    const moved = [task("A", "09:00", 30), task("B", "10:00", 30), task("C", "11:00", 30)].map((b) => (b.id === "C" ? { ...b, start_time: "08:00" } : b));
    const r = normalizeSchedule(moved, new Set(["C"]), mkBreak);
    expect(shape(r)).toEqual(["C@08:00", "·@08:30", "A@09:00", "·@09:30", "B@10:00"]);
  });

  it("returns null for cross-midnight / out-of-order plans (caller keeps legacy retiming)", () => {
    const r = normalizeSchedule([task("A", "23:00", 60), task("B", "00:30", 30), task("C", "01:00", 30)], new Set(["C"]), mkBreak);
    expect(r).toBeNull();
  });
});
