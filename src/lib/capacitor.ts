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
}
