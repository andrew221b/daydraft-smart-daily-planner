/**
 * Brief data layer — turns raw rows into the handful of numbers a nudge cares
 * about, then formats them into push copy.
 *
 * Everything here is PURE (no I/O, no Deno calls except Intl), so the cron
 * functions stay thin and these calculations can be reasoned about in one
 * place. The copy is deterministic and data-first by design: a nudge earns
 * its place by saying something true and specific ("5/7 tasks · $344"), not
 * by being clever. Richer AI prose already lives in the in-app debrief card
 * that the morning push deep-links into.
 *
 * Voice rules (mirrors _shared/persona.ts): plain words, real numbers, no
 * hype, no shame, offer-don't-command. Never "you should have".
 */

// ── Row shapes ────────────────────────────────────────────────────────────

export type BlockRow = {
  id: string;
  title: string | null;
  type: string | null;
  kind: string | null;
  start_time: string | null;
  duration_min: number | null;
  slot_end_time: string | null;
  completed: boolean | null;
  resolution: string | null;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  is_calendar_event: boolean | null;
};

export type TimeEntryRow = {
  started_at: string | null;
  ended_at: string | null;
  category_id: string | null;
};

export type CategoryRow = {
  id: string;
  hourly_rate: number | null;
  currency: string | null;
};

export type EnergyZones = {
  peak?: [number, number];
  dip?: [number, number];
  recovery?: [number, number];
} | null;

// ── Time helpers ────────────────────────────────────────────────────────────

/** "HH:MM" → minutes since midnight. Bad input → 0. */
export function parseHm(s: string | null | undefined): number {
  const [h, m] = String(s || "").split(":").map(Number);
  if (!Number.isFinite(h)) return 0;
  return Math.max(0, Math.min(23, h)) * 60 + (Number.isFinite(m) ? Math.max(0, Math.min(59, m)) : 0);
}

/** minutes → "4h 20m" / "45m" / "1h". Empty for ≤0. */
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m <= 0) return "";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

export function hhmmInTz(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  } catch {
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
}

export function ymdInTz(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** A user task is a real planned task, not a synced calendar event or a
 *  break/lunch placeholder. */
function isUserTask(b: BlockRow): boolean {
  return b.kind === "task" && !b.is_calendar_event;
}

/** Done = explicitly completed, or resolved as done. */
function isDone(b: BlockRow): boolean {
  return b.completed === true || b.resolution === "done";
}

/** Skipped/missed shouldn't count as "carry to tomorrow" suggestions. */
function isOpen(b: BlockRow): boolean {
  return !isDone(b) && b.resolution !== "skipped" && b.resolution !== "missed";
}

// ── Metric computations ───────────────────────────────────────────────────

export type DaySummary = {
  doneCount: number;
  totalCount: number;
  pct: number;
  /** Titles of tasks still open (not done, not skipped/missed). */
  openTitles: string[];
};

export function summarizeDay(blocks: BlockRow[]): DaySummary {
  const tasks = blocks.filter(isUserTask);
  const done = tasks.filter(isDone);
  const open = tasks.filter(isOpen);
  const totalCount = tasks.length;
  const doneCount = done.length;
  return {
    doneCount,
    totalCount,
    pct: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
    openTitles: open.map((b) => String(b.title || "").trim()).filter(Boolean),
  };
}

/** First calendar event (or fixed-time task) starting later than `nowMin`. */
export function nextEvent(blocks: BlockRow[], nowMin: number): { title: string; startHm: string } | null {
  const upcoming = blocks
    .filter((b) => typeof b.start_time === "string" && /^\d{2}:\d{2}$/.test(b.start_time))
    .map((b) => ({ title: String(b.title || "").trim(), startHm: b.start_time as string, startMin: parseHm(b.start_time) }))
    .filter((b) => b.startMin > nowMin && b.title)
    .sort((a, b) => a.startMin - b.startMin);
  return upcoming.length ? { title: upcoming[0].title, startHm: upcoming[0].startHm } : null;
}

export type Earnings = { amount: number; currency: string };

/** Tracked minutes + dominant-currency earnings for entries whose LOCAL start
 *  date matches `localDate`. Earnings only counts entries on a category with a
 *  rate set. Multi-currency days collapse to the currency with the most money. */
export function trackedAndEarnings(
  entries: TimeEntryRow[],
  categories: CategoryRow[],
  localDate: string,
  tz: string,
  nowMs: number,
): { trackedMin: number; earnings: Earnings | null } {
  const rateByCat = new Map<string, { rate: number; currency: string }>();
  for (const c of categories) {
    const rate = Number(c.hourly_rate || 0);
    if (rate > 0) rateByCat.set(c.id, { rate, currency: (c.currency || "USD").toUpperCase() });
  }

  let trackedMs = 0;
  const byCurrency = new Map<string, number>();

  for (const e of entries) {
    if (!e.started_at) continue;
    const startMs = Date.parse(e.started_at);
    if (!Number.isFinite(startMs)) continue;
    // Only entries that *started* today (local).
    if (ymdInTz(new Date(startMs), tz) !== localDate) continue;
    const endMs = e.ended_at ? Date.parse(e.ended_at) : nowMs;
    const durMs = Math.max(0, (Number.isFinite(endMs) ? endMs : nowMs) - startMs);
    trackedMs += durMs;

    const cat = e.category_id ? rateByCat.get(e.category_id) : undefined;
    if (cat) {
      const money = (durMs / 3_600_000) * cat.rate;
      byCurrency.set(cat.currency, (byCurrency.get(cat.currency) || 0) + money);
    }
  }

  let earnings: Earnings | null = null;
  for (const [currency, amount] of byCurrency) {
    if (!earnings || amount > earnings.amount) earnings = { amount, currency };
  }
  return { trackedMin: Math.round(trackedMs / 60000), earnings };
}

export function fmtMoney(e: Earnings): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: e.currency,
      maximumFractionDigits: e.amount % 1 === 0 ? 0 : 2,
    }).format(e.amount);
  } catch {
    return `${e.currency} ${e.amount.toFixed(2)}`;
  }
}

export type Overrun = {
  remainingMin: number;
  timeLeftMin: number;
  /** remaining − timeLeft. Positive = more planned work than time left. */
  behindBy: number;
};

/** Compare still-open planned minutes against time left before active hours
 *  end. Uses estimated_minutes when present, else duration_min. */
export function computeOverrun(blocks: BlockRow[], nowMin: number, activeEndMin: number): Overrun {
  const remainingMin = blocks
    .filter(isUserTask)
    .filter(isOpen)
    .reduce((sum, b) => {
      const est = Number(b.estimated_minutes || 0);
      const dur = est > 0 ? est : Number(b.duration_min || 0);
      return sum + Math.max(0, dur);
    }, 0);
  const timeLeftMin = Math.max(0, activeEndMin - nowMin);
  return { remainingMin, timeLeftMin, behindBy: remainingMin - timeLeftMin };
}

/** Minutes until the energy peak window opens, if it's still ahead today. */
export function energyPeakInMin(zones: EnergyZones, nowMin: number): number | null {
  const peak = zones?.peak;
  if (!Array.isArray(peak) || peak.length < 1) return null;
  const startHour = Number(peak[0]);
  if (!Number.isFinite(startHour)) return null;
  const peakStartMin = startHour * 60;
  const delta = peakStartMin - nowMin;
  // Only surface when it's coming up soon (next ~2h) and hasn't started.
  if (delta > 10 && delta <= 120) return delta;
  return null;
}

// ── Copy builders ─────────────────────────────────────────────────────────

/** Deterministic pick from a list, seeded by date so the same day reads the
 *  same on every open but the phrasing varies day to day. */
function pickByDate<T>(arr: T[], localDate: string): T {
  const seed = localDate.split("-").reduce((acc, p) => acc * 31 + parseInt(p, 10), 7) >>> 0;
  return arr[seed % arr.length];
}

export type MorningInput = {
  yesterday: DaySummary;
  next: { title: string; startHm: string } | null;
  energyPeakMin: number | null;
  streak: number;
  localDate: string;
};

export function buildMorningBrief(i: MorningInput): Nudgeable {
  const parts: string[] = [];
  const carry = i.yesterday.openTitles.length;

  if (carry > 0) {
    parts.push(carry === 1 ? `1 task waiting from yesterday` : `${carry} tasks waiting from yesterday`);
  }
  if (i.next) {
    parts.push(`${i.next.title} at ${i.next.startHm}`);
  }
  if (i.energyPeakMin != null) {
    parts.push(`focus peak in ~${i.energyPeakMin}m`);
  }

  // Streak/momentum (#6) — woven in, never its own nag.
  let title: string;
  if (i.streak >= 3) {
    title = pickByDate([`Day ${i.streak} — keep the thread`, `${i.streak}-day streak`, `Morning — ${i.streak} in a row`], i.localDate);
  } else {
    title = pickByDate(["Morning — here's your day", "Morning — plan the day?", "Good morning"], i.localDate);
  }

  let body: string;
  if (parts.length === 0) {
    // Clean slate: nothing carried, nothing scheduled yet.
    body = i.streak >= 3
      ? `Yesterday you closed it all. Line up today to keep the streak?`
      : pickByDate([
          "Nothing carried over. Want to shape today in a couple of minutes?",
          "Blank canvas. A quick plan now makes the day run itself.",
        ], i.localDate);
  } else {
    body = capitalize(joinClauses(parts)) + ".";
    if (carry > 0) body += " Start with one of those.";
  }

  return { title, body, url: "/today" };
}

export type EveningInput = {
  today: DaySummary;
  trackedMin: number;
  earnings: Earnings | null;
  localDate: string;
};

export function buildEveningDebrief(i: EveningInput): Nudgeable {
  const { doneCount, totalCount, pct, openTitles } = i.today;
  const open = openTitles.length;

  const metrics: string[] = [];
  if (totalCount > 0) metrics.push(`${doneCount}/${totalCount} tasks (${pct}%)`);
  if (i.trackedMin >= 5) metrics.push(`${fmtDuration(i.trackedMin)} tracked`);
  if (i.earnings && i.earnings.amount >= 0.5) metrics.push(fmtMoney(i.earnings));

  const title = pickByDate(["Today's wrap", "Day in review", "Evening recap"], i.localDate);

  let body: string;
  if (metrics.length === 0) {
    body = "Quiet one on the plan. Want a quick recap before tomorrow?";
  } else {
    body = metrics.join(" · ") + ".";
    if (open === 1) body += ` Move "${truncate(openTitles[0], 28)}" to tomorrow?`;
    else if (open > 1) body += ` Carry ${open} unfinished into tomorrow?`;
  }

  return { title, body, url: "/reports" };
}

export type OverrunInput = {
  overrun: Overrun;
  nowHm: string;
  localDate: string;
};

export function buildOverrun(i: OverrunInput): Nudgeable {
  const work = fmtDuration(i.overrun.remainingMin);
  const left = fmtDuration(i.overrun.timeLeftMin);
  const title = pickByDate(["Running behind", "Day's tightening up", "Heads up on time"], i.localDate);
  const body = left
    ? `It's ${i.nowHm} — about ${work} of work left, ~${left} before you wrap. Trim or reschedule?`
    : `It's ${i.nowHm} — about ${work} of planned work still open. Reschedule what won't fit?`;
  return { title, body, url: "/today/plan" };
}

// ── tiny string utils ───────────────────────────────────────────────────────

export type Nudgeable = { title: string; body: string; url: string };

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** "a", "b", "c" → "a, b and c" (Oxford-free, reads like speech). */
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] || "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
