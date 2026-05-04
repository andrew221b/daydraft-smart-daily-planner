import { readPremiumTheme } from "@/lib/premiumTheme";
import { readPremiumQuality } from "@/lib/premiumQuality";

/** Apply saved theme/quality to `<html>` before first paint (avoids WKWebView style flash). */
export function syncPremiumHtmlAttributes(): void {
  try {
    document.documentElement.setAttribute("data-premium-theme", readPremiumTheme());
    const q = readPremiumQuality();
    if (q === "auto") document.documentElement.removeAttribute("data-premium-quality");
    else document.documentElement.setAttribute("data-premium-quality", q);
  } catch {
    /* localStorage unavailable */
  }
}
