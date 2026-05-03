import { Capacitor } from "@capacitor/core";

/** Safe-area-friendly status bar when running inside Capacitor (iOS/Android). */
export async function initCapacitor(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  await StatusBar.setOverlaysWebView({ overlay: true });
  await StatusBar.setStyle({ style: Style.Dark });
}
