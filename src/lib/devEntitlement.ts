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

/**
 * Returns headers to attach to edge-function calls so the server treats the
 * caller as Pro when "Simulate Pro" is on in dev. Edge functions
 * (generate-plan, check-plan-quota, micro-reschedule-options, …) read the
 * `x-dd-dev-pro` header and, when present, bypass subscription gating.
 *
 * This is intentionally trusted unconditionally on the server — it's a
 * dev-only escape hatch. The UI to enable it is gated by
 * `isSimulateProUiAllowed()` so production builds don't expose the toggle.
 */
export function devSimulateProHeaders(): Record<string, string> {
  if (!isSimulateProUiAllowed()) return {};
  return readDevSimulatePro() ? { "x-dd-dev-pro": "1" } : {};
}
