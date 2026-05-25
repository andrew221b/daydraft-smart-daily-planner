import { Capacitor } from "@capacitor/core";

/**
 * Mark native iOS WebView before React paint so CSS can avoid expensive compositing
 * (blur, heavy backdrop) when quality is "auto". Also set `--safe-area-inset-top`
 * inline on Android, because the CSS-selector route (`html[data-capacitor-android]`)
 * can race with first paint on some devices and leave content jammed under the
 * status bar — the inline style is impossible to miss.
 */
export function applyNativeDocumentHints(): void {
  // Native platforms get a data-attribute + an inline CSS variable for the
  // top safe-area inset. Detection uses BOTH Capacitor.getPlatform() and a
  // userAgent fallback because the Capacitor bridge can be undefined for the
  // first paint on some Android WebView builds.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isAndroid =
    (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") ||
    /Android/i.test(ua);
  const isIOS =
    Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

  if (isIOS) {
    document.documentElement.setAttribute("data-capacitor-ios", "true");
  }
  if (isAndroid) {
    document.documentElement.setAttribute("data-capacitor-android", "true");
    // Inline-style override that wins regardless of whether the
    // [data-capacitor-android] selector resolved in time.
    document.documentElement.style.setProperty("--safe-area-inset-top", "80px");
  }
}

/** Safe-area-friendly status bar when running inside Capacitor (iOS/Android). */
export async function initCapacitor(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  await StatusBar.setOverlaysWebView({ overlay: true });
  await StatusBar.setStyle({ style: Style.Dark });
}
