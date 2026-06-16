import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Capacitor } from "@capacitor/core";
import { applyNativeDocumentHints, initCapacitor } from "./lib/capacitor";
import { installPressFeedback } from "./lib/pressFeedback";
import { ThemeProvider } from "./lib/theme";
import { RootErrorBoundary } from "@/components/app/RootErrorBoundary";
import { initSentry } from "./lib/sentry";
import { attachVisualViewportInset } from "./lib/visualViewport";
import { markTTI } from "./lib/perfMonitor";
import { startOfflineQueueDrainer } from "./lib/offlineQueue";
import { registerServiceWorker } from "./lib/swUpdate";
import { startPerfTrace } from "./lib/perfTrace";

// TEMP: trace main-thread freezes on tab switch.
startPerfTrace();

/* ──────────── Critical-path bootstrap ──────────────────────────────────
 * Only work that affects the very first paint runs synchronously here:
 *   - applyNativeDocumentHints sets DOM attributes that the first
 *     stylesheet pass reads (theme).
 *   - attachVisualViewportInset wires the iOS keyboard listener so the
 *     TabBar gets correct insets on the first frame.
 * Everything else — offline-queue drain, Capacitor SDK init, service
 * worker registration, TTI marker — moves into `requestIdleCallback`
 * below so it never competes with React mount or initial network.
 * ──────────────────────────────────────────────────────────────────── */
try {
  // Sentry first — so any error in the rest of the bootstrap is reported.
  initSentry();
  document.body.addEventListener("touchstart", () => {}, { passive: true });
  applyNativeDocumentHints();
  attachVisualViewportInset();
  installPressFeedback();
} catch (e) {
  console.error("[bootstrap]", e);
}

/*
 * Boot choreography — three things have to happen in the right order
 * before the inline #boot-overlay is allowed to fade:
 *
 *   1. React has committed (so PageFallback / Auth / Home are mounted
 *      underneath, ready to be revealed).
 *   2. The native iOS splash has fully faded out (capacitor.config.ts
 *      sets fadeOutDuration: 400, so we wait that long after calling
 *      .hide()). If we fade the overlay during this window the user
 *      never sees it because the native splash is still covering the
 *      webview — that was the "black → auth → orbital" sequence the
 *      user reported.
 *   3. A minimum visible window has elapsed since first paint, so even
 *      blazingly-fast cold starts give the orbital a chance to register
 *      as motion rather than a one-frame flash.
 *
 * `tryFadeOverlay` checks all three; whichever of them resolves last
 * triggers the fade.
 */
const BOOT_T0 = performance.now();
const NATIVE_SPLASH_FADE_MS = 400; // must match capacitor.config.ts fadeOutDuration
// Minimum time the boot orbital stays visible so it reads as motion rather than
// a one-frame flash. Tuned down from 700ms — 450ms still registers the orbital
// while making launch feel noticeably snappier (the dominant cold-start lever).
const MIN_OVERLAY_VISIBLE_MS = 450;

let splashGone = !Capacitor.isNativePlatform();
let reactCommitted = false;
let overlayFadeTriggered = false;

function tryFadeOverlay(): void {
  if (overlayFadeTriggered) return;
  if (!reactCommitted || !splashGone) return;
  const elapsed = performance.now() - BOOT_T0;
  const wait = Math.max(0, MIN_OVERLAY_VISIBLE_MS - elapsed);
  overlayFadeTriggered = true;
  window.setTimeout(() => {
    document.body.classList.add("app-ready");
    const overlay = document.getElementById("boot-overlay");
    if (overlay) {
      const remove = () => overlay.remove();
      overlay.addEventListener("transitionend", remove, { once: true });
      // Failsafe: if transitionend never fires (reduced motion etc.)
      // drop the node anyway shortly after the fade would have ended.
      window.setTimeout(remove, 600);
    }
  }, wait);
}

if (Capacitor.isNativePlatform()) {
  // Pre-warm the iOS WKWebView TextKit engine while the native splash screen
  // is still covering the app. TextKit initialises lazily on first editable
  // focus, causing a 200-800ms main-thread freeze. Rules for the warmup:
  //   - Element must be IN the viewport (not top:-9999px) — iOS skips TextKit
  //     for out-of-viewport elements.
  //   - opacity must be > 0 (even 0.01 works) — opacity:0 is also skipped.
  //   - fontSize ≥ 16px — prevents iOS from zooming the viewport on focus.
  //   - inputMode "none" — tells iOS not to actually show the keyboard UI
  //     while still triggering the TextKit warm-up path.
  //   - Hold focus for ≥ 250ms — the engine needs time to fully initialise.
  const prewarm = document.createElement("input");
  prewarm.setAttribute("inputmode", "none");
  prewarm.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;font-size:16px;opacity:0.01;pointer-events:none;border:none;outline:none;background:transparent;";
  document.body.appendChild(prewarm);
  prewarm.focus();

  window.setTimeout(() => {
    prewarm.blur();
    prewarm.remove();
    
    void import("@capacitor/splash-screen")
      .then(({ SplashScreen }) => SplashScreen.hide())
      .then(() => {
        // .hide() resolves the moment the fade is initiated, not when it
        // completes. Wait the fadeOutDuration before marking splash gone.
        window.setTimeout(() => {
          splashGone = true;
          tryFadeOverlay();
        }, NATIVE_SPLASH_FADE_MS);
      })
      .catch(() => {
        // Plugin failed to load or hide rejected — fall through so the
        // overlay can still fade and the app isn't stuck behind a splash.
        splashGone = true;
        tryFadeOverlay();
      });
  }, 300);
  // Hard failsafe: if SplashScreen.hide never resolves at all, don't
  // leave the user staring at the boot loader forever.
  window.setTimeout(() => {
    if (!splashGone) {
      splashGone = true;
      tryFadeOverlay();
    }
  }, 2500);
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

whenIdle(() => {
  // Replay any writes queued while offline. Touches IndexedDB + network,
  // so we postpone past first paint.
  try { startOfflineQueueDrainer(); } catch (e) { console.error("[offlineQueue]", e); }
  // Capacitor native shim init — status bar, haptics availability, etc.
  void initCapacitor();
  // RevenueCat (native IAP) — configures once; no-op on web / without keys.
  void import("./lib/revenueCat").then(({ configureRevenueCat }) => configureRevenueCat());
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
 * Mark React as committed. Doesn't fade the overlay directly — that's
 * `tryFadeOverlay` above, which only fires once *all three* gating
 * conditions are satisfied (React committed, native splash gone, min
 * visible window elapsed).
 *
 * Two rAFs because:
 *   - first rAF runs after the synchronous `createRoot().render()` call
 *     queues its work,
 *   - second rAF runs after React commits the initial tree to the DOM
 *     and the browser has had a chance to paint.
 */
function markAppReady() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      reactCommitted = true;
      tryFadeOverlay();
    });
  });
}

markAppReady();
