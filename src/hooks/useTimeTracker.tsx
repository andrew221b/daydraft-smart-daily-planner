import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { billingDraftToCategoryUpdate } from "@/lib/categoryBilling";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

export type TimeCategory = {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
  hourly_rate?: number | null;
  currency?: string | null;
  payment_method?: string | null;
  billing_display_name?: string | null;
  billing_bank_name?: string | null;
  billing_iban?: string | null;
  billing_crypto_network?: string | null;
  billing_crypto_wallet?: string | null;
  billing_payment_link?: string | null;
  billing_notes?: string | null;
  created_at?: string;
};

/** Collapse duplicate category names (same user) — keeps default, else oldest. DB migration should still remove dupes. */
function dedupeCategoriesStable(rows: TimeCategory[]): TimeCategory[] {
  if (rows.length <= 1) return rows;
  const sorted = [...rows].sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return ta - tb;
  });
  const byName = new Map<string, TimeCategory>();
  for (const c of sorted) {
    const key = c.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, c);
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
export type TimeEntry = {
  id: string;
  category_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  source: string;
  block_id: string | null;
};

type Ctx = {
  categories: TimeCategory[];
  active: TimeEntry | null;
  loading: boolean;
  start: (categoryId?: string, opts?: { source?: string; note?: string; blockId?: string }) => Promise<void>;
  stop: () => Promise<boolean>;
  switchCategory: (categoryId: string) => Promise<void>;
  addCategory: (name: string, color?: string) => Promise<TimeCategory | null>;
  deleteCategory: (id: string) => Promise<void>;
  renameCategory: (id: string, name: string) => Promise<void>;
  updateCategoryRate: (id: string, hourlyRate: number | null) => Promise<void>;
  updateCategoryBilling: (
    id: string,
    draft: {
      currency?: string;
      payment_method?: string;
      display_name: string;
      bank_name: string;
      iban: string;
      crypto_network: string;
      crypto_wallet: string;
      payment_link: string;
      notes: string;
    },
  ) => Promise<void>;
  addManualEntry: (categoryId: string, durationSec: number, opts?: { startedAt?: Date; note?: string }) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  todayTotalSec: number;
  weekTotalSec: number;
  refresh: () => Promise<void>;
};

const TimeTrackerCtx = createContext<Ctx | null>(null);
const TimeTrackerElapsedCtx = createContext(0);

const PALETTE = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444"];

/** Avoid spamming the same toast for the same entry within a session. */
const remindedEntryIds = new Set<string>();
const REMIND_AFTER_HOURS = 2; // first reminder

function fmtAge(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function tryBrowserNotify(title: string, body: string) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    new Notification(title, { body, tag: "dd-tracker-running" });
  } catch {
    /* ignore */
  }
}

export function TimeTrackerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<TimeCategory[]>([]);
  const [active, setActive] = useState<TimeEntry | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [loading, setLoading] = useState(true);
  const [todayTotalSec, setTodayTotalSec] = useState(0);
  const [weekTotalSec, setWeekTotalSec] = useState(0);
  const tickRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [catsRes, runRes, weekRes] = await Promise.all([
        supabase.from("time_categories").select("*").eq("user_id", user.id).order("created_at"),
        supabase.from("time_entries").select("*").eq("user_id", user.id).is("ended_at", null).order("started_at", { ascending: false }).limit(1),
        (() => {
          const since = new Date(); since.setDate(since.getDate() - 7); since.setHours(0,0,0,0);
          return supabase.from("time_entries").select("started_at,ended_at").eq("user_id", user.id).gte("started_at", since.toISOString());
        })(),
      ]);
      setCategories(dedupeCategoriesStable((catsRes.data || []) as TimeCategory[]));
      const running = (runRes.data?.[0] as TimeEntry) || null;
      setActive(running);
      // Long-running timer reminder is handled by a dedicated effect below
      // (so it can re-check periodically while the app stays open).

      const now = Date.now();
      const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
      let today = 0, week = 0;
      (weekRes.data || []).forEach((e: any) => {
        const s = new Date(e.started_at).getTime();
        const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
        const dur = Math.max(0, (en - s) / 1000);
        week += dur;
        const overlap = Math.max(s, startOfToday.getTime());
        if (en > overlap) today += Math.max(0, (en - overlap) / 1000);
      });
      setTodayTotalSec(today);
      setWeekTotalSec(week);
    } catch {
      /* network / misconfigured preview — avoid infinite loading shell */
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Defer first load so shell + tab bar can paint before three parallel Supabase
  // queries (mobile/low-end CPUs benefit noticeably).
  useEffect(() => {
    if (!user?.id) {
      setCategories([]);
      setActive(null);
      setTodayTotalSec(0);
      setWeekTotalSec(0);
      setElapsedSec(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const run = () => {
      if (!cancelled) void refresh();
    };
    let idleHandle: ReturnType<typeof requestIdleCallback> | undefined;
    let timeoutFallback: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestIdleCallback !== "undefined") {
      idleHandle = requestIdleCallback(run, { timeout: 2500 });
    } else {
      timeoutFallback = setTimeout(run, 1);
    }
    return () => {
      cancelled = true;
      if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
      if (timeoutFallback !== undefined) clearTimeout(timeoutFallback);
    };
  }, [user?.id, refresh]);

  // tick for elapsed display
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!active) { setElapsedSec(0); return; }
    const update = () => setElapsedSec(Math.floor((Date.now() - new Date(active.started_at).getTime()) / 1000));
    update();
    tickRef.current = window.setInterval(update, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [active?.id, active?.started_at]);

  // warn if closing while running
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active?.id]);

  // Long-running timer reminder. Fires once per entry per session as soon as
  // the timer crosses REMIND_AFTER_HOURS (and on app open if it's already
  // past that threshold). User can stop or keep going — we never delete the
  // entry automatically, only nudge.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const fire = () => {
      if (cancelled || !active) return;
      const ageMs = Date.now() - new Date(active.started_at).getTime();
      if (ageMs < REMIND_AFTER_HOURS * 3_600_000) return;
      if (remindedEntryIds.has(active.id)) return;
      remindedEntryIds.add(active.id);
      const ageLabel = fmtAge(ageMs);
      tryBrowserNotify("Timer still running", `Your timer has been running for ${ageLabel}.`);
      toast(`Timer running for ${ageLabel} — still working?`, {
        duration: 12000,
        action: {
          label: "Stop",
          onClick: () => { void stop(); },
        },
      });
    };
    // initial check shortly after load so refresh() has set `active`
    const initial = window.setTimeout(fire, 1500);
    // and re-check every 10 minutes so we catch the threshold while open
    const interval = window.setInterval(fire, 10 * 60_000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.started_at]);

  const startSession = async (categoryId?: string, opts?: { source?: string; note?: string; blockId?: string }) => {
    if (!user) return;
    const cat = categoryId || categories.find(c => c.is_default)?.id || categories[0]?.id;
    if (!cat) { toast.error("Add a category first"); return; }
    const { data, error } = await supabase.from("time_entries").insert({
      user_id: user.id,
      category_id: cat,
      source: opts?.source || "manual",
      note: opts?.note || null,
      block_id: opts?.blockId || null,
    }).select("*").single();
    if (error) { toast.error(error.message); return; }
    setActive(data as TimeEntry);
    if (opts?.blockId) {
      try {
        const d = new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        localStorage.setItem(`dd_last_plan_progress_${key}`, new Date().toISOString());
      } catch {/* ignore */}
    }
  };

  const start: Ctx["start"] = async (categoryId, opts) => {
    if (active) return; // already running
    await startSession(categoryId, opts);
  };

  const stop: Ctx["stop"] = async () => {
    if (!active || !user) return false;
    const current = active;
    const endedAt = new Date().toISOString();
    const { error } = await supabase.from("time_entries").update({ ended_at: endedAt }).eq("id", current.id);
    if (error) { toast.error(error.message); return false; }
    const dur = Math.floor((Date.now() - new Date(current.started_at).getTime()) / 1000);
    if (current.block_id) {
      try {
        const { data: entries } = await supabase
          .from("time_entries")
          .select("started_at,ended_at")
          .eq("user_id", user.id)
          .eq("block_id", current.block_id)
          .not("ended_at", "is", null);
        const actualMin = Math.max(
          0,
          Math.round((entries || []).reduce((sum: number, e: any) => {
            const s = new Date(e.started_at).getTime();
            const en = e.ended_at ? new Date(e.ended_at).getTime() : s;
            return sum + Math.max(0, (en - s) / 60000);
          }, 0)),
        );
        await supabase.from("blocks").update({ actual_minutes: actualMin }).eq("id", current.block_id);
        try {
          window.dispatchEvent(new CustomEvent("dd-block-timer-stopped", {
            detail: { blockId: current.block_id, actualMinutes: actualMin },
          }));
        } catch {
          // ignore non-browser environments
        }
      } catch {
        // non-fatal: tracker stop should still succeed even if block summary update fails
      }
    }
    setActive(null);
    setTodayTotalSec(t => t + dur);
    setWeekTotalSec(t => t + dur);
    const m = Math.floor(dur / 60);
    toast.success(`Tracked ${m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`}`);
    return true;
  };

  // Sweep stale per-plan localStorage opt-in keys (from Today.tsx ClarifySheet)
  // once per session. Without this, every plan permanently leaves a key behind
  // and storage grows forever.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("dd_track_titles_swept")) return;
      const keepCount = 30;
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("dd_track_titles_")) keys.push(k);
      }
      if (keys.length > keepCount) {
        // Drop oldest by string sort (UUIDs aren't dated, so we just trim arbitrary excess).
        keys.sort().slice(0, keys.length - keepCount).forEach(k => localStorage.removeItem(k));
      }
      sessionStorage.setItem("dd_track_titles_swept", "1");
    } catch {/* ignore */}
  }, []);

  const switchCategory: Ctx["switchCategory"] = async (categoryId) => {
    if (!active) { await start(categoryId); return; }
    if (active.category_id === categoryId) return;
    const stopped = await stop();
    if (!stopped) return;
    await startSession(categoryId);
  };

  const addCategory: Ctx["addCategory"] = async (name, color) => {
    if (!user) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = categories.find((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const usedColors = new Set(categories.map(c => c.color));
    const pick = color || PALETTE.find(c => !usedColors.has(c)) || PALETTE[categories.length % PALETTE.length];
    const { data, error } = await supabase.from("time_categories").insert({
      user_id: user.id, name: trimmed, color: pick, is_default: false,
    }).select("*").single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        const { data: again } = await supabase.from("time_categories").select("*").eq("user_id", user.id);
        const hit = (again || []).find((c: TimeCategory) => c.name.trim().toLowerCase() === trimmed.toLowerCase());
        if (hit) {
          setCategories(dedupeCategoriesStable((again || []) as TimeCategory[]));
          return hit as TimeCategory;
        }
      }
      toast.error(error.message);
      return null;
    }
    setCategories((c) => dedupeCategoriesStable([...c, data as TimeCategory]));
    return data as TimeCategory;
  };

  const deleteCategory: Ctx["deleteCategory"] = async (id) => {
    const cat = categories.find(c => c.id === id);
    if (cat?.is_default) { toast.error("Can't delete default category"); return; }
    const { error } = await supabase.from("time_categories").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setCategories(c => c.filter(x => x.id !== id));
  };

  const renameCategory: Ctx["renameCategory"] = async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Name can't be empty"); return; }
    const { error } = await supabase.from("time_categories").update({ name: trimmed }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setCategories(cs => cs.map(c => c.id === id ? { ...c, name: trimmed } : c));
  };

  const updateCategoryRate: Ctx["updateCategoryRate"] = async (id, hourlyRate) => {
    const normalized = hourlyRate === null ? null : Math.max(0, Math.round(hourlyRate * 100) / 100);
    const { error } = await supabase.from("time_categories").update({ hourly_rate: normalized } as any).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setCategories(cs => cs.map(c => c.id === id ? { ...c, hourly_rate: normalized } : c));
  };

  const updateCategoryBilling: Ctx["updateCategoryBilling"] = async (id, draft) => {
    const row = billingDraftToCategoryUpdate(draft);
    const { error } = await supabase.from("time_categories").update(row as any).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, ...row } : c)));
  };

  const addManualEntry: Ctx["addManualEntry"] = async (categoryId, durationSec, opts) => {
    if (!user) return;
    const end = opts?.startedAt ? new Date(opts.startedAt.getTime() + durationSec * 1000) : new Date();
    const start = opts?.startedAt || new Date(Date.now() - durationSec * 1000);
    const { error } = await supabase.from("time_entries").insert({
      user_id: user.id,
      category_id: categoryId,
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      source: "manual_add",
      note: opts?.note || null,
    });
    if (error) { toast.error(error.message); return; }
    const m = Math.round(durationSec / 60);
    toast.success(`Logged ${m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`}`);
    // Incremental update — avoids a full week-of-entries SELECT for every add.
    // We add to today/week totals using the actual overlap with today.
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const startMs = start.getTime();
    const endMs = end.getTime();
    const overlapStart = Math.max(startMs, startOfToday.getTime());
    const todayDelta = Math.max(0, (endMs - overlapStart) / 1000);
    setWeekTotalSec(t => t + durationSec);
    setTodayTotalSec(t => t + todayDelta);
  };

  const deleteEntry: Ctx["deleteEntry"] = async (id) => {
    // We don't have the entry locally to subtract precisely, so refresh.
    // Deletion is rare compared to add; the cost is acceptable.
    const { error } = await supabase.from("time_entries").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await refresh();
  };

  const value: Ctx = useMemo(() => ({
    categories, active, loading,
    start, stop, switchCategory, addCategory, deleteCategory, renameCategory, updateCategoryRate, updateCategoryBilling,
    addManualEntry, deleteEntry,
    todayTotalSec, weekTotalSec, refresh,
  }), [categories, active, loading, todayTotalSec, weekTotalSec, refresh]);

  return (
    <TimeTrackerElapsedCtx.Provider value={elapsedSec}>
      <TimeTrackerCtx.Provider value={value}>{children}</TimeTrackerCtx.Provider>
    </TimeTrackerElapsedCtx.Provider>
  );
}

export function useTimeTracker() {
  const ctx = useContext(TimeTrackerCtx);
  if (!ctx) throw new Error("useTimeTracker must be used inside TimeTrackerProvider");
  return ctx;
}

export function useTimeTrackerElapsed() {
  return useContext(TimeTrackerElapsedCtx);
}

export const fmtHMS = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
};

export const fmtHM = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};
