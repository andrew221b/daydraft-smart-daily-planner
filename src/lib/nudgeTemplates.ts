/**
 * Daily nudge copy — two on-device pings a day: a morning brief and an evening
 * recap, each fired at a user-set time (Settings → Daily nudges).
 *
 * On-device only: scheduled by `syncDailyNudges` in `localNotifications.ts`.
 * No Supabase function, no cron, no push.
 *
 * Two layers per slot:
 *   1. Evergreen pools (`MORNING_TEMPLATES` / `EVENING_TEMPLATES`) — never
 *      reference live data, so they're safe to schedule days ahead as a buffer.
 *      Picked deterministically by date.
 *   2. Fresh builders (`buildMorningFresh` / `buildEveningFresh`) — fold in the
 *      user's real numbers for TODAY's slot. Return `null` when there's nothing
 *      to say, so the caller falls back to an evergreen line.
 *
 * Voice: a calm, encouraging friend who quietly trusts you'll handle your day,
 * not a productivity guru and not a hype machine. The job is gentle motivation
 * and a small lift, never pressure. Plain, warm, human. Steer clear of self-help
 * and AI clichés (eat the frog, small wins, future self, level up, take a moment,
 * you've got this, unlock, dive in, and the rest) and the usual AI tells: no
 * em-dashes, no "X: Y" colon pauses, no robotic "fragment. fragment." cadence.
 * Contractions, plain words, the odd soft question. No hype, no shame, no
 * exclamation spam. English only.
 */

export type NudgeCopy = { title: string; body: string };

// ── Morning pool — forward-looking, sets up the day ─────────────────────────
export const MORNING_TEMPLATES: NudgeCopy[] = [
  { title: "Morning", body: "You don't have to do everything today. Just the one thing that matters most." },
  { title: "Start small", body: "If getting going feels hard, shrink the first step until it doesn't." },
  { title: "First slot", body: "Pick the task you'd be glad to have behind you tonight, and give it the morning." },
  { title: "Ease in", body: "There's no prize for rushing. Choose one real thing and start it gently." },
  { title: "Your calm hours", body: "Mornings tend to be your steadiest. Spend them on what you actually care about." },
  { title: "You've done harder", body: "You've gotten through tougher mornings than this one. Begin wherever feels doable." },
  { title: "Make it smaller", body: "If today feels like a lot, keep what's essential and let the rest wait." },
  { title: "Readiness follows", body: "Waiting to feel ready can take all day. Starting usually brings it along." },
  { title: "One thing well", body: "One task done properly beats five left half-finished. Decide which one." },
  { title: "Your call", body: "You get to decide the shape of today before it decides for you." },
  { title: "Almost too easy", body: "Make the first step so small it feels almost too easy. Those are the ones that stick." },
  { title: "One at a time", body: "Give a single task your full attention this morning. The rest can take turns." },
  { title: "Honest and steady", body: "Today doesn't have to be impressive. Honest and steady will carry you far enough." },
  { title: "What it needs", body: "Be honest about what today really needs from you, then protect the time for it." },
  { title: "Enough", body: "Whatever you manage today is enough, as long as it's the part that counts." },
  { title: "Quiet start", body: "A calm start usually goes further than a frantic one. Take the calm one." },
];

// ── Evening pool — reflective, winds the day down ───────────────────────────
export const EVENING_TEMPLATES: NudgeCopy[] = [
  { title: "Evening", body: "However today went, you were in it. That's worth more than the final tally." },
  { title: "What you did", body: "Look at what you finished before you count what you didn't." },
  { title: "It just moves", body: "Whatever's left isn't a failure. It simply moves to tomorrow." },
  { title: "One clear thing", body: "Leave one clear first step for tomorrow. You'll be glad it's waiting." },
  { title: "Rest counts", body: "Rest is part of it, not a reward for finishing. You're allowed to stop now." },
  { title: "One good thing", body: "Notice one thing that went right today, even a small one. It still mattered." },
  { title: "No perfect plan", body: "Tomorrow doesn't need a full plan tonight. Just a first step you can pick up easily." },
  { title: "Fair measure", body: "You spent today with the energy you actually had. That's a fair way to judge it." },
  { title: "Close it gently", body: "End the day on purpose, instead of letting it quietly trail off." },
  { title: "Worth repeating", body: "What's one thing from today you'd happily do again tomorrow?" },
  { title: "Set it down", body: "You don't have to take the unfinished list to bed. Set it down for now." },
  { title: "Easier morning", body: "A few quiet minutes now make tomorrow morning noticeably easier on you." },
  { title: "It can wait", body: "Today's done. Whatever comes next can wait until you've actually rested." },
  { title: "Give yourself credit", body: "Give yourself some credit for the hard parts you got through today." },
  { title: "Leave it tidy", body: "Whatever you tidy tonight, you won't have to face first thing tomorrow." },
  { title: "Let it be enough", body: "Let today be enough. You can pick it back up when you're ready." },
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

/** Stable choice for a given day (same day reads the same, varies day to day). */
function pickByDate<T>(arr: T[], dateStr: string, salt: string): T {
  return arr[hashStr(dateStr + salt) % arr.length];
}

export const pickMorningTemplate = (dateStr: string): NudgeCopy =>
  pickByDate(MORNING_TEMPLATES, dateStr, "morning");
export const pickEveningTemplate = (dateStr: string): NudgeCopy =>
  pickByDate(EVENING_TEMPLATES, dateStr, "evening");

// ── Fresh, data-aware copy for TODAY's slots ────────────────────────────────

const firstName = (name?: string): string => (name ? name.trim().split(/\s+/)[0] : "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Morning brief with real numbers: yesterday's result (the strongest signal)
 * plus today's load. Returns null when there's nothing to report (brand-new
 * user / empty days) so the caller uses an evergreen line instead.
 */
export function buildMorningFresh(p: {
  yesterdayDone: number;
  yesterdayTotal: number;
  todayTotal: number;
  name?: string;
}): NudgeCopy | null {
  if (p.yesterdayTotal === 0 && p.todayTotal === 0) return null;

  const who = firstName(p.name);
  const title = who ? `Morning, ${who}` : "Morning";

  const parts: string[] = [];
  if (p.yesterdayTotal > 0) {
    if (p.yesterdayDone >= p.yesterdayTotal) parts.push("You finished everything yesterday. No need to top it, just begin.");
    else if (p.yesterdayDone === 0) parts.push("Yesterday didn't go your way. Today gets to be different.");
    else parts.push(`You got ${p.yesterdayDone} of ${p.yesterdayTotal} done yesterday. That counts.`);
  }
  if (p.todayTotal > 0) parts.push(`${plural(p.todayTotal, "task", "tasks")} today. Start with the one you'd be glad to have done.`);
  else parts.push("Nothing planned yet. Want to note what actually matters today?");

  return { title, body: parts.join(" ") };
}

/**
 * Evening recap with real numbers: how today actually went, with a gentle look
 * to tomorrow. Returns null on an empty day so the caller uses an evergreen line.
 */
export function buildEveningFresh(p: {
  todayDone: number;
  todayTotal: number;
  name?: string;
}): NudgeCopy | null {
  if (p.todayTotal === 0) return null;

  const who = firstName(p.name);
  const title = who ? `Evening, ${who}` : "Evening";

  const left = p.todayTotal - p.todayDone;
  const body =
    left <= 0
      ? `All ${plural(p.todayTotal, "task", "tasks")} done today. That's a good place to stop.`
      : p.todayDone === 0
        ? "Nothing checked off today. Some days go like that. Tomorrow's open."
        : `${p.todayDone} of ${p.todayTotal} done today. That's a fair day's work. Let the rest wait.`;

  return { title, body };
}
