import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Live Activity bridge — drives the Dynamic Island / Lock Screen widgets.
 *
 * The native side (LiveActivityPlugin.swift) owns all ActivityKit state. This
 * wrapper is a thin, crash-proof facade: every call is a no-op on web and
 * Android, and any native failure is swallowed so a Live Activity hiccup can
 * never break the timer or focus flow it's mirroring.
 *
 * Only ONE activity is ever live — the native layer ends the other type when
 * a new one starts, so callers don't have to coordinate.
 */

interface LiveActivityPlugin {
  isSupported(): Promise<{ supported: boolean; enabled?: boolean; osSupported?: boolean; reason?: string }>;
  startFocus(opts: {
    taskTitle: string;
    plannedMinutes: number;
    blockId: string;
    startedAt: number; // epoch ms
  }): Promise<{ started: boolean; id?: string; reason?: string }>;
  stopFocus(): Promise<void>;
  startTracker(opts: {
    categoryName: string;
    colorHex: string;
    hourlyRate: number; // 0 = no rate
    currencyCode: string;
    startedAt: number; // epoch ms
  }): Promise<{ started: boolean; id?: string; reason?: string }>;
  stopTracker(): Promise<void>;
  stopAll(): Promise<void>;
}

const plugin = registerPlugin<LiveActivityPlugin>("LiveActivity");

/** Live Activities are an iOS 16.1+ feature; everything else is a no-op. */
const isIOS = () => Capacitor.getPlatform() === "ios";

/** Verbose console marker so device logs are easy to filter. */
const tag = "[liveActivity]";

/** Normalise a category colour (hex or anything) to a "#rrggbb" string.
 *  The native parser falls back to the brand blue for unparseable input. */
function toHex(color: string | null | undefined): string {
  if (!color) return "#0A84FF";
  const c = color.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(c)) return c.startsWith("#") ? c : `#${c}`;
  return "#0A84FF";
}

export const liveActivity = {
  /**
   * One-shot health check you can run from the JS console / a debug button:
   *   import { liveActivity } from "@/lib/liveActivity"; liveActivity.diagnose();
   * Prints whether the native plugin is reachable and whether Live Activities
   * are enabled in the user's Settings — the two things that actually break it.
   */
  async diagnose() {
    if (!isIOS()) {
      console.log(`${tag} diagnose: not iOS (platform=${Capacitor.getPlatform()}) — Live Activities are iOS-only.`);
      return { ok: false, reason: "not-ios" };
    }
    if (!Capacitor.isPluginAvailable("LiveActivity")) {
      console.error(`${tag} diagnose: ❌ native plugin "LiveActivity" NOT registered. The Swift class isn't compiled into the app target — clean build folder & rebuild in Xcode.`);
      return { ok: false, reason: "plugin-not-registered" };
    }
    try {
      const res = await plugin.isSupported();
      console.log(`${tag} diagnose: plugin reachable ✅`, res);
      if (!res.osSupported) console.warn(`${tag} diagnose: ⚠️ iOS too old (need 16.1+).`);
      else if (!res.enabled) console.warn(`${tag} diagnose: ⚠️ Live Activities DISABLED in Settings → DayDraft → Live Activities. Turn it ON.`);
      else console.log(`${tag} diagnose: everything ready — start a tracker/focus to see it. 🎉`);
      return { ok: !!res.supported, ...res };
    } catch (e) {
      console.error(`${tag} diagnose: isSupported threw — plugin registered but call failed`, e);
      return { ok: false, reason: "call-failed", error: String(e) };
    }
  },

  async startFocus(opts: { taskTitle: string; plannedMinutes: number; blockId: string; startedAt?: number }) {
    if (!isIOS()) return;
    if (!Capacitor.isPluginAvailable("LiveActivity")) {
      console.error(`${tag} startFocus: native plugin not registered (not compiled into app target).`);
      return;
    }
    try {
      const res = await plugin.startFocus({
        taskTitle: opts.taskTitle || "Focus session",
        plannedMinutes: Math.max(0, Math.round(opts.plannedMinutes || 0)),
        blockId: opts.blockId,
        startedAt: opts.startedAt ?? Date.now(),
      });
      if (res?.started) console.log(`${tag} startFocus ✅ id=${res.id}`);
      else console.warn(`${tag} startFocus did not start — reason: ${res?.reason ?? "unknown"}`);
    } catch (e) {
      console.error(`${tag} startFocus failed`, e);
    }
  },

  async stopFocus() {
    if (!isIOS()) return;
    try {
      await plugin.stopFocus();
    } catch (e) {
      console.warn("[liveActivity] stopFocus failed", e);
    }
  },

  async startTracker(opts: {
    categoryName: string;
    color: string | null | undefined;
    hourlyRate?: number | null;
    currencyCode?: string | null;
    startedAt?: number;
  }) {
    if (!isIOS()) return;
    if (!Capacitor.isPluginAvailable("LiveActivity")) {
      console.error(`${tag} startTracker: native plugin not registered (not compiled into app target).`);
      return;
    }
    try {
      const res = await plugin.startTracker({
        categoryName: opts.categoryName || "Tracking",
        colorHex: toHex(opts.color),
        hourlyRate: Math.max(0, Number(opts.hourlyRate) || 0),
        currencyCode: (opts.currencyCode || "USD").toUpperCase(),
        startedAt: opts.startedAt ?? Date.now(),
      });
      if (res?.started) console.log(`${tag} startTracker ✅ id=${res.id}`);
      else console.warn(`${tag} startTracker did not start — reason: ${res?.reason ?? "unknown"}`);
    } catch (e) {
      console.error(`${tag} startTracker failed`, e);
    }
  },

  async stopTracker() {
    if (!isIOS()) return;
    try {
      await plugin.stopTracker();
    } catch (e) {
      console.warn("[liveActivity] stopTracker failed", e);
    }
  },

  async stopAll() {
    if (!isIOS()) return;
    try {
      await plugin.stopAll();
    } catch (e) {
      console.warn("[liveActivity] stopAll failed", e);
    }
  },
};
