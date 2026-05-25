export type EnergyPref = "morning" | "midday" | "night";
export type BlockType = "deep_work" | "communication" | "routine";
export type BlockKind = "task" | "break" | "lunch";
export type ScheduleBlockType = "work" | "rest" | "personal";

export interface Block {
  id: string;
  plan_id: string;
  user_id: string;
  start_time: string;
  duration_min: number;
  estimated_minutes?: number;
  actual_minutes?: number | null;
  title: string;
  type: BlockType;
  kind: BlockKind;
  block_type?: ScheduleBlockType;
  completed: boolean;
  /** When marked done (wall clock). */
  completed_at?: string | null;
  position: number;
  /** Synced calendar blocks are not user tasks — exclude from Focus / Next up. */
  is_calendar_event?: boolean;
  /** When true, reordering preserves overlap with overlapping task windows (walking + calls, etc.). */
  overlap_ok?: boolean | null;
  parallel_group_id?: string | null;
  /** Planned window end (HH:MM, same calendar day as the plan); Focus counts down wall-clock to this instant. */
  slot_end_time?: string | null;
  /** done | skipped | missed — null means still active (not completed / skipped / auto-missed). */
  resolution?: "done" | "skipped" | "missed" | null;
  /** When the block reached a terminal state (complete, skip, or auto-miss). */
  resolved_at?: string | null;
}

export const timeToMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
};

export const minutesToHHMM = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** Local wall-clock instant for YYYY-MM-DD + HH:mm on the user's calendar. */
export function wallMsOnPlanDay(planDateYMD: string, hhmm: string): number {
  const [y, mo, d] = planDateYMD.split("-").map(Number);
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, h || 0, m || 0, 0, 0).getTime();
}

/** Effective slot end (persisted or start + duration). */
export function blockSlotEndHHMM(b: Pick<Block, "start_time" | "duration_min" | "slot_end_time">): string {
  const raw = typeof b.slot_end_time === "string" ? b.slot_end_time.trim() : "";
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  return minutesToHHMM(timeToMinutes(b.start_time) + Number(b.duration_min || 0));
}

export function addMinutesToWallClock(planDateYMD: string, hhmm: string, addMin: number): string {
  const next = wallMsOnPlanDay(planDateYMD, hhmm) + addMin * 60_000;
  const d = new Date(next);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Sequential packing with optional concurrency: blocks with overlap_ok keep their stored start_time
 * while advancing the planner cursor so the following non-overlapping blocks line up afterward.
 */
export function packLinearSchedule<T extends Pick<Block, "start_time" | "duration_min"> & { overlap_ok?: boolean | null }>(
  ordered: T[],
): T[] {
  if (!ordered.length) return ordered;
  let cursorMin = timeToMinutes(ordered[0].start_time) + Number(ordered[0].duration_min || 0);
  const out: T[] = [{ ...ordered[0] }];
  for (let i = 1; i < ordered.length; i++) {
    const b = ordered[i];
    if (b.overlap_ok) {
      const spanEnd = timeToMinutes(b.start_time) + Number(b.duration_min || 0);
      cursorMin = Math.max(cursorMin, spanEnd);
      out.push({ ...b });
      continue;
    }
    // Strict packing: the block starts exactly when the previous block ends.
    // If a user wants a gap, a "break" block should be inserted explicitly.
    const nb = { ...b, start_time: minutesToHHMM(cursorMin) };
    cursorMin = cursorMin + Number(nb.duration_min || 0);
    out.push(nb);
  }
  return out;
}

/** User-owned tasks only (excludes synced calendar rows from metrics & carry-over). */
export function isUserTask(b: { kind: string; is_calendar_event?: boolean | null }): boolean {
  return b.kind === "task" && !b.is_calendar_event;
}

/** Task still counts as "on your plate" for Next up / Home (not done, skipped, or missed). */
export function isOpenUserTask(
  b: Pick<Block, "kind" | "is_calendar_event" | "completed" | "resolution">,
): boolean {
  return isUserTask(b) && !b.completed && !b.resolution;
}

/** Completed successfully (includes legacy rows before `resolution` existed). */
export function isUserTaskDone(
  b: Pick<Block, "kind" | "is_calendar_event" | "completed" | "resolution">,
): boolean {
  if (!isUserTask(b)) return false;
  if (b.resolution === "done") return true;
  return b.completed === true && !b.resolution;
}

export const peakWindow = (e: EnergyPref) =>
  e === "morning" ? "9am – 1pm" : e === "midday" ? "11am – 3pm" : "7pm – 11pm";

export const typeColor = (t: BlockType) =>
  t === "deep_work" ? "hsl(var(--type-deep))" : t === "communication" ? "hsl(var(--type-comm))" : "hsl(var(--type-routine))";

export const typeLabel = (t: BlockType) =>
  t === "deep_work" ? "Deep Work" : t === "communication" ? "Communication" : "Routine";

const personalErrandPattern =
  /\b(grocery|groceries|shopping|errand|pickup|drop[\s-]?off|pharmacy|doctor|dentist|bank|post office|visit|appointment|kids?|school run|laundry)\b/i;

export const inferScheduleBlockType = (b: {
  block_type?: string | null;
  kind?: string | null;
  title?: string | null;
}): ScheduleBlockType => {
  if (b.block_type === "work" || b.block_type === "rest" || b.block_type === "personal") return b.block_type;
  if (b.kind === "break" || b.kind === "lunch") return "rest";
  if (personalErrandPattern.test(String(b.title || ""))) return "personal";
  return "work";
};

export const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  // Locale-aware: respects 12h vs 24h preference of the user's region
  // (e.g. en-US -> "9am", en-GB -> "09:00", de-DE -> "09:00").
  try {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    const locales = typeof navigator !== "undefined" && navigator.languages?.length 
      ? (navigator.languages as string[]) 
      : undefined;
      
    const withMinutes = d.toLocaleTimeString(locales, { hour: "numeric", minute: "2-digit" });
    const is12h = /[ap]m/i.test(withMinutes) || /[a-z]/i.test(withMinutes.replace(/[^a-z]/gi, ""));
    
    if (is12h && m === 0) {
      return d.toLocaleTimeString(locales, { hour: "numeric" }).replace(/\s/g, "").toLowerCase();
    }
    return withMinutes.replace(/\s/g, "").toLowerCase();
  } catch {
    const period = h >= 12 ? "pm" : "am";
    const hr = ((h + 11) % 12) + 1;
    return m === 0 ? `${hr}${period}` : `${hr}:${String(m).padStart(2, "0")}${period}`;
  }
};

// Local-date YYYY-MM-DD (avoid UTC drift around midnight).
export const dateStr = (d: Date = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const todayDateStr = () => dateStr(new Date());

export const parseDateStr = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export const isFutureDateStr = (s: string) => {
  return parseDateStr(s).getTime() > parseDateStr(todayDateStr()).getTime();
};

export const friendlyDateFor = (d: Date) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(d); target.setHours(0,0,0,0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

export const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
};

export const friendlyDate = () =>
  new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
