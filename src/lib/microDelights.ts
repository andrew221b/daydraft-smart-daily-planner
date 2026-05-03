import type { Block } from "@/lib/daydraft";
import { isUserTask } from "@/lib/daydraft";

function startMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

/** Rare one-liner when the day’s schedule has a recognizable “shape”. */
export function dayShapeHint(blocks: Block[]): string | null {
  const tasks = blocks.filter(isUserTask);
  if (tasks.length === 0) return null;
  const deepMin = tasks.filter(t => t.type === "deep_work").reduce((s, t) => s + t.duration_min, 0);
  const totalMin = tasks.reduce((s, t) => s + t.duration_min, 0);
  const afternoon = tasks.filter(t => startMinutes(t.start_time) >= 14 * 60).length;

  if (tasks.length >= 8) return "Full plate — finishing everything is optional; showing up isn’t.";
  if (deepMin >= 180) return "Heavy on deep work — one real break pays compound interest.";
  if (tasks.length >= 3 && afternoon >= Math.ceil(tasks.length * 0.55))
    return "Afternoon-heavy — twenty quiet morning minutes change the arc.";
  if (tasks.length === 2 && totalMin < 120)
    return "Airy day — perfect for the one thing that actually moves the needle.";
  return null;
}

const FIRST_WINS = [
  "First domino down.",
  "Momentum likes company.",
  "One done; the day leans your way.",
  "That might’ve been the hardest tap of the day.",
];

/** Stable pick per calendar day so the line doesn’t flicker on re-render. */
export function firstTaskCompleteMessage(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return FIRST_WINS[Math.abs(h) % FIRST_WINS.length];
}
