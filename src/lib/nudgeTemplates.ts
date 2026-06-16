/**
 * Daily nudge copy — the morning/evening pings.
 *
 * These replaced the old server-side nudge stack (the `send-daily-nudges` cron +
 * push dispatch). They're now plain on-device local notifications scheduled by
 * `syncDailyNudges` in `localNotifications.ts`, so there's no Supabase function,
 * no cron, and no push tokens to feed.
 *
 * Two layers:
 *   1. Evergreen templates (below) — never reference live data, so they're safe
 *      to schedule days in advance as a buffer. Picked deterministically by date
 *      (same day reads the same, varies day to day).
 *   2. Fresh builders (`buildMorningFresh` / `buildEveningFresh`) — fold in the
 *      user's real numbers for TODAY's slot, computed when the app is opened.
 *      Return `null` when there's nothing meaningful to say, so the caller falls
 *      back to an evergreen template.
 *
 * Voice: plain, specific, a little dry. No hype, no shame, no exclamation spam.
 * English only.
 */

export type NudgeCopy = { title: string; body: string };

// ── Evergreen pools ─────────────────────────────────────────────────────────

export const MORNING_TEMPLATES: NudgeCopy[] = [
  { title: "Plan your day", body: "Two minutes now beats a scattered afternoon." },
  { title: "Good morning", body: "What's the one task that would make today a win?" },
  { title: "First move", body: "Pick what you'll start with before the day picks for you." },
  { title: "Set the tone", body: "A planned morning tends to run itself." },
  { title: "Before the noise", body: "Block out your focus time while it's still quiet." },
  { title: "Today's shape", body: "Rough out the day — you can always adjust later." },
  { title: "One big rock", body: "Schedule the hard thing first. The rest fits around it." },
  { title: "Morning check-in", body: "What does 'done' look like for today?" },
  { title: "Get ahead", body: "Five minutes of planning, fewer surprises by 3pm." },
  { title: "Fresh start", body: "Yesterday's closed. What matters today?" },
  { title: "Draft the day", body: "A loose plan beats a perfect one you never make." },
  { title: "Protect your focus", body: "Give your best hours to the work that needs them." },
  { title: "Name it", body: "Vague plans slip. Give each block a clear task." },
  { title: "Quick setup", body: "Line up the day so you're not deciding on the fly." },
  { title: "Top of the morning", body: "Start with intent, not your inbox." },
  { title: "The 80/20", body: "Which task moves the needle most? Do that one." },
  { title: "Ready, set", body: "A few taps now and you're set to just execute." },
  { title: "Morning momentum", body: "Knock out something small to get rolling." },
  { title: "Map it out", body: "Know your day's edges: when you start, when you stop." },
  { title: "Choose your hard thing", body: "Pick the task you'd avoid. Schedule it early." },
  { title: "Clear runway", body: "Plan the morning; let the afternoon flex." },
  { title: "Today, on purpose", body: "Decide how today goes before it decides for you." },
  { title: "Warm up", body: "Open the plan, set three things, go." },
  { title: "The day ahead", body: "What would make tonight feel like a good day?" },
];

export const EVENING_TEMPLATES: NudgeCopy[] = [
  { title: "How'd today go?", body: "Take 30 seconds to close the loop." },
  { title: "Wind down", body: "Check off what you finished — take the credit." },
  { title: "Tomorrow's easier", body: "Set up tomorrow now, thank yourself in the morning." },
  { title: "Day's end", body: "Anything unfinished worth moving to tomorrow?" },
  { title: "Look back", body: "What went well today? Worth repeating." },
  { title: "Close the day", body: "Review, tidy the plan, and switch off." },
  { title: "Quick recap", body: "A minute now turns today into a head start." },
  { title: "Reset", body: "Clear the open tasks so they don't follow you to bed." },
  { title: "Evening check-in", body: "Did today match the plan? Just notice — no judgment." },
  { title: "Carry forward", body: "Move what's left to tomorrow before you forget." },
  { title: "One good thing", body: "Name one win from today. A small one counts." },
  { title: "Wrap up", body: "Mark what's done. Park the rest for tomorrow." },
  { title: "Tomorrow you", body: "Leave a clear plan for the you who wakes up." },
  { title: "Settle the day", body: "Loose ends? Decide now, rest easier." },
  { title: "The honest look", body: "What ate your time today? Plan around it tomorrow." },
  { title: "Last call", body: "Anything you can finish in two minutes before you stop?" },
  { title: "Day in review", body: "Done is done. Note it, then let go." },
  { title: "Set up the morning", body: "Future-you starts faster with a plan waiting." },
  { title: "Take stock", body: "Progress over perfection — what moved forward today?" },
  { title: "Power down", body: "Plan tomorrow, then actually unplug." },
  { title: "Tidy up", body: "A clean plan tonight, a calm start tomorrow." },
  { title: "Reflect", body: "What would you do differently tomorrow?" },
  { title: "Good stopping point", body: "Close out today so it doesn't leak into tonight." },
  { title: "Before bed", body: "Two minutes of planning buys a smoother morning." },
];

// ── Deterministic per-day pick ──────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable choice for a given day (salt separates morning vs evening streams). */
function pickByDate<T>(arr: T[], dateStr: string, salt: string): T {
  return arr[hashStr(dateStr + salt) % arr.length];
}

export const pickMorningTemplate = (dateStr: string): NudgeCopy =>
  pickByDate(MORNING_TEMPLATES, dateStr, "morning");

export const pickEveningTemplate = (dateStr: string): NudgeCopy =>
  pickByDate(EVENING_TEMPLATES, dateStr, "evening");

// ── Smart re-engagement (pattern-timed) ─────────────────────────────────────
// One extra ping at the user's learned productive hour. Habit-based copy ONLY —
// it never cites live task counts, so a notification scheduled hours in advance
// can't go stale by the time it fires.

export const SMART_TEMPLATES: NudgeCopy[] = [
  { title: "Your productive window", body: "This is usually when you follow through. Line up your next task?" },
  { title: "Good hour to make progress", body: "Around now is when you tend to get things done." },
  { title: "Momentum time", body: "You're often at your most consistent right about now." },
  { title: "Pick one thing", body: "This is a strong stretch for you — knock something out?" },
  { title: "Keep it rolling", body: "Now's usually a productive window. What's next on your plan?" },
];

export const pickSmartTemplate = (dateStr: string): NudgeCopy =>
  pickByDate(SMART_TEMPLATES, dateStr, "smart");

// ── Fresh, data-aware copy for TODAY's slot ─────────────────────────────────

const firstName = (name?: string): string => (name ? name.trim().split(/\s+/)[0] : "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Morning ping with real numbers. Leads with yesterday's result (the strongest
 * "nudge" signal) and today's load. Returns null when there's nothing to report
 * (brand-new user / empty days) so the caller uses an evergreen template.
 */
export function buildMorningFresh(p: {
  yesterdayDone: number;
  yesterdayTotal: number;
  todayTotal: number;
  name?: string;
}): NudgeCopy | null {
  if (p.yesterdayTotal === 0 && p.todayTotal === 0) return null;

  const who = firstName(p.name);
  const title = who ? `Good morning, ${who}` : "Good morning";

  const parts: string[] = [];
  if (p.yesterdayTotal > 0) parts.push(`Yesterday: ${p.yesterdayDone}/${p.yesterdayTotal} done.`);
  if (p.todayTotal > 0) parts.push(`${plural(p.todayTotal, "task", "tasks")} planned today.`);
  else parts.push("Nothing planned yet — rough out your day.");

  return { title, body: parts.join(" ") };
}

/**
 * Evening ping with today's score. Returns null when nothing was planned, so the
 * evening still gets a (reflective) evergreen template rather than "0/0".
 */
export function buildEveningFresh(p: { done: number; total: number }): NudgeCopy | null {
  if (p.total === 0) return null;
  if (p.done >= p.total) {
    return { title: "How'd today go?", body: `All ${p.total} done — nice. Set up tomorrow?` };
  }
  return { title: "How'd today go?", body: `${p.done}/${p.total} done. Move the rest to tomorrow?` };
}
