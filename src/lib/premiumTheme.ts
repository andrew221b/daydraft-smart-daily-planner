import { useEffect, useState } from "react";

export type PremiumTheme = "aurora" | "obsidian" | "neon";

const KEY = "dd_premium_theme";

export function readPremiumTheme(): PremiumTheme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "aurora" || v === "obsidian" || v === "neon") return v;
  } catch {
    // ignore
  }
  return "aurora";
}

export function writePremiumTheme(theme: PremiumTheme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // ignore
  }
  document.documentElement.setAttribute("data-premium-theme", theme);
}

export function usePremiumTheme(): [PremiumTheme, (t: PremiumTheme) => void] {
  const [theme, setTheme] = useState<PremiumTheme>(() => readPremiumTheme());
  useEffect(() => {
    document.documentElement.setAttribute("data-premium-theme", theme);
  }, [theme]);
  const update = (t: PremiumTheme) => {
    setTheme(t);
    writePremiumTheme(t);
  };
  return [theme, update];
}

