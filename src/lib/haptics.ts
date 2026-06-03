/**
 * Haptic feedback wrapper.
 *
 * Priority order:
 *   1. Native iOS / Android via `@capacitor/haptics` when running inside
 *      Capacitor (best feel — real Taptic Engine / Vibrator).
 *   2. `navigator.vibrate` on Android Chrome / supported browsers.
 *   3. No-op everywhere else (iOS Safari ignores `navigator.vibrate`
 *      silently; doing nothing is the right behaviour there).
 *
 * IMPORTANT — why this is a STATIC import (not a lazy `import()`):
 * `@capacitor/haptics` is a hard dependency. Importing it at module load
 * guarantees the plugin REGISTERS with the Capacitor bridge and is bundled
 * into the main chunk. The previous lazy-import version could fail to load
 * the chunk (or read `window.Capacitor` before the bridge attached) and then
 * permanently cache `null` — on iOS that means ZERO feedback forever, because
 * the `navigator.vibrate` fallback is a no-op there. Matching the rest of the
 * app (which all use `Capacitor.isNativePlatform()`) removes that whole class
 * of failure.
 */

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

type Impact = "light" | "medium" | "heavy";
type Notify = "success" | "warning" | "error";

// ── User preference: global haptics toggle ──────────────────────────────────
// Defaults ON. Mirrors the notifications master switch pattern. When off, every
// haptic below is a no-op so people who dislike vibration can silence the whole
// app from Settings. Read synchronously so the gate adds no latency to a tap.
const HAPTICS_KEY = "dd_haptics_enabled";

export function getHapticsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try { return localStorage.getItem(HAPTICS_KEY) !== "0"; } catch { return true; }
}

export function setHapticsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(HAPTICS_KEY, enabled ? "1" : "0"); } catch { /* ignore */ }
}

/** True only inside a Capacitor native shell. Same check the rest of the app uses. */
const isNative = (): boolean => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

// Respect the OS "Reduce Motion" preference for the crude web vibrate fallback
// (vestibular-sensitive users often want buzzes gone too). Native Taptic Engine
// haptics already honour the iOS system Haptics setting on their own, so this
// only gates the `navigator.vibrate` path.
const prefersReducedMotion = (): boolean => {
  try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; }
  catch { return false; }
};

const vibrate = (pattern: number | number[]) => {
  if (prefersReducedMotion()) return;
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
};

const IMPACT_STYLE: Record<Impact, ImpactStyle> = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy,
};
const NOTIFY_TYPE: Record<Notify, NotificationType> = {
  success: NotificationType.Success,
  warning: NotificationType.Warning,
  error: NotificationType.Error,
};

const fireCapImpact = async (style: Impact): Promise<boolean> => {
  if (!isNative()) return false;
  try {
    await Haptics.impact({ style: IMPACT_STYLE[style] });
    return true;
  } catch (e) {
    console.warn("[haptics] impact failed", e);
    return false;
  }
};

const fireCapNotify = async (type: Notify): Promise<boolean> => {
  if (!isNative()) return false;
  try {
    await Haptics.notification({ type: NOTIFY_TYPE[type] });
    return true;
  } catch (e) {
    console.warn("[haptics] notification failed", e);
    return false;
  }
};

const fireCapSelection = async (): Promise<boolean> => {
  if (!isNative()) return false;
  // The API requires selectionStart → selectionChanged; there is no selection().
  try {
    await Haptics.selectionStart();
    await Haptics.selectionChanged();
    return true;
  } catch (e) {
    console.warn("[haptics] selection failed", e);
    return false;
  }
};

export const haptics = {
  /** Light tap — buttons, toggles, navigation. */
  tap: () => {
    if (!getHapticsEnabled()) return;
    void fireCapImpact("light").then((ok) => { if (!ok) vibrate(8); });
  },
  impact: (style: Impact = "medium") => {
    if (!getHapticsEnabled()) return;
    void fireCapImpact(style).then((ok) => {
      if (ok) return;
      const ms = style === "light" ? 8 : style === "heavy" ? 25 : 14;
      vibrate(ms);
    });
  },
  /** Success / warning / error pattern — completion, errors. */
  notify: (type: Notify = "success") => {
    if (!getHapticsEnabled()) return;
    void fireCapNotify(type).then((ok) => {
      if (ok) return;
      const patterns: Record<Notify, number[]> = {
        success: [10, 40, 18],
        warning: [12, 60, 12],
        error: [20, 50, 20, 50, 20],
      };
      vibrate(patterns[type]);
    });
  },
  /** Selection change — picker, segment switch. */
  selection: () => {
    if (!getHapticsEnabled()) return;
    void fireCapSelection().then((ok) => { if (!ok) vibrate(5); });
  },

  /**
   * On-device self-test. Fires a clearly-noticeable MEDIUM impact regardless of
   * the in-app toggle and returns a verdict you can read from the JS console or
   * surface in the UI. Use this to settle "is it the code or the phone?":
   *   • returns { ok:false, reason:"not-native" } → running as web/PWA.
   *   • returns { ok:false, reason:"plugin-unavailable" } → the native Haptics
   *     plugin isn't compiled into this build (clean build folder & rebuild).
   *   • returns { ok:true } but you feel NOTHING → it's the device:
   *     iOS  → Settings ▸ Sounds & Haptics ▸ "System Haptics" must be ON
   *            (and the device must not be in Low Power Mode).
   *     Android → enable "Touch vibration"/"Haptic feedback" in system settings.
   */
  async test(): Promise<{ ok: boolean; platform: string; reason?: string }> {
    const platform = Capacitor.getPlatform();
    if (!isNative()) {
      console.warn(`[haptics] test: not native (platform=${platform}) — native haptics are unavailable on web.`);
      return { ok: false, platform, reason: "not-native" };
    }
    if (Capacitor.isPluginAvailable && !Capacitor.isPluginAvailable("Haptics")) {
      console.error(`[haptics] test: ❌ "Haptics" plugin NOT registered — it isn't compiled into the app target. Clean build folder & rebuild.`);
      return { ok: false, platform, reason: "plugin-unavailable" };
    }
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
      console.log(`[haptics] test: ✅ impact fired on ${platform}. If you felt nothing, the OS is suppressing it — iOS: Settings ▸ Sounds & Haptics ▸ System Haptics = ON (and disable Low Power Mode); Android: enable system Haptic/Touch vibration.`);
      return { ok: true, platform };
    } catch (e) {
      console.error(`[haptics] test: impact threw on ${platform}`, e);
      return { ok: false, platform, reason: String(e) };
    }
  },
};
