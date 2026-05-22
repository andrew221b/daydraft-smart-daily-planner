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

/* ──────────── Critical-path bootstrap ──────────────────────────────────
 * Only work that affects the very first paint runs synchronously here:
 *   - applyNativeDocumentHints / applySavedVisualMode set DOM attributes
 *     that the first stylesheet pass reads (theme + visual mode).
 *   - attachVisualViewportInset wires the iOS keyboard listener so the
 *     TabBar gets correct insets on the first frame.
 * Everything else — offline-queue drain, Capacitor SDK init, service
 * worker registration, TTI marker — moves into `requestIdleCallback`
 * below so it never competes with React mount or initial network.
 * ──────────────────────────────────────────────────────────────────── */
try {
  applyNativeDocumentHints();
  applySavedVisualMode();
  attachVisualViewportInset();
} catch (e) {
  console.error("[bootstrap]", e);
}

function whenIdle(fn: () => void) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(fn, { timeout: 2000 });
  } else {
    setTimeout(fn, 0);
  }
}

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

whenIdle(() => {
  // Replay any writes queued while offline. Touches IndexedDB + network,
  // so we postpone past first paint.
  try { startOfflineQueueDrainer(); } catch (e) { console.error("[offlineQueue]", e); }
  // Capacitor native shim init — status bar, haptics availability, etc.
  void initCapacitor();
  // Service worker registration (web only — no-ops on Capacitor native).
  registerServiceWorker();
  // Time-to-interactive marker for the perf debug panel.
  markTTI();
});

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </RootErrorBoundary>
);

/**
 * Mark the document as "ready" once React's first paint commits. The
 * inline #boot-wordmark in index.html watches for `body.app-ready` and
 * fades to opacity 0; after the fade transition completes we remove the
 * element from the DOM so it can never intercept clicks.
 *
 * Two rAFs because:
 *   - first rAF runs after the synchronous `createRoot().render()` call
 *     queues its work,
 *   - second rAF runs after React commits the initial tree to the DOM
 *     and the browser has had a chance to paint.
 * Adding the class earlier than this would cross-fade against an empty
 * body, which is what the wordmark is supposed to hide.
 */
function markAppReady() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.add("app-ready");
      const wm = document.getElementById("boot-wordmark");
      if (wm) {
        const remove = () => wm.remove();
        wm.addEventListener("transitionend", remove, { once: true });
        // Safety net — if the transitionend never fires (e.g. reduced
        // motion disables transitions), drop the node after the fade
        // would have completed anyway.
        setTimeout(remove, 600);
      }
    });
  });
}

markAppReady();

// Fire after the synchronous render has been scheduled. The function
// itself does the rAF dance to wait for the first commit before
// tearing down the splash.
void hideSplashAfterRender();
