import { Capacitor } from "@capacitor/core";

/**
 * Mark native iOS/Android WebView before React paint and measure the real
 * safe-area-inset-top so CSS var(--safe-area-inset-top) works everywhere.
 *
 * We use a DOM probe element (position:fixed; top:env(safe-area-inset-top))
 * instead of hardcoded values so the result is correct on every device
 * size — notch, Dynamic Island, punch-hole, tall status bar, etc.
 */
export function applyNativeDocumentHints(): void {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isAndroid =
    (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") ||
    /Android/i.test(ua);
  const isIOS =
    Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

  if (isIOS) document.documentElement.setAttribute("data-capacitor-ios", "true");
  if (isAndroid) document.documentElement.setAttribute("data-capacitor-android", "true");

  if (isIOS || isAndroid) {
    // Measure the actual pixel value of env(safe-area-inset-top) by reading
    // getComputedStyle on a probe element. rAF ensures the WKWebView /
    // Android WebView has finished its first geometry + inset pass.
    requestAnimationFrame(() => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;top:env(safe-area-inset-top,0px);pointer-events:none;visibility:hidden;width:0;height:0;";
      document.documentElement.appendChild(probe);
      const measured = parseInt(getComputedStyle(probe).top, 10);
      probe.remove();

      // Fallbacks if the probe returns 0 (env() not yet resolved on first frame).
      // iOS: 44px is the smallest safe area (non-notch models with status bar).
      // Android: 24px is the standard Material status bar height in dp-as-px.
      const fallback = isIOS ? 44 : 24;
      const val = measured > 0 ? measured : fallback;

      document.documentElement.style.setProperty("--safe-area-inset-top", `${val}px`);
    });
  }
}

/** Safe-area-friendly status bar when running inside Capacitor (iOS/Android). */
export async function initCapacitor(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  await StatusBar.setOverlaysWebView({ overlay: true });
  await StatusBar.setStyle({ style: Style.Dark });

  // Keyboard: kill the two big sources of first-tap input lag on iOS WKWebView.
  //
  //   1. setScroll({ isDisabled: true }) — by default WKWebView scrolls the
  //      whole page when an input gains focus, which can take 300–800ms of
  //      main-thread work right when the keyboard is sliding up. Our own
  //      visualViewport handler in src/lib/visualViewport.ts already keeps
  //      the focused area visible via padding, so the built-in scroll is
  //      just wasted work.
  //   2. setAccessoryBarVisible({ isVisible: false }) — drops the
  //      Previous/Next/Done toolbar above the keyboard. That bar has its
  //      own slide-in animation; hiding it makes the keyboard summon
  //      noticeably snappier and frees ~44px of vertical space.
  //
  // Wrapped in try/catch because the plugin is only present on native
  // builds; web bundles import this file too.
  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    if (Capacitor.getPlatform() === "ios") {
      await Keyboard.setScroll({ isDisabled: true });
      await Keyboard.setAccessoryBarVisible({ isVisible: false });
    }
  } catch (e) {
    console.warn("[keyboard] init failed", e);
  }
}
