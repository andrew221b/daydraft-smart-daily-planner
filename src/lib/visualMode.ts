import { useEffect, useState } from "react";

export type VisualMode = "standard" | "neon";

const KEY = "dd_visual_mode";
const ATTR = "data-visual-mode";

export function readVisualMode(): VisualMode {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "standard" || raw === "neon") return raw;
  } catch {
    // ignore
  }
  return "standard";
}

export function writeVisualMode(mode: VisualMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // ignore
  }
  if (mode === "standard") {
    document.documentElement.removeAttribute(ATTR);
    return;
  }
  document.documentElement.setAttribute(ATTR, mode);
}

export function applySavedVisualMode(): void {
  writeVisualMode(readVisualMode());
}

export function useVisualMode(): [VisualMode, (mode: VisualMode) => void] {
  const [mode, setMode] = useState<VisualMode>(() => readVisualMode());
  useEffect(() => {
    writeVisualMode(mode);
  }, [mode]);
  return [mode, setMode];
}
