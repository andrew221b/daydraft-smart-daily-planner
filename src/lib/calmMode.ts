import { useEffect, useState } from "react";

const CALM_MODE_KEY = "dd_calm_mode";
const CALM_MODE_EVENT = "dd-calm-mode";

const readRaw = () => {
  try {
    return localStorage.getItem(CALM_MODE_KEY) === "1";
  } catch {
    return false;
  }
};

export function getCalmMode(): boolean {
  return readRaw();
}

export function setCalmMode(v: boolean): void {
  try {
    localStorage.setItem(CALM_MODE_KEY, v ? "1" : "0");
  } catch {
    // ignore localStorage failures in private mode
  }
  window.dispatchEvent(new Event(CALM_MODE_EVENT));
}

export function useCalmMode(): [boolean, (v: boolean) => void] {
  const [calmMode, setCalmModeState] = useState<boolean>(() => readRaw());

  useEffect(() => {
    const sync = () => setCalmModeState(readRaw());
    window.addEventListener(CALM_MODE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CALM_MODE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return [calmMode, setCalmMode];
}
