/** Local-only flag so dev builds can exercise Pro UI without a subscription. */
const STORAGE_KEY = "dd_dev_simulate_pro";

/** True in Vite dev, or when preview/staging sets VITE_ENABLE_SIMULATE_PRO_UI=true. */
export function isSimulateProUiAllowed(): boolean {
  return (
    Boolean(import.meta.env.DEV) ||
    import.meta.env.VITE_ENABLE_SIMULATE_PRO_UI === "true"
  );
}

export function readDevSimulatePro(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDevSimulatePro(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("dd-dev-simulate-pro"));
}
