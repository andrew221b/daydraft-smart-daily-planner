import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyNativeDocumentHints, initCapacitor } from "./lib/capacitor";
import { syncPremiumHtmlAttributes } from "./lib/syncHtmlPreferences";
import { ThemeProvider } from "./lib/theme";
import { RootErrorBoundary } from "@/components/app/RootErrorBoundary";

try {
  applyNativeDocumentHints();
  syncPremiumHtmlAttributes();
} catch (e) {
  console.error("[bootstrap]", e);
}
void initCapacitor();

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </RootErrorBoundary>
);
