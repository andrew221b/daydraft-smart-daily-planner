import { type Block, blockSlotEndHHMM } from "@/lib/daydraft";

/**
 * Local block-start reminders.
 *
 * Schedules in-tab Notifications a few minutes before each upcoming block
 * starts. This is intentionally lightweight: it lives only while the tab is
 * open and silently no-ops if permission isn't granted. For "real" pushes
 * even when the app is closed we'd need the existing push_subscriptions /
 * service-worker pipeline (already wired but VAPID-pending).
 *
 * Per-block configuration:
 *   Users can configure reminders Google-Calendar-style — pick lead times
 *   (e.g. 10 min and 2 min before) and a repeat count (re-fire every N min
 *   after the start until acknowledged or count exhausted). Stored in
 *   localStorage keyed by block id, so it survives reloads but stays
 *   on-device (no extra DB column needed).
 */

const TIMEOUT_HANDLES: number[] = [];
const DEFAULT_LEADS_MIN = [2]; // default: a single nudge 2 min before
const DEFAULT_REPEATS = 0;
const REPEAT_INTERVAL_MIN = 5;

export type ReminderConfig = {
  enabled: boolean;
  leadsMin: number[]; // e.g. [10, 2]
  repeats: number; // re-fire N times after start (every 5 min)
  /** Minutes before block end ("window closing"). Empty = off. Default one soft ping. */
  endLeadsMin: number[];
};

const KEY = (blockId: string) => `dd_reminders_${blockId}`;

export const getReminderConfig = (blockId: string): ReminderConfig => {
  if (typeof window === "undefined") return { enabled: true, leadsMin: DEFAULT_LEADS_MIN, repeats: DEFAULT_REPEATS, endLeadsMin: [2] };
  try {
    const raw = localStorage.getItem(KEY(blockId));
    if (!raw) return { enabled: true, leadsMin: DEFAULT_LEADS_MIN, repeats: DEFAULT_REPEATS, endLeadsMin: [2] };
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      leadsMin: Array.isArray(parsed.leadsMin) && parsed.leadsMin.length ? parsed.leadsMin : DEFAULT_LEADS_MIN,
      repeats: typeof parsed.repeats === "number" ? parsed.repeats : DEFAULT_REPEATS,
      endLeadsMin: Array.isArray(parsed.endLeadsMin) ? parsed.endLeadsMin : [2],
    };
  } catch { return { enabled: true, leadsMin: DEFAULT_LEADS_MIN, repeats: DEFAULT_REPEATS, endLeadsMin: [2] }; }
};

export const setReminderConfig = (blockId: string, cfg: ReminderConfig) => {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY(blockId), JSON.stringify(cfg)); } catch {/* ignore */}
};

export const clearScheduledReminders = () => {
  while (TIMEOUT_HANDLES.length) {
    const h = TIMEOUT_HANDLES.pop();
    if (h != null) clearTimeout(h);
  }
};

export const ensureNotificationPermission = async (): Promise<boolean> => {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
};

const fire = (title: string, body: string) => {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      icon: "/placeholder.svg",
      tag: `block-${title}`,
      // `renotify` is not in the standard TS lib type, but supported by most
      // browsers — cast to any so re-firing reminders surface a fresh ping.
      ...({ renotify: true } as any),
    });
  } catch { /* some browsers throw inside iframes */ }
};

/**
 * Schedules reminders for blocks that start later today. Pass `{ planDate }`
 * with the block's date string (yyyy-mm-dd); we only schedule if it's today,
 * because setTimeout can't span hours of background tab time reliably.
 */
export const scheduleBlockReminders = (
  blocks: Block[],
  opts: { planDate: string },
) => {
  clearScheduledReminders();
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (opts.planDate !== ymd) return;
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const now = Date.now();
  blocks.forEach((b: any) => {
    if (b.completed) return;
    if (b.kind !== "task" && b.kind !== "lunch" && b.kind !== "break") {
      // also skip calendar events — the user's calendar handles those.
      if (!b.is_calendar_event) return;
    }
    const cfg = getReminderConfig(b.id);
    if (!cfg.enabled) return;
    const [h, m] = (b.start_time || "00:00").split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const startMs = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, 0).getTime();

    const schedule = (fireAt: number, label: string) => {
      const delay = fireAt - now;
      if (delay <= 0) return;
      if (delay > 6 * 60 * 60_000) return; // setTimeout drift beyond 6h
      const handle = window.setTimeout(() => {
        fire(`Up next: ${b.title}`, label);
      }, delay);
      TIMEOUT_HANDLES.push(handle);
    };

    cfg.leadsMin.forEach((lead) => {
      schedule(startMs - lead * 60_000, `In ${lead} min · ${b.start_time} · ${b.duration_min} min`);
    });
    const [eh, emin] = blockSlotEndHHMM(b as Block).split(":").map(Number);
    const endMs = new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh || 0, emin || 0, 0).getTime();
    (cfg.endLeadsMin ?? [2]).forEach((lead) => {
      if (lead < 0) return;
      const label =
        lead === 0 ? `Ends now · ${b.title}` : `Ends in ${lead} min · ${b.title}`;
      schedule(endMs - lead * 60_000, `${label} · ${fmtEndClock(endMs)}`);
    });
    for (let i = 1; i <= cfg.repeats; i++) {
      schedule(startMs + i * REPEAT_INTERVAL_MIN * 60_000, `Reminder · started at ${b.start_time}`);
    }
  });
};

function fmtEndClock(endMs: number) {
  try {
    const d = new Date(endMs);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
  } catch {
    return "";
  }
}