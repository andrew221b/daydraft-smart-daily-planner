import { Block, dateStr, isUserTask, parseDateStr, todayDateStr } from "@/lib/daydraft";

export type EnergyState = "low" | "medium" | "high";
export type RescueMode = "conservative" | "balanced" | "aggressive";
export type RescuePlanResult = {
  input: string;
  selectedCount: number;
  budgetMin: number;
  occupiedMin: number;
  rationale: string;
  explain: string[];
};

const ENERGY_KEY = "dd_energy_state";

export function readEnergyState(): EnergyState {
  try {
    const raw = localStorage.getItem(ENERGY_KEY);
    if (raw === "low" || raw === "high" || raw === "medium") return raw;
  } catch {
    // ignore
  }
  return "medium";
}

export function writeEnergyState(v: EnergyState): void {
  try {
    localStorage.setItem(ENERGY_KEY, v);
  } catch {
    // ignore
  }
}

export function smartDailyOutcome(blocks: Block[]): string[] {
  const tasks = blocks.filter(isUserTask);
  const done = tasks.filter((b) => b.completed);
  const open = tasks.filter((b) => !b.completed);
  const focusedMinutes = done
    .filter((b) => b.type === "deep_work")
    .reduce((sum, b) => sum + (b.duration_min || 0), 0);
  const line1 = `${done.length} of ${tasks.length || 0} tasks completed today.`;
  const line2 =
    open.length > 0
      ? `Carry ${open.slice(0, 3).map((b) => b.title).join(", ")}${open.length > 3 ? "…" : ""} to tomorrow.`
      : "No carry-over needed. Tomorrow can start clean.";
  const line3 =
    focusedMinutes >= 90
      ? `Strong focus block total: ${Math.floor(focusedMinutes / 60)}h ${focusedMinutes % 60}m.`
      : "Consider one protected 60-90m deep-work block tomorrow morning.";
  return [line1, line2, line3];
}

export function weeklyProductScore(days: Block[][]): { score: number; tips: string[] } {
  const stats = days.map((blocks) => {
    const tasks = blocks.filter(isUserTask);
    const planned = tasks.reduce((s, b) => s + (b.duration_min || 0), 0);
    const done = tasks.filter((b) => b.completed);
    const completed = done.reduce((s, b) => s + (b.duration_min || 0), 0);
    const deep = done.filter((b) => b.type === "deep_work").reduce((s, b) => s + (b.duration_min || 0), 0);
    return { planned, completed, deep, completionRate: planned > 0 ? completed / planned : 0 };
  });
  const avgCompletion = stats.length
    ? stats.reduce((s, d) => s + d.completionRate, 0) / stats.length
    : 0;
  const avgDeep = stats.length ? stats.reduce((s, d) => s + d.deep, 0) / stats.length : 0;
  const overplannedDays = stats.filter((d) => d.planned > 9 * 60).length;
  const realisticPlanningFactor = stats.length ? 1 - overplannedDays / stats.length : 1;
  const consistencyFactor = stats.length
    ? stats.filter((d) => d.completed >= 45).length / stats.length
    : 0;
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        avgCompletion * 58 +
        Math.min(avgDeep / 120, 1) * 22 +
        realisticPlanningFactor * 10 +
        consistencyFactor * 10
      )
    )
  );
  const tips: string[] = [];
  if (avgCompletion < 0.65) tips.push("Plan 20% fewer tasks to increase completion quality.");
  if (avgDeep < 60) tips.push("Protect one uninterrupted deep-work block daily.");
  if (realisticPlanningFactor < 0.7) tips.push("Daily plans are too packed; keep planned work under 9h.");
  if (!tips.length) tips.push("Momentum is strong. Keep your morning start ritual consistent.");
  if (tips.length < 2) tips.push("When things slip, adjust the rest of the day instead of abandoning the whole plan.");
  return { score, tips: tips.slice(0, 2) };
}

export function rescueInputFromBlocks(
  blocks: Block[],
  options?: { nowHHMM?: string; activeHoursEnd?: string; energyState?: EnergyState; mode?: RescueMode }
): string {
  return rescuePlanFromBlocks(blocks, options).input;
}

export function rescuePlanFromBlocks(
  blocks: Block[],
  options?: { nowHHMM?: string; activeHoursEnd?: string; energyState?: EnergyState; mode?: RescueMode }
): RescuePlanResult {
  const fmtMin = (min: number) => {
    const safe = Math.max(0, Math.round(min));
    const h = Math.floor(safe / 60);
    const m = safe % 60;
    if (h <= 0) return `${m}m`;
    if (m <= 0) return `${h}h`;
    return `${h}h ${m}m`;
  };
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const now = options?.nowHHMM || "18:00";
  const dayEnd = options?.activeHoursEnd || "22:00";
  const nowMin = toMin(now);
  const endMin = toMin(dayEnd) || 22 * 60;
  const grossBudget = Math.max(40, Math.min(220, endMin - nowMin));
  const energyState = options?.energyState || "medium";
  const mode = options?.mode || "balanced";

  // Reserve time occupied by fixed slots (calendar events, lunch, breaks)
  // so rescue suggestions don't conflict with anchored parts of the day.
  const occupiedMin = blocks
    .filter((b) => !b.completed && (b.is_calendar_event || b.kind === "lunch" || b.kind === "break"))
    .filter((b) => {
      const start = toMin(b.start_time);
      const end = start + (b.duration_min || 0);
      return end > nowMin && start < endMin;
    })
    .reduce((sum, b) => {
      const start = toMin(b.start_time);
      const end = start + (b.duration_min || 0);
      return sum + Math.max(0, Math.min(end, endMin) - Math.max(start, nowMin));
    }, 0);
  const budgetMin = Math.max(35, grossBudget - occupiedMin);

  const scored = blocks
    .filter((b) => isUserTask(b) && !b.completed && !b.is_calendar_event)
    .map((b) => {
      const deepBias =
        b.type === "deep_work"
          ? mode === "aggressive"
            ? 19
            : mode === "balanced"
              ? 14
              : 10
          : b.type === "communication"
            ? 9
            : 7;
      const energyPenalty = energyState === "low" && b.type === "deep_work" ? 7 : 0;
      const durationPenalty = Math.max(0, b.duration_min - 60) * 0.12;
      return { ...b, score: deepBias - energyPenalty - durationPenalty };
    })
    .sort((a, b) => b.score - a.score);

  const selected: Array<{ title: string; mins: number }> = [];
  let used = 0;
  for (const task of scored) {
    if (selected.length >= 3) break;
    const normalized =
      mode === "conservative"
        ? energyState === "low"
          ? Math.max(20, Math.min(40, task.duration_min))
          : Math.max(20, Math.min(55, task.duration_min))
        : mode === "balanced"
          ? energyState === "low"
            ? Math.max(20, Math.min(45, task.duration_min))
            : Math.max(25, Math.min(70, task.duration_min))
          : energyState === "low"
            ? Math.max(25, Math.min(55, task.duration_min))
            : Math.max(30, Math.min(90, task.duration_min));
    if (used + normalized > budgetMin && selected.length > 0) continue;
    selected.push({ title: task.title, mins: normalized });
    used += normalized;
  }

  const input = selected.map((b) => `${b.title} (${b.mins}m)`).join("\n");
  const modeLabel =
    mode === "aggressive" ? "Aggressive" : mode === "conservative" ? "Conservative" : "Balanced";
  const rationale = `${modeLabel} mode · ${energyState} energy · ${fmtMin(budgetMin)} free (${fmtMin(occupiedMin)} occupied)`;
  const explain = [
    `${selected.length} high-impact tasks kept for the remaining window.`,
    occupiedMin > 0
      ? `${fmtMin(occupiedMin)} already occupied by fixed items, so AI avoided schedule conflicts.`
      : "No fixed conflicts detected in the remaining window.",
    mode === "conservative"
      ? "Durations were trimmed to reduce overload and improve completion odds."
      : mode === "aggressive"
        ? "Durations stayed closer to original estimates to maximize output."
        : "Durations were normalized for a realistic but productive finish.",
  ];
  return {
    input,
    selectedCount: selected.length,
    budgetMin,
    occupiedMin,
    rationale,
    explain,
  };
}

export function parseQuickCaptureText(raw: string, destination: "today" | "tomorrow"): string[] {
  const baseDate = parseDateStr(todayDateStr());
  if (destination === "tomorrow") baseDate.setDate(baseDate.getDate() + 1);
  const dateTag = dateStr(baseDate);
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(today|tomorrow)?\s*(\d{1,2}:\d{2})?\s*(.+?)\s*(\d{1,3})m?$/i);
      if (!match) {
        return destination === "today" ? `[today] ${line}` : `[for:${dateTag}] ${line}`;
      }
      const dayWord = (match[1] || "").toLowerCase();
      const hhmm = match[2] || "";
      const title = (match[3] || "").trim();
      const mins = Number(match[4] || 0);
      const d = new Date();
      if (dayWord === "tomorrow") d.setDate(d.getDate() + 1);
      const tag = dayWord === "today" ? "[today]" : `[for:${dateStr(d)}]`;
      const suffix = `${hhmm ? ` @${hhmm}` : ""}${mins ? ` · ${mins}m` : ""}`;
      return `${tag} ${title}${suffix}`.trim();
    });
}
