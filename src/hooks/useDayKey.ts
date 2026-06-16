import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * A string that changes ONLY when the local calendar day rolls over. Use it as
 * an effect/memo dependency so day-scoped derivations ("today's total", "today's
 * insight") recompute at the correct local midnight — even when the app was
 * suspended across midnight and the usual heartbeats were frozen.
 *
 * Why this exists: iOS freezes JS timers (setInterval) and does NOT reliably
 * fire DOM `visibilitychange` / `window.focus` when a Capacitor app returns from
 * background. The reliable native signal is Capacitor's `appStateChange`
 * (the same one AppLock relies on). We listen to that, plus the DOM events as a
 * web fallback, and re-check the day whenever the app comes back to the
 * foreground.
 *
 * `live` controls whether the day is ALSO re-checked on a foreground interval:
 *   - `false` (default): the key changes only on a foreground *transition*
 *     (resume / refocus / cold start). Right for content you must NOT swap out
 *     from under an actively-engaged user (e.g. the daily insight) — if they sit
 *     in the app across midnight, it waits until the next return to foreground.
 *   - `true`: also ticks a 30s interval while foreground, so a derived counter
 *     (e.g. "tracked today") flips at midnight even with the app open.
 */
const currentDayKey = (): string => new Date().toDateString();

export function useDayKey(opts?: { live?: boolean }): string {
  const live = opts?.live ?? false;
  const [dayKey, setDayKey] = useState(currentDayKey);

  useEffect(() => {
    const check = () => {
      const k = currentDayKey();
      setDayKey((prev) => (prev === k ? prev : k));
    };

    const onVisible = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);

    let interval: ReturnType<typeof setInterval> | undefined;
    if (live) interval = setInterval(check, 30_000);

    // Native resume signal — the reliable one in WKWebView.
    let cancelled = false;
    let removeNative: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void import("@capacitor/app").then(({ App }) => {
        if (cancelled) return;
        void App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) check();
        }).then((handle) => {
          if (cancelled) { void handle.remove(); return; }
          removeNative = () => { void handle.remove(); };
        });
      });
    }

    // A change may have happened between the initial useState and effect setup.
    check();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      if (interval) clearInterval(interval);
      removeNative?.();
    };
  }, [live]);

  return dayKey;
}
