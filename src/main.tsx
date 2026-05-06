import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyNativeDocumentHints, initCapacitor } from "./lib/capacitor";
import { applySavedVisualMode } from "./lib/visualMode";
import { ThemeProvider } from "./lib/theme";
import { RootErrorBoundary } from "@/components/app/RootErrorBoundary";

try {
  applyNativeDocumentHints();
  applySavedVisualMode();
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
