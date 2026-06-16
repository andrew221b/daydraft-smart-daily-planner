import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Lightweight, in-context coachmark system ("feature hints").
 *
 * Distinct from the onboarding Tour (which is a guided, blocking walk-through for
 * a brand-new, zero-data account). Hints are passive one-time tips that fire the
 * moment a user FIRST lands in a real context where a feature is usable — e.g.
 * their first task on the timeline, their first tracked session in Reports. This
 * is "show, don't tell": we can only point at a control once the data exists, so
 * these live in the product, not the tour.
 *
 * Storage is localStorage, deliberately: hints are throwaway UI state, and the
 * app's DB migrations are often applied late on prod — a synced column would mean
 * the feature silently does nothing until a migration lands. localStorage works
 * everywhere immediately. The (minor) cost is per-device: a tip seen on the phone
 * may show again on the web. That's an acceptable trade for a tip.
 */

const LS_ENABLED = "dd_hints_enabled";
const LS_SEEN = "dd_hints_seen";

type HintsCtx = {
  /** Master switch. When false, no hint ever renders. */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /** Has this hint already been shown + dismissed? */
  isSeen: (id: string) => boolean;
  /** Mark a hint as permanently dismissed. */
  markSeen: (id: string) => void;
  /** Wipe all "seen" flags (re-arms every hint). Used by the Settings reset. */
  resetSeen: () => void;
  // ── Single-active coordination (internal, used by FeatureHint) ──
  /** A hint declares itself eligible to show; provider grants the slot to one. */
  register: (id: string) => void;
  /** A hint is no longer eligible (unmounted / condition gone / dismissed). */
  unregister: (id: string) => void;
  /** Is this the hint currently allowed to occupy the screen? */
  isActive: (id: string) => boolean;
};

const Ctx = createContext<HintsCtx | null>(null);

const readEnabled = (): boolean => {
  try { return localStorage.getItem(LS_ENABLED) !== "0"; } catch { return true; }
};
const readSeen = (): Record<string, true> => {
  try {
    const raw = localStorage.getItem(LS_SEEN);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
};

export function HintsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(readEnabled);
  const [seen, setSeen] = useState<Record<string, true>>(readSeen);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Ordered list of currently-eligible hint ids. First in wins the slot, so a
  // hint that became eligible earlier isn't pre-empted by a later one.
  const pending = useRef<string[]>([]);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try { localStorage.setItem(LS_ENABLED, v ? "1" : "0"); } catch { /* ignore */ }
    if (!v) {
      pending.current = [];
      setActiveId(null);
    }
  }, []);

  const isSeen = useCallback((id: string) => !!seen[id], [seen]);

  const markSeen = useCallback((id: string) => {
    setSeen((prev) => {
      if (prev[id]) return prev;
      const next = { ...prev, [id]: true as const };
      try { localStorage.setItem(LS_SEEN, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const resetSeen = useCallback(() => {
    setSeen({});
    try { localStorage.removeItem(LS_SEEN); } catch { /* ignore */ }
  }, []);

  const promote = useCallback(() => {
    setActiveId((cur) => {
      if (cur && pending.current.includes(cur)) return cur; // still valid
      return pending.current[0] ?? null;
    });
  }, []);

  const register = useCallback((id: string) => {
    if (!pending.current.includes(id)) {
      pending.current = [...pending.current, id];
      promote();
    }
  }, [promote]);

  const unregister = useCallback((id: string) => {
    if (pending.current.includes(id)) {
      pending.current = pending.current.filter((x) => x !== id);
    }
    setActiveId((cur) => (cur === id ? (pending.current[0] ?? null) : cur));
  }, []);

  const isActive = useCallback((id: string) => activeId === id, [activeId]);

  const value = useMemo<HintsCtx>(() => ({
    enabled, setEnabled, isSeen, markSeen, resetSeen, register, unregister, isActive,
  }), [enabled, setEnabled, isSeen, markSeen, resetSeen, register, unregister, isActive]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHints() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHints must be used inside HintsProvider");
  return ctx;
}
