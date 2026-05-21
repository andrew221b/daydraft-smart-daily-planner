/**
 * Haptic feedback wrapper.
 *
 * Priority order:
 *   1. Native iOS / Android via `@capacitor/haptics` when running inside
 *      Capacitor and the plugin is installed (best feel — real Taptic
 *      Engine vibrations).
 *   2. `navigator.vibrate` on Android Chrome / supported browsers.
 *   3. No-op everywhere else (iOS Safari ignores `navigator.vibrate`
 *      silently; doing nothing is the right behaviour there).
 *
 * The Capacitor call is wrapped in a dynamic import that fails closed,
 * so this file builds and runs whether or not `@capacitor/haptics` is
 * in `package.json` yet. Install the plugin (`npm i @capacitor/haptics`
 * + `npx cap sync ios`) to light up real iOS haptics — no code changes
 * needed in callers.
 */

type Impact = "light" | "medium" | "heavy";
type Notify = "success" | "warning" | "error";

// Cached plugin module reference. `undefined` = not yet probed, `null` =
// probed and unavailable, otherwise the live module.
let capPluginCache: { impact: (o: { style: string }) => unknown; notification: (o: { type: string }) => unknown; selection: () => unknown } | null | undefined;

const isNative = (): boolean => {
  try {
    // Avoid a hard import; Capacitor core is always present in this app.
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return !!w.Capacitor?.isNativePlatform?.();
  } catch { return false; }
};

const getCapPlugin = async () => {
  if (capPluginCache !== undefined) return capPluginCache;
  if (!isNative()) { capPluginCache = null; return null; }
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional dependency; resolves only when installed.
    const mod = await import("@capacitor/haptics");
    capPluginCache = (mod?.Haptics as any) || null;
  } catch {
    capPluginCache = null;
  }
  return capPluginCache;
};

const vibrate = (pattern: number | number[]) => {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
};

const fireCapImpact = async (style: Impact) => {
  const p = await getCapPlugin();
  if (!p) return false;
  try {
    const map = { light: "LIGHT", medium: "MEDIUM", heavy: "HEAVY" } as const;
    await p.impact({ style: map[style] });
    return true;
  } catch { return false; }
};

const fireCapNotify = async (type: Notify) => {
  const p = await getCapPlugin();
  if (!p) return false;
  try {
    const map = { success: "SUCCESS", warning: "WARNING", error: "ERROR" } as const;
    await p.notification({ type: map[type] });
    return true;
  } catch { return false; }
};

const fireCapSelection = async () => {
  const p = await getCapPlugin();
  if (!p) return false;
  try { await p.selection(); return true; } catch { return false; }
};

export const haptics = {
  /** Light tap — buttons, toggles, navigation. */
  tap: () => {
    void fireCapImpact("light").then((ok) => { if (!ok) vibrate(8); });
  },
  impact: (style: Impact = "medium") => {
    void fireCapImpact(style).then((ok) => {
      if (ok) return;
      const ms = style === "light" ? 8 : style === "heavy" ? 25 : 14;
      vibrate(ms);
    });
  },
  /** Success / warning / error pattern — completion, errors. */
  notify: (type: Notify = "success") => {
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
    void fireCapSelection().then((ok) => { if (!ok) vibrate(5); });
  },
};
