/**
 * Per-category report-currency overrides.
 *
 * Each tracker category has its own `currency` (the rate currency used while
 * the timer runs). The report can display amounts in a DIFFERENT currency
 * without rewriting the tracker — e.g. a freelancer who tracks in USD but
 * invoices clients in EUR for one specific client/category.
 *
 * Data shape stored in localStorage:
 *   { [catId]: { reportCurrency: "EUR", basedOnTrackerCurrency: "USD" } }
 *
 * The `basedOnTrackerCurrency` field is the tracker currency AT THE TIME the
 * user picked the override. If the tracker currency is later changed (e.g.
 * the user updates the category's hourly rate to EUR), the override is now
 * stale — the tracker already matches the intended currency. effectiveCurrency
 * detects this and auto-clears the override, preventing Reports from silently
 * showing the wrong currency.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "reports-cat-currency-overrides-v2";

type OverrideEntry = { reportCurrency: string; basedOnTrackerCurrency: string };
type OverrideMap = Record<string, OverrideEntry>;

const readStorage = (): OverrideMap => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as OverrideMap) : {};
  } catch {
    return {};
  }
};

const writeStorage = (next: OverrideMap) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota or private-mode — overrides become session-only, harmless */
  }
};

export function useReportCurrencyOverrides() {
  const [overrides, setOverrides] = useState<OverrideMap>(readStorage);

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      setOverrides(readStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setOverride = useCallback((catId: string, reportCurrency: string | null, trackerCurrency: string) => {
    setOverrides((prev) => {
      const next: OverrideMap = { ...prev };
      if (reportCurrency) {
        next[catId] = {
          reportCurrency: reportCurrency.toUpperCase(),
          basedOnTrackerCurrency: trackerCurrency.toUpperCase(),
        };
      } else {
        delete next[catId];
      }
      writeStorage(next);
      return next;
    });
  }, []);

  const clearOverride = useCallback((catId: string) => {
    setOverrides((prev) => {
      if (!prev[catId]) return prev;
      const next: OverrideMap = { ...prev };
      delete next[catId];
      writeStorage(next);
      return next;
    });
  }, []);

  /**
   * Resolve the report currency for a category.
   *
   * Returns the stored override ONLY when it's still valid — i.e. the
   * tracker currency hasn't changed since the override was set. If the
   * tracker currency has changed (user updated the category's billing
   * currency), the override is stale, auto-cleared, and the current
   * tracker currency is returned.
   */
  const effectiveCurrency = useCallback(
    (catId: string, trackerCurrency: string): string => {
      const normalTracker = (trackerCurrency || "USD").toUpperCase();
      const entry = overrides[catId];
      if (!entry) return normalTracker;

      // Stale override: the tracker currency was updated after the override
      // was set. Clear it — tracker currency is now the canonical value.
      if (entry.basedOnTrackerCurrency !== normalTracker) {
        // Fire-and-forget: clear the stale entry from storage.
        // We can't call setOverrides here (inside a render-time callback),
        // but we can write to storage directly so it cleans up on next read.
        const fresh = readStorage();
        if (fresh[catId]) {
          delete fresh[catId];
          writeStorage(fresh);
        }
        return normalTracker;
      }

      return entry.reportCurrency;
    },
    [overrides],
  );

  return { overrides, setOverride, clearOverride, effectiveCurrency };
}
