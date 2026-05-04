import { useEffect, useState } from "react";

export type PremiumQuality = "auto" | "performance" | "premium";

const KEY = "dd_premium_quality";

export function readPremiumQuality(): PremiumQuality {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "auto" || v === "performance" || v === "premium") return v;
  } catch {
    // ignore
  }
  return "auto";
}

export function writePremiumQuality(quality: PremiumQuality): void {
  try {
    localStorage.setItem(KEY, quality);
  } catch {
    // ignore
  }
  if (quality === "auto") {
    document.documentElement.removeAttribute("data-premium-quality");
    return;
  }
  document.documentElement.setAttribute("data-premium-quality", quality);
}

export function usePremiumQuality(): [PremiumQuality, (q: PremiumQuality) => void] {
  const [quality, setQuality] = useState<PremiumQuality>(() => readPremiumQuality());

  useEffect(() => {
    if (quality === "auto") {
      document.documentElement.removeAttribute("data-premium-quality");
      return;
    }
    document.documentElement.setAttribute("data-premium-quality", quality);
  }, [quality]);

  const update = (q: PremiumQuality) => {
    setQuality(q);
    writePremiumQuality(q);
  };

  return [quality, update];
}
