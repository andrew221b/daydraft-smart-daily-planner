/**
 * Cross-platform haptic feedback.
 *
 * Web: uses navigator.vibrate (Android Chrome supports it; iOS Safari ignores it).
 * Native (Capacitor): when @capacitor/haptics is installed, we'll dynamically import
 * and call the appropriate API. Falls back to web vibration silently.
 *
 * Use these helpers everywhere instead of calling navigator.vibrate directly so
 * we have a single place to wire native APIs when packaging with Capacitor.
 */

type Impact = "light" | "medium" | "heavy";
type Notify = "success" | "warning" | "error";

let cachedNative: any = null;
let nativeChecked = false;

async function getNative() {
  if (nativeChecked) return cachedNative;
  nativeChecked = true;
  try {
    // @ts-ignore — optional dependency, only present in native builds
    const mod = await import("@capacitor/haptics");
    cachedNative = mod;
  } catch {
    cachedNative = null;
  }
  return cachedNative;
}

const webVibrate = (pattern: number | number[]) => {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
};

export const haptics = {
  /** Light tap — buttons, toggles, navigation. */
  tap: () => {
    getNative().then(n => {
      if (n) n.Haptics.impact({ style: n.ImpactStyle.Light }).catch(() => webVibrate(8));
      else webVibrate(8);
    });
  },
  impact: (style: Impact = "medium") => {
    const ms = style === "light" ? 8 : style === "heavy" ? 25 : 14;
    getNative().then(n => {
      if (n) {
        const map = { light: n.ImpactStyle.Light, medium: n.ImpactStyle.Medium, heavy: n.ImpactStyle.Heavy };
        n.Haptics.impact({ style: map[style] }).catch(() => webVibrate(ms));
      } else webVibrate(ms);
    });
  },
  /** Success/warning/error pattern — completion, errors. */
  notify: (type: Notify = "success") => {
    const patterns: Record<Notify, number[]> = {
      success: [10, 40, 18],
      warning: [12, 60, 12],
      error: [20, 50, 20, 50, 20],
    };
    getNative().then(n => {
      if (n) {
        const map = { success: n.NotificationType.Success, warning: n.NotificationType.Warning, error: n.NotificationType.Error };
        n.Haptics.notification({ type: map[type] }).catch(() => webVibrate(patterns[type]));
      } else webVibrate(patterns[type]);
    });
  },
  /** Selection change — picker, segment switch. */
  selection: () => {
    getNative().then(n => {
      if (n) n.Haptics.selectionChanged?.().catch(() => webVibrate(5));
      else webVibrate(5);
    });
  },
};
