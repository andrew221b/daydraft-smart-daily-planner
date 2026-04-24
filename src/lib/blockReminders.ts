import type { Block } from "@/lib/daydraft";

/**
 * Local block-start reminders.
 *
 * Schedules in-tab Notifications a few minutes before each upcoming block
 * starts. This is intentionally lightweight: it lives only while the tab is
 * open and silently no-ops if permission isn't granted. For "real" pushes
 * even when the app is closed we'd need the existing push_subscriptions /
 * service-worker pipeline (already wired but VAPID-pending).
 */

const TIMEOUT_HANDLES: number[] = [];
const LEAD_MIN = 2; // notify N minutes before start

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
      tag: `block-${title}-${body}`,
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
  blocks.forEach((b) => {
    if (b.completed) return;
    if (b.kind !== "task" && b.kind !== "lunch" && b.kind !== "break") {
      // also skip calendar events — the user's calendar handles those.
      if (!b.is_calendar_event) return;
    }
    const [h, m] = (b.start_time || "00:00").split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const startMs = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, 0).getTime();
    const fireAt = startMs - LEAD_MIN * 60_000;
    const delay = fireAt - now;
    if (delay <= 0) return; // already past
    if (delay > 6 * 60 * 60_000) return; // beyond 6h: don't trust the timer
    const handle = window.setTimeout(() => {
      fire(`Up next: ${b.title}`, `Starts at ${b.start_time} · ${b.duration_min} min`);
    }, delay);
    TIMEOUT_HANDLES.push(handle);
  });
};