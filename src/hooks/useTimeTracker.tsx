import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

export type TimeCategory = { id: string; name: string; color: string; is_default: boolean };
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
  stop: () => Promise<void>;
  switchCategory: (categoryId: string) => Promise<void>;
  addCategory: (name: string, color?: string) => Promise<TimeCategory | null>;
  deleteCategory: (id: string) => Promise<void>;
  renameCategory: (id: string, name: string) => Promise<void>;
  addManualEntry: (categoryId: string, durationSec: number, opts?: { startedAt?: Date; note?: string }) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  todayTotalSec: number;
  weekTotalSec: number;
  refresh: () => Promise<void>;
};

const TimeTrackerCtx = createContext<Ctx | null>(null);
const TimeTrackerElapsedCtx = createContext(0);

const PALETTE = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444"];

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
      setCategories((catsRes.data || []) as TimeCategory[]);
      let running = (runRes.data?.[0] as TimeEntry) || null;
      // Auto-close stale runs: anything still open after 8h is almost certainly
      // a forgotten timer (e.g. user fell asleep). DROP it rather than crediting
      // the user with hours they didn't actually work — false data is worse than
      // missing data. We delete the entry entirely and notify on recovery.
      if (running) {
        const startedMs = new Date(running.started_at).getTime();
        const ageHours = (Date.now() - startedMs) / 3_600_000;
        if (ageHours > 8) {
          await supabase.from("time_entries").delete().eq("id", running.id);
          toast("Stopped a stale timer older than 8 hours. Log it manually if needed.", { duration: 5000 });
          running = null;
        }
      }
      setActive(running);

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

  const start: Ctx["start"] = async (categoryId, opts) => {
    if (!user) return;
    if (active) return; // already running
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
  };

  const stop: Ctx["stop"] = async () => {
    if (!active || !user) return;
    const endedAt = new Date().toISOString();
    const { error } = await supabase.from("time_entries").update({ ended_at: endedAt }).eq("id", active.id);
    if (error) { toast.error(error.message); return; }
    const dur = Math.floor((Date.now() - new Date(active.started_at).getTime()) / 1000);
    setActive(null);
    setTodayTotalSec(t => t + dur);
    setWeekTotalSec(t => t + dur);
    const m = Math.floor(dur / 60);
    toast.success(`Tracked ${m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`}`);
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
    await stop();
    await start(categoryId);
  };

  const addCategory: Ctx["addCategory"] = async (name, color) => {
    if (!user) return null;
    const usedColors = new Set(categories.map(c => c.color));
    const pick = color || PALETTE.find(c => !usedColors.has(c)) || PALETTE[categories.length % PALETTE.length];
    const { data, error } = await supabase.from("time_categories").insert({
      user_id: user.id, name: name.trim(), color: pick, is_default: false,
    }).select("*").single();
    if (error) { toast.error(error.message); return null; }
    setCategories(c => [...c, data as TimeCategory]);
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
    start, stop, switchCategory, addCategory, deleteCategory, renameCategory,
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
