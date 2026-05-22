import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Capacitor } from "@capacitor/core";
import { applyNativeDocumentHints, initCapacitor } from "./lib/capacitor";
import { applySavedVisualMode } from "./lib/visualMode";
import { ThemeProvider } from "./lib/theme";
import { RootErrorBoundary } from "@/components/app/RootErrorBoundary";
import { attachVisualViewportInset } from "./lib/visualViewport";
import { markTTI } from "./lib/perfMonitor";
import { startOfflineQueueDrainer } from "./lib/offlineQueue";
import { registerServiceWorker } from "./lib/swUpdate";

try {
  applyNativeDocumentHints();
  applySavedVisualMode();
  attachVisualViewportInset();
  startOfflineQueueDrainer();
} catch (e) {
  console.error("[bootstrap]", e);
}
void initCapacitor();

// Eagerly warm the lazy chunks the user is most likely to hit first.
// On a cold launch from the app icon the user lands on /auth (logged
// out) or /home (logged in). Kicking off these imports here means the
// chunks are already cached by the time the router decides which one to
// render — no spinner-after-splash gap.
void import("./pages/app/Auth");
void import("./pages/app/Home");

/**
 * Hide the native splash screen once React has painted. Without this the
 * splash hangs around for the full `launchShowDuration` (3s) we set in
 * capacitor.config.ts. The 3s is the *failsafe* — if React fails to boot
 * the user still sees the splash auto-dismiss on its own instead of
 * staring at a stuck logo.
 *
 * Strategy: dynamic-import the plugin in parallel with React mount, then
 * wait two animation frames after createRoot has committed before
 * hiding — that guarantees the first React paint has hit the screen.
 */
async function hideSplashAfterRender() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => { /* ignore */ });
      });
    });
  } catch {
    /* plugin unavailable — splash auto-hides via launchShowDuration */
  }
}

// Register the service worker on production web only — Capacitor has its
// own native loader and dev-mode HMR doesn't play nice with SW caching.
// The helper also wires up update detection (shows a toast when a new
// deploy is available so users don't get stuck on old JS).
registerServiceWorker();

// Mark TTI once the first frame after mount has committed.
if (typeof requestIdleCallback === "function") {
  requestIdleCallback(() => markTTI(), { timeout: 2000 });
} else {
  setTimeout(() => markTTI(), 0);
}

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </RootErrorBoundary>
);

// Fire after the synchronous render has been scheduled. The function
// itself does the rAF dance to wait for the first commit before
// tearing down the splash.
void hideSplashAfterRender();
