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

// Respect the OS "Reduce Motion" preference for the crude web vibrate fallback
// (vestibular-sensitive users often want buzzes gone too). Native Taptic Engine
// haptics already honour the iOS system Haptics setting on their own, so this
// only gates the `navigator.vibrate` path.
const prefersReducedMotion = (): boolean => {
  try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; }
  catch { return false; }
};

// Cached plugin module reference. `undefined` = not yet loaded, `null` =
// confirmed web (non-native) environment, otherwise the live module.
// We only permanently cache `null` for web so native retries after a
// transient bridge-not-ready failure instead of locking out forever.
let capPluginCache: {
  impact: (o: { style: string }) => unknown;
  notification: (o: { type: string }) => unknown;
  selectionStart: () => unknown;
  selectionChanged: () => unknown;
  selectionEnd: () => unknown;
} | null | undefined;

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};
const getCapacitor = (): CapacitorGlobal | undefined => {
  try {
    return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  } catch { return undefined; }
};

const isNative = (): boolean => {
  try { return !!getCapacitor()?.isNativePlatform?.(); } catch { return false; }
};

const getCapPlugin = async () => {
  // Fast path: already loaded.
  if (capPluginCache != null) return capPluginCache;
  // Permanent null only for non-native (web / SSR) — no point retrying there.
  if (!isNative()) { capPluginCache = null; return null; }
  // If the plugin isn't registered yet (stale binary / bridge not ready),
  // return null WITHOUT caching so the next call retries.
  const cap = getCapacitor();
  if (cap?.isPluginAvailable && !cap.isPluginAvailable("Haptics")) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional dependency; resolves only when installed.
    const mod = await import("@capacitor/haptics");
    if (mod?.Haptics) capPluginCache = mod.Haptics as typeof capPluginCache;
  } catch {
    // Import failed — don't cache, let next call try again.
  }
  return capPluginCache ?? null;
};

const vibrate = (pattern: number | number[]) => {
  if (prefersReducedMotion()) return;
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
  // The API requires selectionStart → selectionChanged; there is no selection().
  try {
    await p.selectionStart();
    await p.selectionChanged();
    return true;
  } catch { return false; }
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
};
