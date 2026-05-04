import { Capacitor } from "@capacitor/core";

/**
 * Mark native iOS WebView before React paint so CSS can avoid expensive compositing
 * (blur, heavy backdrop) when quality is "auto".
 */
export function applyNativeDocumentHints(): void {
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() === "ios") {
    document.documentElement.setAttribute("data-capacitor-ios", "true");
  }
}

/** Safe-area-friendly status bar when running inside Capacitor (iOS/Android). */
export async function initCapacitor(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  await StatusBar.setOverlaysWebView({ overlay: true });
  await StatusBar.setStyle({ style: Style.Dark });
}
