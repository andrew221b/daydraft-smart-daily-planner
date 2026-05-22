import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
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
