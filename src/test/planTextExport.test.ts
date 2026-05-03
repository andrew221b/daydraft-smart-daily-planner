import { describe, expect, it } from "vitest";
import { formatPlanAsPlainText } from "@/lib/planTextExport";
import type { Block } from "@/lib/daydraft";

const b = (over: Partial<Block>): Block => ({
  id: "1",
  plan_id: "p",
  user_id: "u",
  start_time: "09:00",
  duration_min: 30,
  title: "Write",
  type: "deep_work",
  kind: "task",
  completed: false,
  position: 0,
  ...over,
});

describe("formatPlanAsPlainText", () => {
  it("includes headline and rows", () => {
    const text = formatPlanAsPlainText({
      headline: "My day",
      blocks: [b({}), b({ id: "2", start_time: "10:00", title: "Email", type: "communication", completed: true })],
    });
    expect(text).toContain("My day");
    expect(text).toContain("Write");
    expect(text).toContain("Email");
    expect(text).toContain("✓");
  });
});
