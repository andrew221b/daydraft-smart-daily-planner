import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Block, isUserTask, planBlockInstants } from "./daydraft";
import { getReminderConfig } from "./blockReminders";
import { getAssignedCategoryId } from "./blockCategory";
import {
  pickMorningTemplate,
  pickEveningTemplate,
  type NudgeCopy,
} from "./nudgeTemplates";

/**
 * Native scheduled notifications (Capacitor LocalNotifications).
 *
 * This is the *real* notification system — it fires even when the app is fully
 * closed, unlike the foreground-only Web Notification path in `blockReminders`
 * (which now only runs on web).
 *
 * Per task block we schedule, by default, a small, logical set of pings:
 *
 *   1. Lead ping(s)   — `cfg.leadsMin` before start (default 2 min before):
 *                       "Up next: <title>". Carries Done + Start/Track actions.
 *   2. Start ping     — at start_time: "Time for <title>". Done + Start/Track.
 *                       (This doubles as the "the next task just started" cue.)
 *   3. Ending-soon    — `cfg.endAlertLeadMin` before the slot ends (default 5,
 *                       only for tasks ≥ 12 min): "<title> wrapping up". Done.
 *   4. End follow-up  — at slot end: "Did you finish <title>?". Done + Skip.
 *                       Re-synced on every plan change, so a task the user has
 *                       already resolved never gets this ping.
 *
 * Everything respects the per-block ReminderConfig (the Reminders sheet) AND a
 * global master switch (`dd_notifications_enabled`). When the master switch is
 * off, or a block's reminders are disabled, nothing is scheduled.
 *
 * Action buttons (registered once via `registerNotificationActions`):
 *   DD_DONE  → mark the task done in the background
 *   DD_START → open Focus for the task (auto-starts tracking if a category is
 *              assigned — surfaced as a "Track" button in that case)
 *   DD_SKIP  → mark the task skipped
 * Tapping the notification body opens the plan screen.
 */

// ── Action type ids ──────────────────────────────────────────────────────
const ACTION_DONE = "DD_DONE";
const ACTION_START = "DD_START";
const ACTION_SKIP = "DD_SKIP";

const TYPE_START = "DD_TASK_START"; // Done + Start
const TYPE_TRACK = "DD_TASK_TRACK"; // Done + Track (category assigned)
const TYPE_SOON = "DD_TASK_SOON"; // Done only
const TYPE_END = "DD_TASK_END"; // Done + Skip

// iOS pending-notification ceiling is 64, shared across ALL local notifications.
// The daily nudges (≤10) + checklist + focus reminders draw from the same pool,
// so the per-day block pings are capped lower to leave room. The soonest pings
// win, and block pings re-sync constantly, so any overflow self-heals.
const MAX_SCHEDULED = 50;

const MASTER_KEY = "dd_notifications_enabled";

// Android notification channel. On Android 8+ (API 26+) ALL sound + vibration
// behaviour is governed by the CHANNEL, not the per-notification fields — and
// a channel's settings are locked once created. Capacitor's auto-created
// default channel has vibration DISABLED, which is why reminders were silent
// and didn't buzz. We create our own high-importance channel WITH vibration
// and reference it on every scheduled notification (and in the FCM push
// payload's android.notification.channel_id). The "_v2" suffix forces a fresh
// channel so we're not stuck with any previously-created silent one.
const ANDROID_CHANNEL_ID = "dd_reminders_v2";
const isAndroid = () => Capacitor.getPlatform() === "android";

const isNative = () => Capacitor.isNativePlatform();

let channelEnsured = false;

/** Idempotently create the loud, vibrating Android channel. No-op elsewhere. */
export async function ensureNotificationChannel(): Promise<void> {
  if (!isAndroid() || channelEnsured) return;
  try {
    await LocalNotifications.createChannel({
      id: ANDROID_CHANNEL_ID,
      name: "Reminders & nudges",
      description: "Task starts, wrap-ups, and daily nudges",
      importance: 5,      // IMPORTANCE_HIGH → heads-up banner + sound
      visibility: 1,      // VISIBILITY_PUBLIC on the lock screen
      vibration: true,    // ← the missing piece; default channel had it off
      lights: true,
      // sound omitted ⇒ the channel keeps the system default notification tone
    });
    channelEnsured = true;
  } catch (e) {
    console.warn("[localNotifications] createChannel failed", e);
  }
}

// ── Master switch ──────────────────────────────────────────────────────────

/** Global "all notifications" toggle. Defaults ON unless explicitly disabled. */
export function getNotificationsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(MASTER_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setNotificationsEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MASTER_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// Daily nudges (morning/evening) are an INDEPENDENT switch from per-task
// reminders — its own key so turning task reminders off never silences the
// daily brief, and vice-versa. Defaults ON unless explicitly disabled.
const DAILY_NUDGES_KEY = "dd_daily_nudges_enabled";

export function getDailyNudgesEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(DAILY_NUDGES_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setDailyNudgesEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DAILY_NUDGES_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// ── Permissions ──────────────────────────────────────────────────────────

export async function requestLocalNotificationPermissions(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { display } = await LocalNotifications.requestPermissions();
    return display === "granted";
  } catch {
    return false;
  }
}

// ── Action registration ────────────────────────────────────────────────────

let actionsRegistered = false;

export async function registerNotificationActions(): Promise<void> {
  if (!isNative() || actionsRegistered) return;
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: TYPE_START,
          actions: [
            { id: ACTION_DONE, title: "✓ Done", foreground: true },
            { id: ACTION_START, title: "Start", foreground: true },
          ],
        },
        {
          id: TYPE_TRACK,
          actions: [
            { id: ACTION_DONE, title: "✓ Done", foreground: true },
            { id: ACTION_START, title: "Track", foreground: true },
          ],
        },
        {
          id: TYPE_SOON,
          actions: [{ id: ACTION_DONE, title: "✓ Mark done", foreground: true }],
        },
        {
          id: TYPE_END,
          actions: [
            { id: ACTION_DONE, title: "✓ Done", foreground: true },
            { id: ACTION_SKIP, title: "Skip", destructive: true, foreground: true },
          ],
        },
      ],
    });
    actionsRegistered = true;
  } catch (e) {
    console.warn("[localNotifications] registerActionTypes failed", e);
  }
}

// ── Action listener ──────────────────────────────────────────────────────

export type NotifActionHandlers = {
  /** Navigate the in-app router to a path (body tap → plan, Start → focus). */
  onNavigate: (path: string) => void;
  /** Mark a task done in the background. `date` is the plan day (yyyy-mm-dd). */
  onComplete: (blockId: string, date?: string) => void;
  /** Mark a task skipped in the background. */
  onSkip: (blockId: string, date?: string) => void;
};

export async function attachNotificationActionListener(
  handlers: NotifActionHandlers,
): Promise<() => void> {
  if (!isNative()) return () => {};
  try {
    const handle = await LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (event) => {
        const actionId = event.actionId;
        const extra = event.notification?.extra as
          | { blockId?: string; date?: string; path?: string }
          | undefined;
        const blockId = extra?.blockId;
        const date = extra?.date;
        // `tap` is the body tap (no action button). Daily nudges carry their own
        // deep-link target in `extra.path`; task pings fall back to the plan.
        if (actionId === "tap") {
          handlers.onNavigate(extra?.path || "/today/plan");
          return;
        }
        if (!blockId) return;
        if (actionId === ACTION_DONE) handlers.onComplete(blockId, date);
        else if (actionId === ACTION_SKIP) handlers.onSkip(blockId, date);
        else if (actionId === ACTION_START) handlers.onNavigate(`/focus/${blockId}`);
      },
    );
    return () => {
      void Promise.resolve(handle).then((h) => h.remove());
    };
  } catch (e) {
    console.warn("[localNotifications] attach listener failed", e);
    return () => {};
  }
}

// ── Scheduling ─────────────────────────────────────────────────────────────

type Candidate = {
  at: Date;
  title: string;
  body: string;
  actionTypeId: string;
  blockId: string;
};

export async function syncBlockNotifications(dateStr: string, blocks: Block[]) {
  if (!isNative()) return;

  // Master switch off → clear our task pings and bail. Scoped to block pings so
  // the independent daily nudges / checklist / focus reminders are untouched.
  if (!getNotificationsEnabled()) {
    await clearBlockNotifications();
    return;
  }

  const { display } = await LocalNotifications.checkPermissions();
  if (display !== "granted") return;

  // Guarantee the action groups AND the loud vibrating channel exist before
  // we schedule anything that references them (both idempotent).
  await registerNotificationActions();
  await ensureNotificationChannel();

  // Full resync: cancel our block pings, then reschedule from scratch. This is
  // what makes the "only ping if still unresolved" guarantee work — a task the
  // user completed simply isn't re-added below. Scoped to block pings so a plan
  // edit never wipes the daily nudges / checklist / focus reminders.
  await clearBlockNotifications();

  const now = Date.now();
  const candidates: Candidate[] = [];
  // Cross-midnight aware instants: a task packed past midnight schedules its
  // pings for the real next-day time instead of this morning (which would be in
  // the past and silently dropped).
  const instants = planBlockInstants(dateStr, blocks);

  for (const b of blocks) {
    // Only actionable user tasks. Skip calendar events and resolved tasks.
    if (!isUserTask(b) || b.is_calendar_event) continue;
    if (b.completed || (b as Block & { resolution?: string | null }).resolution) continue;

    const cfg = getReminderConfig(b.id);
    if (!cfg.enabled) continue;

    const inst = instants.get(b.id);
    if (!inst) continue;
    const startAt = new Date(inst.startMs);
    const endAt = new Date(inst.endMs);

    const hasCategory = !!getAssignedCategoryId(b.id);
    const startType = hasCategory ? TYPE_TRACK : TYPE_START;
    const dur = b.duration_min || 0;

    // 1. Lead ping(s) before start
    for (const lead of cfg.leadsMin || []) {
      const at = new Date(startAt.getTime() - lead * 60_000);
      if (at.getTime() > now) {
        candidates.push({
          at,
          title: `Up next: ${b.title}`,
          body: lead <= 2 ? `Starting at ${b.start_time}.` : `Starts at ${b.start_time} — ${lead} min away.`,
          actionTypeId: startType,
          blockId: b.id,
        });
      }
    }

    // 2. Start ping
    if (startAt.getTime() > now) {
      candidates.push({
        at: startAt,
        title: `Starting now: ${b.title}`,
        body: hasCategory ? "Tap Track to begin timing." : "Open the app to get started.",
        actionTypeId: startType,
        blockId: b.id,
      });
    }

    // Frameless tasks (duration 0) have no end — skip every end-of-block ping.
    // The lead + start pings above still fire, so the user is notified BEFORE
    // the task starts; there's just no "task ended" follow-up.
    if (endAt && dur > 0) {
      // 3. Ending-soon ping (only meaningful for longer tasks; opt-in via endAlertLeadMin > 0)
      const lead = typeof cfg.endAlertLeadMin === "number" ? cfg.endAlertLeadMin : 0;
      if (dur >= 12 && lead > 0) {
        const at = new Date(endAt.getTime() - lead * 60_000);
        if (at.getTime() > now && at.getTime() > startAt.getTime()) {
          candidates.push({
            at,
            title: `${b.title} — almost done`,
            body: `${lead} min left in this block.`,
            actionTypeId: TYPE_SOON,
            blockId: b.id,
          });
        }
      }

      // 4. End follow-up — opt-in only (cfg.endFollowUp must be true)
      if (endAt.getTime() > now && cfg.endFollowUp) {
        candidates.push({
          at: endAt,
          title: `How did ${b.title} go?`,
          body: "Mark done or skip — tap an action.",
          actionTypeId: TYPE_END,
          blockId: b.id,
        });
      }
    }
  }

  if (candidates.length === 0) return;

  // Sort chronologically and cap below the iOS 64-pending ceiling.
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  const capped = candidates.slice(0, MAX_SCHEDULED);

  // Stable, deterministic ids derived from the ping's identity (block + action
  // + time) instead of array position. A reschedule re-derives the same id for
  // the same logical ping, so a stale pending notification can never collapse
  // onto — or be mistaken for — a different block's ping. (Java int range.)
  const usedIds = new Set<number>();
  const stableNotifId = (key: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    let id = ((h >>> 0) % 2_000_000_000) || 1;
    while (usedIds.has(id)) id = (id % 2_000_000_000) + 1; // probe collisions
    usedIds.add(id);
    return id;
  };

  const notifications = capped.map((c) => ({
    id: stableNotifId(`${c.blockId}:${c.actionTypeId}:${c.at.getTime()}`),
    title: c.title,
    body: c.body,
    // iOS: pass "default" — the plugin calls UNNotificationSound(named: "default").
    // When "default.caf" isn't in the bundle, iOS falls back to the system default
    // notification chime. Omitting sound (or passing "") produces silence because
    // the plugin only calls content.sound when the field is a non-empty string.
    // Android: channelId governs all sound + vibration; this field is ignored there.
    sound: "default",
    channelId: ANDROID_CHANNEL_ID,
    schedule: { at: c.at },
    actionTypeId: c.actionTypeId,
    extra: { blockId: c.blockId, date: dateStr },
  }));

  try {
    await LocalNotifications.schedule({ notifications });
  } catch (e) {
    console.error("[localNotifications] schedule failed", e);
  }
}

/** Global nuke — cancels EVERY pending notification. For logout / hard reset. */
export async function clearLocalNotifications() {
  if (!isNative()) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }
  } catch {
    /* ignore */
  }
}

/**
 * Cancel only the per-task BLOCK pings (those carry `extra.blockId`), leaving
 * the independent reminders — daily nudges, checklist, focus overtime — alone.
 * Used by the block resync so a plan edit doesn't collateral-cancel them.
 */
async function clearBlockNotifications() {
  if (!isNative()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const mine = pending.notifications.filter(
      (n) => !!(n.extra as { blockId?: string } | undefined)?.blockId,
    );
    if (mine.length > 0) await LocalNotifications.cancel({ notifications: mine });
  } catch {
    /* ignore */
  }
}

// ── Checklist mode reminder ───────────────────────────────────────────────
// A single evening nudge when a day's checklist still has unchecked items.
// Fully independent of the per-block plan reminders above: one fixed id (well
// outside the block-hash id space), rescheduled from scratch on every change.
// Local only — no server push needed (and none of the block actions apply).
const CHECKLIST_NOTIF_ID = 920001;

export async function scheduleChecklistReminder(
  items: { done: boolean; title: string }[],
  planDate: string,
  eveningNudgeTime?: string,
): Promise<void> {
  if (!isNative()) return;
  // Always clear the previous one first so we never stack duplicates.
  await cancelChecklistReminder();
  if (!getNotificationsEnabled()) return;

  const unchecked = items.filter((i) => !i.done);
  if (unchecked.length === 0) return;

  const time = /^\d{2}:\d{2}$/.test(eveningNudgeTime ?? "") ? (eveningNudgeTime as string) : "20:00";
  const [y, m, d] = planDate.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  if (!y || !m || !d) return;
  const at = new Date(y, m - 1, d, h, min, 0, 0);
  if (at.getTime() <= Date.now()) return; // time already passed today / past day

  const first = unchecked[0].title;
  const body =
    unchecked.length === 1
      ? `“${first}” is still unchecked`
      : `${unchecked.length} items still unchecked — starting with “${first}”`;

  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: CHECKLIST_NOTIF_ID,
          title: "Checklist",
          body,
          sound: "default",
          channelId: ANDROID_CHANNEL_ID,
          schedule: { at },
          extra: { checklist: true, date: planDate },
        },
      ],
    });
  } catch (e) {
    console.error("[localNotifications] checklist reminder schedule failed", e);
  }
}

export async function cancelChecklistReminder(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: CHECKLIST_NOTIF_ID }] });
  } catch {
    /* ignore */
  }
}

// ── Focus overtime reminder ───────────────────────────────────────────────
// A single local notification fires at the exact moment the planned duration
// ends. Scheduled when Focus arms, cancelled on any completion path (done /
// skip / cancel). ID 920002 stays outside the block-hash space.
const FOCUS_OVERTIME_NOTIF_ID = 920002;

export async function scheduleFocusOvertimeReminder(
  taskTitle: string,
  plannedMinutes: number,
  startedAtMs: number,
): Promise<void> {
  if (!isNative()) return;
  await cancelFocusOvertimeReminder();
  if (!getNotificationsEnabled()) return;
  if (plannedMinutes <= 0) return;

  const at = new Date(startedAtMs + plannedMinutes * 60 * 1000);
  if (at.getTime() <= Date.now()) return;

  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: FOCUS_OVERTIME_NOTIF_ID,
          title: "⏰ Time's up",
          body: `"${taskTitle}" — planned time is up. Wrap up when ready.`,
          sound: "default",
          channelId: ANDROID_CHANNEL_ID,
          schedule: { at },
          extra: { focusOvertime: true },
        },
      ],
    });
  } catch (e) {
    console.error("[localNotifications] focus overtime schedule failed", e);
  }
}

export async function cancelFocusOvertimeReminder(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: FOCUS_OVERTIME_NOTIF_ID }] });
  } catch {
    /* ignore */
  }
}

// ── Daily nudges (morning brief + evening recap) ───────────────────────────
// TWO on-device pings per day, scheduled in advance across a horizon, each at a
// user-set local time (Settings → Daily nudges; defaults 08:00 / 20:00). The
// morning brief deep-links to the plan, the evening recap to reports. TODAY's
// slots can carry real numbers (`morningFresh` / `eveningFresh`); future days
// use the evergreen pools as a buffer so pings keep landing without opening the
// app. Re-run on every app open to refresh copy and roll the horizon forward.
// Own reserved id space (morning = base+offset*2, evening = base+offset*2+1) +
// an `extra.dailyNudge` tag so the block resync never touches them.

const DAILY_NUDGE_ID_BASE = 921000;
const DAILY_NUDGE_HORIZON_DAYS = 5;
// Legacy id from the old three-stream version (a separate smart nudge). Cancelled
// alongside the daily ids so devices upgrading don't keep a stale ping.
const LEGACY_SMART_NUDGE_ID = 922000;

const parseHHMM = (s: string | undefined, fallback: [number, number]): [number, number] => {
  if (s && /^\d{2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(":").map(Number);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) return [h, m];
  }
  return fallback;
};

const localDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type DailyNudgeOptions = {
  /** "HH:MM" local — morning brief time (default 08:00). */
  morningTime?: string;
  /** "HH:MM" local — evening recap time (default 20:00). */
  eveningTime?: string;
  /** Real-number morning copy for TODAY only. null/undefined ⇒ evergreen line. */
  morningFresh?: NudgeCopy | null;
  /** Real-number evening copy for TODAY only. null/undefined ⇒ evergreen line. */
  eveningFresh?: NudgeCopy | null;
};

export async function cancelDailyNudges(): Promise<void> {
  if (!isNative()) return;
  const ids: { id: number }[] = [{ id: LEGACY_SMART_NUDGE_ID }];
  // Morning + evening ids span base..base+HORIZON*2-1 — clear the whole range so
  // a re-sync never stacks up and upgrading devices drop any stale ping.
  for (let i = 0; i < DAILY_NUDGE_HORIZON_DAYS * 2; i++) ids.push({ id: DAILY_NUDGE_ID_BASE + i });
  try {
    await LocalNotifications.cancel({ notifications: ids });
  } catch {
    /* ignore */
  }
}

export async function syncDailyNudges(opts: DailyNudgeOptions = {}): Promise<void> {
  if (!isNative()) return;
  // Always clear the prior horizon (and legacy ids) first so we never stack up.
  await cancelDailyNudges();
  if (!getDailyNudgesEnabled()) return;

  const { display } = await LocalNotifications.checkPermissions();
  if (display !== "granted") return;
  await ensureNotificationChannel();

  const [mh, mm] = parseHHMM(opts.morningTime, [8, 0]);
  const [eh, em] = parseHHMM(opts.eveningTime, [20, 0]);
  const now = Date.now();

  type Pending = { id: number; at: Date; copy: NudgeCopy; path: string };
  const pending: Pending[] = [];

  for (let offset = 0; offset < DAILY_NUDGE_HORIZON_DAYS; offset++) {
    const day = new Date();
    day.setDate(day.getDate() + offset);
    const ds = localDateStr(day);

    // Morning brief → the plan.
    const mAt = new Date(day);
    mAt.setHours(mh, mm, 0, 0);
    if (mAt.getTime() > now) {
      const fresh = offset === 0 ? opts.morningFresh : null;
      pending.push({
        id: DAILY_NUDGE_ID_BASE + offset * 2,
        at: mAt,
        copy: fresh ?? pickMorningTemplate(ds),
        path: "/today/plan",
      });
    }

    // Evening recap → reports.
    const eAt = new Date(day);
    eAt.setHours(eh, em, 0, 0);
    if (eAt.getTime() > now) {
      const fresh = offset === 0 ? opts.eveningFresh : null;
      pending.push({
        id: DAILY_NUDGE_ID_BASE + offset * 2 + 1,
        at: eAt,
        copy: fresh ?? pickEveningTemplate(ds),
        path: "/reports",
      });
    }
  }

  if (pending.length === 0) return;

  const notifications = pending.map((p) => ({
    id: p.id,
    title: p.copy.title,
    body: p.copy.body,
    sound: "default",
    channelId: ANDROID_CHANNEL_ID,
    schedule: { at: p.at },
    extra: { dailyNudge: true, path: p.path },
  }));

  try {
    await LocalNotifications.schedule({ notifications });
  } catch (e) {
    console.error("[localNotifications] daily nudge schedule failed", e);
  }
}
