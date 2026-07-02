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
  /** User-set "important" flag — highlighted amber across timeline, checklist, calendar. */
  priority?: boolean;
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

/** Shift a YYYY-MM-DD date string by N calendar days (local time). */
export function shiftDate(ymd: string, days: number): string {
  const d = parseDateStr(ymd);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local wall-clock instant for YYYY-MM-DD + HH:mm on the user's calendar. */
export function wallMsOnPlanDay(planDateYMD: string, hhmm: string): number {
  const [y, mo, d] = planDateYMD.split("-").map(Number);
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, h || 0, m || 0, 0, 0).getTime();
}

/** Effective slot end. Wraps past midnight so a late block never yields an
 *  invalid "24:30"/"25:00".
 *
 *  A timed task's end is ALWAYS start + duration — we recompute it fresh rather
 *  than trusting the persisted `slot_end_time`. The persisted value is only a
 *  denormalized cache, and it goes stale the moment a task's duration or start
 *  is edited (every writer here re-derives via this function, so a stored value
 *  perpetuates itself). Trusting it meant shortening a task left its OLD, later
 *  end in place — so `applyAutoMissedBlocks` read a future end and the task was
 *  never marked "missed". Recomputing kills that whole class of bug.
 *
 *  Only frameless tasks (duration 0 — no real window) fall back to a valid
 *  persisted end, else collapse to the start time. */
export function blockSlotEndHHMM(b: Pick<Block, "start_time" | "duration_min" | "slot_end_time">): string {
  const dur = Number(b.duration_min || 0);
  if (dur > 0) return minutesToHHMM((timeToMinutes(b.start_time) + dur) % 1440);
  const raw = typeof b.slot_end_time === "string" ? b.slot_end_time.trim() : "";
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return raw;
  return minutesToHHMM(timeToMinutes(b.start_time) % 1440);
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
    // Wrap the stored time by 24h so a plan that runs past midnight keeps valid
    // HH:MM (the internal cursor stays unbounded to preserve sequence/order).
    // A frameless task (duration_min = 0) stays at 0 and does NOT advance the
    // cursor — the next block starts at the same time. Real durations floor to 1.
    const rawDur = Number(b.duration_min || 0);
    const safeDur = rawDur <= 0 ? 0 : Math.max(1, Math.round(rawDur));
    const nb = { ...b, start_time: minutesToHHMM(cursorMin % 1440), duration_min: safeDur };
    cursorMin = cursorMin + safeDur;
    out.push(nb);
  }
  return out;
}

/**
 * Retime a plan around one or more *anchor* blocks (the task the user just
 * placed or moved). Anchors keep their exact start_time; every other block is
 * sorted by time and slides forward ONLY as far as needed to avoid overlapping
 * the block before it — so untouched downstream tasks keep their times and gaps
 * whenever they don't conflict ("user is boss", minimal movement).
 *
 * Returns null ONLY for a genuine cross-midnight plan — detected as a *large*
 * (>12h) backward jump in clock time among the non-anchor blocks, where the plan
 * truly wraps past 00:00 and sorting by HH:MM would scramble the sequence (a
 * 23:00 task must stay before a 00:30 one). The caller falls back to its
 * cross-midnight retiming there. A merely *out-of-order* same-day plan (e.g. a
 * 19:30 row stored before a 19:00 row, as a drag-swap or a stale position can
 * leave) is NOT a reason to bail: we repair it by sorting + cascading below, so
 * one edit can never leave the user's tasks overlapping or jumbled ("liquid
 * timeline" — move one task, the rest re-flow correctly).
 *
 * Returns ONLY the retimed tasks (chronological) — no gap/break rows. Gaps are a
 * derived, render-time concept now (the difference between consecutive starts),
 * so the timeline no longer stores or churns invisible "break" rows.
 */
export function normalizeSchedule<T extends Block>(
  blocks: T[],
  anchorIds: Set<string>,
): T[] | null {
  const nonBreak = blocks.filter((b) => b.kind !== "break");
  // Bail ONLY on a true midnight wrap: a backward step of more than 12h among
  // the blocks we're NOT moving. A small backward step is just an out-of-order
  // same-day plan, which the sort+cascade below repairs (instead of the old
  // behaviour of bailing to a full sequential repack that scrambled untouched
  // tasks — the root of the "I moved one task and the others went haywire" bug).
  const WRAP_MIN = 12 * 60;
  const fixed = nonBreak.filter((b) => !anchorIds.has(b.id));
  for (let i = 1; i < fixed.length; i++) {
    if (timeToMinutes(fixed[i - 1].start_time) - timeToMinutes(fixed[i].start_time) > WRAP_MIN) return null;
  }
  const sorted = [...nonBreak].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  let cursor = -1;
  const retimed = sorted.map((t) => {
    const desired = timeToMinutes(t.start_time);
    // Anchors win their exact time; others yield forward to clear the previous block.
    const s = anchorIds.has(t.id) ? desired : Math.max(desired, cursor);
    cursor = s + Math.max(0, Number(t.duration_min || 0));
    return { ...t, start_time: minutesToHHMM(s % 1440) };
  });
  return retimed;
}

const DAY_MS = 86_400_000;

/**
 * Absolute wall-clock start/end for each block of a plan that may run past
 * midnight. Blocks are taken in their given (position) order; each time the
 * clock wraps — a non-`overlap_ok` block's start minute is *less than* the
 * previous one — the day rolls forward by 24h. A slot whose end HH:MM is before
 * its own start gains an extra day too. This is the single source of truth for
 * "what real instant is this slot," so cross-midnight tasks resolve correctly
 * without leaving the plan's calendar date.
 */
export function planBlockInstants(
  planDateYMD: string,
  orderedBlocks: Array<
    Pick<Block, "id" | "start_time" | "duration_min" | "slot_end_time"> & { overlap_ok?: boolean | null }
  >,
): Map<string, { startMs: number; endMs: number }> {
  const out = new Map<string, { startMs: number; endMs: number }>();
  let cursorMin = -1;
  let currentDayOffset = 0;
  
  for (const b of orderedBlocks) {
    if (cursorMin === -1) cursorMin = timeToMinutes(b.start_time);
    
    const startMin = timeToMinutes(b.start_time);
    
    if (!b.overlap_ok) {
      if (startMin < (cursorMin % 1440)) {
        // Crossed midnight
        cursorMin = cursorMin + (1440 - (cursorMin % 1440)) + startMin;
      } else {
        // Jump cursor to startMin within the same day
        cursorMin = cursorMin - (cursorMin % 1440) + startMin;
      }
      currentDayOffset = Math.floor(cursorMin / 1440);
    }

    const startMs = wallMsOnPlanDay(planDateYMD, b.start_time) + currentDayOffset * DAY_MS;
    
    if (!b.overlap_ok) {
      cursorMin += Number(b.duration_min || 0);
    }
    
    const endHHMM = blockSlotEndHHMM(b);
    const endMin = timeToMinutes(endHHMM);
    const endDayOffset = currentDayOffset + (endMin < startMin ? 1 : 0);
    const endMs = wallMsOnPlanDay(planDateYMD, endHHMM) + endDayOffset * DAY_MS;
    out.set(b.id, { startMs, endMs });
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
  // (e.g. en-US -> "9 am", en-GB -> "09:00", de-DE -> "09:00").
  try {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    const locales = typeof navigator !== "undefined" && navigator.languages?.length
      ? (navigator.languages as string[])
      : undefined;

    const raw = d.toLocaleTimeString(locales, { hour: "numeric", minute: "2-digit" });
    // Find a Latin am/pm marker — covers "AM", "pm", and the dotted/spaced
    // variants some locales emit ("a.m.", "p. m.", "am."). No match ⇒ a 24h
    // locale (or a non-Latin marker like CJK 上午/下午): return it as-is.
    const marker = raw.match(/[ap]\.?\s?m\.?/i);
    if (!marker) return raw.trim();
    // Normalise the marker to a clean lowercase "am"/"pm" (strip dots + inner
    // spaces) and re-attach it with exactly ONE space, so every 12h time reads
    // uniformly — "9 am", "9:30 pm" — instead of the locale-dependent glued
    // "9:00p.m." mess. On a whole hour, drop the ":00".
    const suffix = marker[0].replace(/[.\s]/g, "").toLowerCase();
    let time = raw.slice(0, marker.index).trim();
    if (m === 0) time = time.replace(/[:.]0{2}$/, "");
    return `${time} ${suffix}`;
  } catch {
    const suffix = h >= 12 ? "pm" : "am";
    const hr = ((h + 11) % 12) + 1;
    return m === 0 ? `${hr} ${suffix}` : `${hr}:${String(m).padStart(2, "0")} ${suffix}`;
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
