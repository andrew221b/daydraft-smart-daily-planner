/**
 * Insight layer — turns a window of a user's history into the single most
 * interesting *true* thing to lead a nudge with: a pattern they hadn't put into
 * words ("Tuesdays tend to be your strongest"), a milestone worth marking
 * ("Day 7 — your longest run yet"), or a weekly recap headline.
 *
 * Everything here is PURE (no I/O), like briefData.ts — the cron fetches the
 * rows, this module does the math and the copy. The whole point is restraint:
 * a "feature line" only fires when the data clears a sample-size + margin gate,
 * so the same truth never repeats daily and the rare ones feel earned. Most
 * days return null and the nudge stays its clean, helpful self.
 *
 * Voice mirrors _shared/persona.ts: plain words, real numbers, no hype, no
 * shame, no exclamation/emoji. A friend noticing, never a coach cheering.
 */

import {
  type BlockRow,
  type CategoryRow,
  type DaySummary,
  type Earnings,
  type Nudgeable,
  type TimeEntryRow,
  capitalize,
  fmtDuration,
  fmtMoney,
  isDone,
  isUserTask,
  parseHm,
  pickByDate,
  ymdInTz,
} from "./briefData.ts";

// ── Shapes ──────────────────────────────────────────────────────────────────

/** Per-category tracked time + earnings for one day. */
export type TrackedCategory = {
  name: string;
  trackedMin: number;
  amount: number;
  currency: string;
};

/** One historical day, condensed. tracked/amount are only populated where the
 *  caller fetched time entries (evening/weekly); morning leaves them at 0. */
export type DayStat = {
  date: string; // YYYY-MM-DD (local)
  dow: number; // 0=Sun .. 6=Sat
  doneCount: number;
  totalCount: number;
  pct: number;
  trackedMin: number;
  amount: number;
  currency: string;
  /** Category holding the most tracked time this day, when it's clearly dominant.
   *  null when entries weren't fetched or no single category leads. */
  topCategory: TrackedCategory | null;
};

/** Raw per-day rows the cron hands in: a plan's date + its blocks, plus
 *  optional money fields when entries were fetched. */
export type HistoryRow = {
  date: string;
  blocks: BlockRow[];
  trackedMin?: number;
  amount?: number;
  currency?: string;
  /** Pre-computed category breakdown for this day (from time_entries × time_categories). */
  categories?: TrackedCategory[];
};

// ── Date helpers (shared with the cron) ──────────────────────────────────────

/** Weekday for a local YYYY-MM-DD, tz-stable via UTC noon. 0=Sun..6=Sat. */
export function dowOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Whole days from `a` to `b` (b − a). Both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T12:00:00Z`);
  const db = Date.parse(`${b}T12:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}

/** Shift a YYYY-MM-DD by n days. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function buildDayStats(rows: HistoryRow[]): DayStat[] {
  return rows.map((r) => {
    const tasks = r.blocks.filter(isUserTask);
    const done = tasks.filter(isDone).length;
    const total = tasks.length;
    const trackedMin = Math.max(0, Math.round(r.trackedMin || 0));

    // Dominant category: must hold ≥40% of the day's tracked time and ≥20 min.
    let topCategory: TrackedCategory | null = null;
    if (r.categories && r.categories.length > 0 && trackedMin > 0) {
      const top = r.categories[0]; // already sorted desc by trackedMin by categoryBreakdown
      if (top.trackedMin >= 20 && top.trackedMin / trackedMin >= 0.4) topCategory = top;
    }

    return {
      date: r.date,
      dow: dowOf(r.date),
      doneCount: done,
      totalCount: total,
      pct: total > 0 ? Math.round((done / total) * 100) : 0,
      trackedMin,
      amount: Math.max(0, r.amount || 0),
      currency: r.currency || "USD",
      topCategory,
    };
  });
}

const sum = (a: number[]): number => a.reduce((s, x) => s + x, 0);
const avg = (a: number[]): number => (a.length ? sum(a) / a.length : 0);

// ── Pattern insights (morning) ───────────────────────────────────────────────

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** Your best weekday — only ever surfaced ON that weekday, so it lands as
 *  "and it's that day". Needs a few weeks of signal and a clear lead. */
function insightStrongestWeekday(stats: DayStat[], todayDow: number): string | null {
  const planned = stats.filter((d) => d.totalCount > 0);
  if (planned.length < 8) return null;

  const byDow = new Map<number, number[]>();
  for (const d of planned) {
    const arr = byDow.get(d.dow) ?? [];
    arr.push(d.pct);
    byDow.set(d.dow, arr);
  }
  const todays = byDow.get(todayDow);
  if (!todays || todays.length < 3) return null;

  let bestDow = -1;
  let bestAvg = -1;
  for (const [dow, arr] of byDow) {
    if (arr.length < 3) continue;
    const a = avg(arr);
    if (a > bestAvg) {
      bestAvg = a;
      bestDow = dow;
    }
  }
  if (bestDow !== todayDow) return null;
  if (avg(todays) - avg(planned.map((d) => d.pct)) < 15) return null;

  return `${WEEKDAYS[todayDow]} tend to be your strongest — line up the hard one early.`;
}

/** Morning vs afternoon completion, from when tasks were scheduled. Needs a
 *  real sample each side and a 20pt gap. Both directions read positively. */
function insightTimeOfDay(rows: HistoryRow[]): string | null {
  let amDone = 0, amTot = 0, pmDone = 0, pmTot = 0;
  for (const r of rows) {
    for (const b of r.blocks) {
      if (!isUserTask(b)) continue;
      if (typeof b.start_time !== "string" || !/^\d{2}:\d{2}$/.test(b.start_time)) continue;
      const before = parseHm(b.start_time) < 12 * 60;
      const done = isDone(b);
      if (before) { amTot += 1; if (done) amDone += 1; } else { pmTot += 1; if (done) pmDone += 1; }
    }
  }
  if (amTot < 6 || pmTot < 6) return null;
  const amPct = (amDone / amTot) * 100;
  const pmPct = (pmDone / pmTot) * 100;
  if (amPct - pmPct >= 20) return "You finish more before noon. Put the big one first?";
  if (pmPct - amPct >= 20) return "Afternoons are when you close things. Save focus for later?";
  return null;
}

/** Week-over-week completion — only surfaced when it's genuinely up. Down
 *  weeks stay silent (no shame). */
function insightMomentum(stats: DayStat[], localDate: string): string | null {
  const last = stats.filter((d) => { const a = daysBetween(d.date, localDate); return a >= 1 && a <= 7 && d.totalCount > 0; });
  const prior = stats.filter((d) => { const a = daysBetween(d.date, localDate); return a >= 8 && a <= 14 && d.totalCount > 0; });
  if (last.length < 3 || prior.length < 3) return null;
  const a = Math.round(avg(last.map((d) => d.pct)));
  const b = Math.round(avg(prior.map((d) => d.pct)));
  if (a - b >= 10) return `You're closing more than last week — ${a}% to ${b}%.`;
  return null;
}

// ── Milestone moments ────────────────────────────────────────────────────────

const ROUND_STREAKS = new Set([7, 14, 30, 50, 100, 200, 365]);

function roundStreakCopy(streak: number): string {
  switch (streak) {
    case 7: return "Seven days straight. It's a rhythm now.";
    case 14: return "Two weeks running. The habit's holding.";
    case 30: return "Thirty days — a full month of showing up.";
    case 50: return "Fifty days in. Quietly remarkable.";
    case 100: return "Day 100. Not many get here.";
    case 200: return "Two hundred days. This is just who you are now.";
    case 365: return "A full year, planned. Take that in.";
    default: return `${streak} days in a row.`;
  }
}

/** Morning milestone, or null. Rare by nature. */
function morningMilestone(ctx: { streak: number; longestStreak: number; gapDays: number }): string | null {
  // Coming back after a real gap takes precedence — the streak just reset to 1.
  if (ctx.gapDays >= 3 && ctx.gapDays <= 60) return "Back at it after a few quiet days.";
  if (ROUND_STREAKS.has(ctx.streak)) return roundStreakCopy(ctx.streak);
  if (ctx.streak >= 3 && ctx.streak === ctx.longestStreak) return `Day ${ctx.streak} — your longest run yet.`;
  return null;
}

/** Evening personal record — today beats the trailing window on the dimension
 *  with the biggest relative jump. Needs enough history to mean something. */
function eveningRecord(ctx: {
  today: DaySummary;
  trackedMin: number;
  earnings: Earnings | null;
  history: DayStat[];
  localDate: string;
}): string | null {
  const past = ctx.history.filter((d) => d.date !== ctx.localDate);
  if (past.length < 7) return null;

  const maxDone = Math.max(0, ...past.map((d) => d.doneCount));
  const maxTracked = Math.max(0, ...past.map((d) => d.trackedMin));
  const maxAmount = Math.max(0, ...past.map((d) => d.amount));

  const todayDone = ctx.today.doneCount;
  const todayTracked = ctx.trackedMin;
  const todayAmount = ctx.earnings?.amount ?? 0;

  const beats: { copy: string; score: number }[] = [];
  if (todayDone > maxDone && todayDone >= 5) {
    beats.push({ copy: `Most tasks you've closed in a day — ${todayDone}.`, score: todayDone / Math.max(1, maxDone) });
  }
  if (todayTracked > maxTracked && todayTracked >= 180) {
    beats.push({ copy: `Most you've tracked in a day this month — ${fmtDuration(todayTracked)}.`, score: todayTracked / Math.max(1, maxTracked) });
  }
  if (ctx.earnings && todayAmount > maxAmount && todayAmount >= 50) {
    beats.push({ copy: `Your biggest earning day this month — ${fmtMoney(ctx.earnings)}.`, score: todayAmount / Math.max(1, maxAmount) });
  }
  if (!beats.length) return null;
  beats.sort((a, b) => b.score - a.score);
  return beats[0].copy;
}

// ── Selection (milestone > pattern, one line max) ────────────────────────────

/** Consecutive days in history where trackedMin >= 30, most-recent first.
 *  Fires as a milestone at thresholds ≥5. Ranked below plan-streak milestones
 *  (those already returned early) but above pattern insights. */
function insightTrackingStreak(history: DayStat[]): string | null {
  const TRACK_THRESHOLDS = new Set([5, 7, 10, 14, 21, 30]);
  // Count consecutive tracked days ending at the most recent day in history.
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (d.trackedMin < 30) break;
    if (prev !== null && daysBetween(d.date, prev) !== 1) break;
    streak += 1;
    prev = d.date;
  }
  if (!TRACK_THRESHOLDS.has(streak)) return null;
  return `Tracked every day for ${streak} day${streak === 1 ? "" : "s"} straight.`;
}

export function selectMorningFeature(ctx: {
  history: HistoryRow[];
  todayDow: number;
  streak: number;
  longestStreak: number;
  localDate: string;
  gapDays: number;
}): string | null {
  const milestone = morningMilestone(ctx);
  if (milestone) return milestone;

  const stats = buildDayStats(ctx.history);

  // Tracking-streak milestone — below plan-streaks but above pattern insights.
  const trackStreak = insightTrackingStreak(stats);
  if (trackStreak) return trackStreak;

  const candidates: string[] = [];
  const wd = insightStrongestWeekday(stats, ctx.todayDow);
  if (wd) candidates.push(wd);
  const tod = insightTimeOfDay(ctx.history);
  if (tod) candidates.push(tod);
  const mo = insightMomentum(stats, ctx.localDate);
  if (mo) candidates.push(mo);

  if (!candidates.length) return null;
  // Date-rotate so that when several patterns qualify, they take turns rather
  // than the same one showing every eligible day.
  return pickByDate(candidates, ctx.localDate);
}

export function selectEveningFeature(ctx: {
  today: DaySummary;
  trackedMin: number;
  earnings: Earnings | null;
  history: DayStat[];
  localDate: string;
}): string | null {
  // A clean sweep is the most satisfying moment to lead with.
  if (ctx.today.totalCount >= 3 && ctx.today.doneCount === ctx.today.totalCount) {
    return "Cleared the board — every task done.";
  }
  return eveningRecord(ctx);
}

// ── Slot decisions ────────────────────────────────────────────────────────────

/** Evening: was today dominated by tracking (lots of time entries) or by task
 *  planning/execution? Each surface gets its own nudge copy so they're never
 *  mixed. Tracker wins when trackedMin is at least 45 min AND clearly outweighs
 *  the plan engagement proxy. */
export function selectEveningSlot(today: DayStat): "tracker" | "plan" {
  if (today.trackedMin < 45) return "plan";
  const planScore = (today.doneCount + (today.totalCount - today.doneCount) * 0.5) * 30;
  return today.trackedMin > planScore ? "tracker" : "plan";
}

/** Morning: nudge toward the underused surface. When the user has been planning
 *  regularly but barely touching the tracker for the last 7 days, the morning
 *  gently invites them to try tracking today. */
export function selectMorningSlot(history: DayStat[]): "tracker-motivate" | "plan" {
  const last7 = history.filter((d) => d.totalCount > 0 || d.trackedMin >= 30).slice(-7);
  const planDays = last7.filter((d) => d.totalCount > 0).length;
  const trackerDays = last7.filter((d) => d.trackedMin >= 30).length;
  // Only nudge when the user plans regularly but tracks on less than half those days.
  if (planDays >= 3 && trackerDays < Math.ceil(planDays / 2)) return "tracker-motivate";
  return "plan";
}

// ── Category breakdown ────────────────────────────────────────────────────────

/** Aggregate time entries for `localDate` into per-category totals. Returns
 *  them sorted desc by trackedMin. Reuses the same entries + categories the
 *  cron already fetched — no extra DB call. */
export function categoryBreakdown(
  entries: TimeEntryRow[],
  categories: CategoryRow[],
  localDate: string,
  tz: string,
  nowMs: number,
): TrackedCategory[] {
  const nameById = new Map<string, string>();
  const rateById = new Map<string, { rate: number; currency: string; rateSetAt: number }>();

  for (const c of categories) {
    nameById.set(c.id, String(c.name || "Uncategorised"));
    const rate = Number(c.hourly_rate || 0);
    if (rate > 0) {
      const rateSetAt = c.rate_set_at ? Date.parse(String(c.rate_set_at)) : 0;
      rateById.set(c.id, { rate, currency: String(c.currency || "USD").toUpperCase(), rateSetAt });
    }
  }

  const byCategory = new Map<string, { trackedMs: number; amount: number; currency: string }>();

  for (const e of entries) {
    if (!e.started_at) continue;
    const startMs = Date.parse(e.started_at);
    if (!Number.isFinite(startMs)) continue;
    if (ymdInTz(new Date(startMs), tz) !== localDate) continue;

    const endMs = e.ended_at ? Date.parse(e.ended_at) : nowMs;
    const durMs = Math.max(0, (Number.isFinite(endMs) ? endMs : nowMs) - startMs);
    if (durMs === 0) continue;

    const catId = e.category_id || "__none__";
    const prev = byCategory.get(catId) ?? { trackedMs: 0, amount: 0, currency: "USD" };

    const rateInfo = e.category_id ? rateById.get(e.category_id) : undefined;
    const earningEligible = rateInfo && (!rateInfo.rateSetAt || startMs >= rateInfo.rateSetAt);
    const money = earningEligible ? (durMs / 3_600_000) * rateInfo!.rate : 0;
    const currency = rateInfo?.currency ?? prev.currency;

    byCategory.set(catId, {
      trackedMs: prev.trackedMs + durMs,
      amount: prev.amount + money,
      currency,
    });
  }

  const result: TrackedCategory[] = [];
  for (const [catId, data] of byCategory) {
    const name = catId === "__none__" ? "Uncategorised" : (nameById.get(catId) ?? "Uncategorised");
    result.push({
      name,
      trackedMin: Math.round(data.trackedMs / 60000),
      amount: Math.round(data.amount * 100) / 100,
      currency: data.currency,
    });
  }
  return result.sort((a, b) => b.trackedMin - a.trackedMin).filter((c) => c.trackedMin >= 1);
}

// ── Tracker nudge builders ────────────────────────────────────────────────────

/** Evening nudge for days when tracking dominated. Surfaces the top category,
 *  optional earnings, and a tracker-context closing line. */
export function buildTrackerEvening(ctx: {
  today: DayStat;
  categories: TrackedCategory[]; // today's breakdown, sorted desc
  localDate: string;
}): Nudgeable {
  const { trackedMin } = ctx.today;
  // Earnings from categories (more reliable than DayStat.amount when categories carry their own totals).
  const amount = ctx.categories.reduce((s, c) => s + c.amount, 0);
  const currency = ctx.categories.find((c) => c.amount > 0)?.currency ?? "USD";

  const title = trackedMin >= 180
    ? pickByDate(["Strong session", "Long day on the clock", "Well tracked"], ctx.localDate)
    : trackedMin >= 90
      ? pickByDate(["Good day on the clock", "Solid session", "Tracked today"], ctx.localDate)
      : pickByDate(["Tracked today", "On the clock", "Time logged"], ctx.localDate);

  // Build the time body: single dominant category, or up to 3 named.
  let timeBody: string;
  if (ctx.today.topCategory) {
    timeBody = `Most of today went to ${ctx.today.topCategory.name} — ${fmtDuration(ctx.today.topCategory.trackedMin)}.`;
  } else if (ctx.categories.length > 0) {
    const top3 = ctx.categories.slice(0, 3);
    const parts = top3.map((c) => `${fmtDuration(c.trackedMin)} ${c.name}`);
    const rest = ctx.categories.length > 3 ? " …" : "";
    timeBody = parts.join(", ") + rest + ".";
  } else {
    timeBody = `${fmtDuration(trackedMin)} tracked today.`;
  }

  const earningsLine = amount >= 0.5 ? ` Earned ${new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount)}.` : "";
  const closer = closingLine(ctx.localDate, "evening", "tracker");
  const body = `${timeBody}${earningsLine} ${closer}`;

  return { title, body, url: "/tracker" };
}

/** Morning nudge for users who plan but rarely track. A warm, non-nagging
 *  invite showing the value of tracking, anchored to today's first task. */
export function buildTrackerMotivationMorning(ctx: {
  next: { title: string; startHm: string } | null;
  taskCount: number;
  localDate: string;
}): Nudgeable {
  const taskWord = ctx.taskCount === 1 ? "1 task" : `${ctx.taskCount} tasks`;
  const anchor = ctx.next ? `Start the timer when "${ctx.next.title}" begins` : "Start the timer on the first one";
  const lines = [
    `${capitalize(taskWord)} ahead today. ${anchor} — it takes a tap and shows where time really goes.`,
    `${capitalize(taskWord)} on the plan. Tracking even one would show how the day actually unfolds.`,
    `Good start on the plan. The tracker's ready when you are — a single tap is all it takes.`,
  ];
  const body = `${pickByDate(lines, ctx.localDate)} ${closingLine(ctx.localDate, "morning", "tracker")}`;
  return {
    title: pickByDate(["One thing to try today", "Quick thought", "Morning"], ctx.localDate),
    body,
    url: "/tracker",
  };
}

// ── Closing-line pool ─────────────────────────────────────────────────────────

/** Context-matched closing line, seeded by date+slot so it's deterministic
 *  (same nudge reads the same phrase all day) but varies from day to day.
 *  Context prevents semantic mismatches with the body it follows. */
export function closingLine(
  localDate: string,
  slot: "morning" | "evening" | "weekly",
  context: "strong" | "struggle" | "neutral" | "tracker" = "neutral",
): string {
  const pools: Record<string, string[]> = {
    strong: [
      "Rest is part of the work.",
      "Momentum is just repeated decisions.",
      "The streak is proof. Keep it.",
      "You showed up. That counts.",
      "That's how it's done.",
      "Done is a feeling too.",
    ],
    struggle: [
      "Progress is rarely linear. Keep going.",
      "A good day doesn't need to be a perfect one.",
      "The days that feel small often aren't.",
      "Most great work looked messy in the middle.",
      "Effort you can't see still counts.",
      "Tomorrow is a reset.",
    ],
    tracker: [
      "Clarity comes from action, not thinking.",
      "Start before you're ready — you never are.",
      "An hour now saves three hours tomorrow.",
      "Slow is smooth. Smooth is fast.",
      "What gets measured gets clearer.",
      "Time is the only thing you can't earn back.",
    ],
    neutral: [
      "Done is better than perfect.",
      "Consistent beats brilliant.",
      "One task at a time. That's enough.",
      "Small steps still move things forward.",
      "Tomorrow's you will appreciate this.",
      "The best move is usually the next one.",
      "Focus is saying no to almost everything.",
      "Showing up is the strategy.",
      "Do less, but do it well.",
      "The plan isn't the goal. The day is.",
    ],
  };
  const pool = pools[context] ?? pools.neutral;
  // Slot offset rotates the pick within the pool so morning ≠ evening on the same day.
  const slotOffset = slot === "morning" ? 0 : slot === "evening" ? 3 : 6;
  const seed = (localDate.split("-").reduce((acc, p) => acc * 31 + parseInt(p, 10), 7) >>> 0) + slotOffset;
  return pool[seed % pool.length];
}

// ── Weekly recap ─────────────────────────────────────────────────────────────

function sumEarnings(days: DayStat[]): Earnings | null {
  const by = new Map<string, number>();
  for (const d of days) if (d.amount > 0) by.set(d.currency, (by.get(d.currency) || 0) + d.amount);
  let best: Earnings | null = null;
  for (const [currency, amount] of by) if (!best || amount > best.amount) best = { currency, amount };
  return best;
}

export function buildWeeklyRecap(ctx: {
  week: DayStat[];
  priorWeek: DayStat[];
  streak: number;
  localDate: string;
  /** Dominant tracker category across the week (highest total trackedMin). */
  topWeekCategory?: TrackedCategory | null;
  /** Pre-computed closer; if absent one is derived from context. */
  closer?: string;
}): Nudgeable {
  const w = ctx.week;
  const done = sum(w.map((d) => d.doneCount));
  const total = sum(w.map((d) => d.totalCount));
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const tracked = sum(w.map((d) => d.trackedMin));
  const earn = sumEarnings(w);
  const daysPlanned = w.filter((d) => d.totalCount > 0).length;

  const priorDone = sum(ctx.priorWeek.map((d) => d.doneCount));
  const priorTotal = sum(ctx.priorWeek.map((d) => d.totalCount));
  const priorPct = priorTotal > 0 ? Math.round((priorDone / priorTotal) * 100) : 0;

  // Headline — the single most impressive true stat of the week.
  let headline: string;
  if (total > 0 && pct >= 80 && priorTotal > 0 && pct > priorPct) {
    headline = `Your sharpest week yet — ${done}/${total} done.`;
  } else if (total > 0 && pct >= 80) {
    headline = `Strong week — ${done}/${total} tasks done.`;
  } else if (tracked >= 600) {
    headline = earn ? `${fmtDuration(tracked)} tracked, ${fmtMoney(earn)} earned.` : `${fmtDuration(tracked)} tracked this week.`;
  } else if (daysPlanned >= 5) {
    headline = `${daysPlanned} days planned out of 7.`;
  } else if (total > 0) {
    headline = `${done}/${total} tasks done this week.`;
  } else {
    headline = "A quiet week on the plan.";
  }

  // One supporting line — add top category name if clearly dominant for the week.
  let support: string;
  if (priorTotal > 0 && pct > priorPct + 5) support = `Up from ${priorPct}% last week.`;
  else if (tracked >= 60 && !headline.includes("tracked")) {
    const catSuffix = ctx.topWeekCategory ? ` — mostly ${ctx.topWeekCategory.name}` : "";
    support = `${fmtDuration(tracked)} tracked${catSuffix}.`;
  } else if (ctx.streak >= 3) support = `Streak's at ${ctx.streak} days.`;
  else support = "See where the hours went and pick one thing to adjust.";

  const closer = ctx.closer ?? closingLine(ctx.localDate, "weekly", pct >= 75 ? "strong" : "neutral");
  return {
    title: pickByDate(["Your week in review", "The week, in short", "This week's recap"], ctx.localDate),
    body: `${capitalize(headline)} ${support} ${closer}`,
    url: "/reports",
  };
}
