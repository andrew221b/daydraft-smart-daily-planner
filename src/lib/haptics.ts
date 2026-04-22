/**
 * Web haptic feedback wrapper using the Vibration API.
 *
 * Android Chrome supports `navigator.vibrate`; iOS Safari ignores it silently.
 * The single entry point makes it trivial to swap in a native implementation
 * later (e.g. when porting to a fully native iOS/Android app).
 */

type Impact = "light" | "medium" | "heavy";
type Notify = "success" | "warning" | "error";

const vibrate = (pattern: number | number[]) => {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
};

export const haptics = {
  /** Light tap — buttons, toggles, navigation. */
  tap: () => vibrate(8),
  impact: (style: Impact = "medium") => {
    const ms = style === "light" ? 8 : style === "heavy" ? 25 : 14;
    vibrate(ms);
  },
  /** Success / warning / error pattern — completion, errors. */
  notify: (type: Notify = "success") => {
    const patterns: Record<Notify, number[]> = {
      success: [10, 40, 18],
      warning: [12, 60, 12],
      error: [20, 50, 20, 50, 20],
    };
    vibrate(patterns[type]);
  },
  /** Selection change — picker, segment switch. */
  selection: () => vibrate(5),
};
