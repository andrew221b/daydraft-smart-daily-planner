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
// We do it on `load` so the SW install doesn't compete with the first
// paint for CPU.
if (
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  import.meta.env.PROD
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.warn("[sw] register failed", e);
    });
  });
}

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
