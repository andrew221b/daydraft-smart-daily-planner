import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Block, parseDateStr } from "./daydraft";

export async function requestLocalNotificationPermissions() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { display } = await LocalNotifications.requestPermissions();
    return display === "granted";
  } catch (e) {
    return false;
  }
}

export async function syncBlockNotifications(dateStr: string, blocks: Block[]) {
  if (!Capacitor.isNativePlatform()) return;
  const { display } = await LocalNotifications.checkPermissions();
  if (display !== "granted") return;

  // Clear existing notifications for this plan/date
  await clearLocalNotifications();

  const toSchedule = [];
  let idCounter = 1;

  for (const b of blocks) {
    if (b.completed || b.resolution || b.is_calendar_event) continue;

    // Build JS Date for start time
    const [hh, mm] = b.start_time.split(":");
    const startDt = parseDateStr(dateStr);
    startDt.setHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
    
    // Only schedule if it's in the future
    if (startDt.getTime() > Date.now()) {
      toSchedule.push({
        id: idCounter++,
        title: `Time for: ${b.title}`,
        body: `Your scheduled block starts now.`,
        schedule: { at: startDt },
        extra: { blockId: b.id }
      });
    }

    if (b.slot_end_time) {
      const [ehh, emm] = b.slot_end_time.split(":");
      const endDt = parseDateStr(dateStr);
      endDt.setHours(parseInt(ehh, 10), parseInt(emm, 10), 0, 0);
      
      if (endDt.getTime() > Date.now()) {
        toSchedule.push({
          id: idCounter++,
          title: `Block ending: ${b.title}`,
          body: `Wrap up what you're doing.`,
          schedule: { at: endDt },
          extra: { blockId: b.id }
        });
      }
    }
  }

  if (toSchedule.length > 0) {
    try {
      await LocalNotifications.schedule({ notifications: toSchedule });
      console.log(`Scheduled ${toSchedule.length} local notifications.`);
    } catch (e) {
      console.error("Failed to schedule local notifications:", e);
    }
  }
}

export async function clearLocalNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }
  } catch (e) {
    // ignore
  }
}
