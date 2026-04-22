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
  elapsedSec: number;
  loading: boolean;
  start: (categoryId?: string, opts?: { source?: string; note?: string; blockId?: string }) => Promise<void>;
  stop: () => Promise<void>;
  switchCategory: (categoryId: string) => Promise<void>;
  addCategory: (name: string, color?: string) => Promise<TimeCategory | null>;
  deleteCategory: (id: string) => Promise<void>;
  renameCategory: (id: string, name: string) => Promise<void>;
  todayTotalSec: number;
  weekTotalSec: number;
  refresh: () => Promise<void>;
};

const TimeTrackerCtx = createContext<Ctx | null>(null);

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
    // a forgotten timer. Cap it at 8h from started_at and surface the recovery.
    if (running) {
      const startedMs = new Date(running.started_at).getTime();
      const ageHours = (Date.now() - startedMs) / 3_600_000;
      if (ageHours > 8) {
        const cappedEnd = new Date(startedMs + 8 * 3_600_000).toISOString();
        await supabase.from("time_entries").update({ ended_at: cappedEnd }).eq("id", running.id);
        toast("⏱ Closed a forgotten timer (capped at 8h)");
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
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

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

  const value: Ctx = useMemo(() => ({
    categories, active, elapsedSec, loading,
    start, stop, switchCategory, addCategory, deleteCategory,
    todayTotalSec, weekTotalSec, refresh,
  }), [categories, active, elapsedSec, loading, todayTotalSec, weekTotalSec, refresh]);

  return <TimeTrackerCtx.Provider value={value}>{children}</TimeTrackerCtx.Provider>;
}

export function useTimeTracker() {
  const ctx = useContext(TimeTrackerCtx);
  if (!ctx) throw new Error("useTimeTracker must be used inside TimeTrackerProvider");
  return ctx;
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
