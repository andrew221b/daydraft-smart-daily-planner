import { describe, it, expect } from "vitest";
import { isUserTask } from "@/lib/daydraft";

describe("isUserTask", () => {
  it("treats only non-calendar tasks as user tasks", () => {
    expect(isUserTask({ kind: "task", is_calendar_event: true })).toBe(false);
    expect(isUserTask({ kind: "task", is_calendar_event: false })).toBe(true);
    expect(isUserTask({ kind: "task" })).toBe(true);
    expect(isUserTask({ kind: "break" })).toBe(false);
  });
});
