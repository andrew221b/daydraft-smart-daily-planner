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
  isSupported(): Promise<{ supported: boolean }>;
  startFocus(opts: {
    taskTitle: string;
    plannedMinutes: number;
    blockId: string;
    startedAt: number; // epoch ms
  }): Promise<{ started: boolean; id?: string }>;
  stopFocus(): Promise<void>;
  startTracker(opts: {
    categoryName: string;
    colorHex: string;
    hourlyRate: number; // 0 = no rate
    currencyCode: string;
    startedAt: number; // epoch ms
  }): Promise<{ started: boolean; id?: string }>;
  stopTracker(): Promise<void>;
  stopAll(): Promise<void>;
}

const plugin = registerPlugin<LiveActivityPlugin>("LiveActivity");

/** Live Activities are an iOS 16.1+ feature; everything else is a no-op. */
const isIOS = () => Capacitor.getPlatform() === "ios";

/** Normalise a category colour (hex or anything) to a "#rrggbb" string.
 *  The native parser falls back to the brand blue for unparseable input. */
function toHex(color: string | null | undefined): string {
  if (!color) return "#0A84FF";
  const c = color.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(c)) return c.startsWith("#") ? c : `#${c}`;
  return "#0A84FF";
}

export const liveActivity = {
  async startFocus(opts: { taskTitle: string; plannedMinutes: number; blockId: string; startedAt?: number }) {
    if (!isIOS()) return;
    try {
      await plugin.startFocus({
        taskTitle: opts.taskTitle || "Focus session",
        plannedMinutes: Math.max(0, Math.round(opts.plannedMinutes || 0)),
        blockId: opts.blockId,
        startedAt: opts.startedAt ?? Date.now(),
      });
    } catch (e) {
      console.warn("[liveActivity] startFocus failed", e);
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
    try {
      await plugin.startTracker({
        categoryName: opts.categoryName || "Tracking",
        colorHex: toHex(opts.color),
        hourlyRate: Math.max(0, Number(opts.hourlyRate) || 0),
        currencyCode: (opts.currencyCode || "USD").toUpperCase(),
        startedAt: opts.startedAt ?? Date.now(),
      });
    } catch (e) {
      console.warn("[liveActivity] startTracker failed", e);
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
