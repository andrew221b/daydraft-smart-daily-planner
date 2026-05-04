import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyNativeDocumentHints, initCapacitor } from "./lib/capacitor";
import { syncPremiumHtmlAttributes } from "./lib/syncHtmlPreferences";
import { ThemeProvider } from "./lib/theme";

applyNativeDocumentHints();
syncPremiumHtmlAttributes();
void initCapacitor();

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
