/**
 * TEMPORARY main-thread freeze tracer — used to pinpoint the tab-switch lag.
 *
 * Two signals, both printed to the JS console (visible in Xcode / Safari Web
 * Inspector):
 *   1. A requestAnimationFrame gap detector. If rAF doesn't fire for >120ms the
 *      main thread was blocked — we log the gap length. This works in WKWebView
 *      where the `longtask` PerformanceObserver is unavailable.
 *   2. `ptMark(label)` — timeline marks we sprinkle on the tab-switch path
 *      (tap → route change → tab mount) so a freeze can be attributed to a
 *      specific phase.
 *
 * Remove once the lag is fixed (search for "perfTrace" / "ptMark" / "PT]").
 */
let lastMark = 0;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function ptMark(label: string): void {
  const now = nowMs();
  const delta = lastMark ? now - lastMark : 0;
  lastMark = now;
  // eslint-disable-next-line no-console
  console.log(`[PT] ${label} @${now.toFixed(0)} (+${delta.toFixed(0)}ms since prev mark)`);
}

let started = false;
export function startPerfTrace(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  // rAF-gap freeze detector — the reliable one for WKWebView.
  let prev = nowMs();
  const tick = () => {
    const now = nowMs();
    const gap = now - prev;
    if (gap > 120) {
      // eslint-disable-next-line no-console
      console.log(`[PT] ⛔ FREEZE ${gap.toFixed(0)}ms (main thread blocked) @${now.toFixed(0)}`);
    }
    prev = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // longtask observer too, in case this build supports it (gives finer detail).
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 80) {
          // eslint-disable-next-line no-console
          console.log(`[PT] ⛔ LONGTASK ${entry.duration.toFixed(0)}ms @${entry.startTime.toFixed(0)}`);
        }
      }
    });
    obs.observe({ entryTypes: ["longtask"] });
    // eslint-disable-next-line no-console
    console.log("[PT] tracer active (rAF gap + longtask)");
  } catch {
    // eslint-disable-next-line no-console
    console.log("[PT] tracer active (rAF gap only — no longtask support)");
  }
}
