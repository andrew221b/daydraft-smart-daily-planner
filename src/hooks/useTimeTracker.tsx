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
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { billingDraftToCategoryUpdate } from "@/lib/categoryBilling";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchRollingEntries,
  invalidateRollingEntries,
  rollingEntriesQueryKey,
  type RollingEntry,
} from "@/lib/timeEntriesQuery";
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

/** Collapse duplicate category names (same user) — keeps default, else oldest. */
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

const remindedEntryIds = new Set<string>();
const REMIND_AFTER_HOURS = 2;

const CATEGORIES_ROOT = "time-categories" as const;
const categoriesQueryKey = (userId: string | undefined) =>
  [CATEGORIES_ROOT, userId ?? ""] as const;

const ACTIVE_ENTRY_ROOT = "time-tracker-active" as const;
const activeEntryQueryKey = (userId: string | undefined) =>
  [ACTIVE_ENTRY_ROOT, userId ?? ""] as const;

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

async function fetchCategories(userId: string): Promise<TimeCategory[]> {
  const { data, error } = await supabase
    .from("time_categories")
    .select("*")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw error;
  return dedupeCategoriesStable((data || []) as TimeCategory[]);
}

async function fetchActiveEntry(userId: string): Promise<TimeEntry | null> {
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as TimeEntry) || null;
}

/**
 * Sum durations from a rolling list of entries, clipped to a given window.
 * Used to derive today/week totals from the shared 60-day cache without a
 * second SELECT.
 */
function sumEntryDurations(
  entries: RollingEntry[],
  windowStartMs: number,
  windowEndMs: number,
  now: number,
): number {
  let total = 0;
  for (const e of entries) {
    const s = new Date(e.started_at).getTime();
    const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
    const a = Math.max(s, windowStartMs);
    const b = Math.min(en, windowEndMs);
    if (b > a) total += (b - a) / 1000;
  }
  return total;
}

export function TimeTrackerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [elapsedSec, setElapsedSec] = useState(0);
  const tickRef = useRef<number | null>(null);

  const userId = user?.id;
  const enabled = !!userId;

  const categoriesQuery = useQuery({
    queryKey: categoriesQueryKey(userId),
    queryFn: () => fetchCategories(userId!),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });

  const activeQuery = useQuery({
    queryKey: activeEntryQueryKey(userId),
    queryFn: () => fetchActiveEntry(userId!),
    enabled,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });

  const entriesQuery = useQuery({
    queryKey: rollingEntriesQueryKey(userId),
    queryFn: () => fetchRollingEntries(userId!),
    enabled,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });

  const categories = categoriesQuery.data ?? [];
  const active = activeQuery.data ?? null;
  const entries = entriesQuery.data ?? [];

  const loading =
    enabled &&
    (categoriesQuery.isLoading || activeQuery.isLoading || entriesQuery.isLoading);

  // Derive totals from the shared rolling entries. When a timer is running the
  // active entry already has a null ended_at, so sumEntryDurations counts the
  // live elapsed window automatically (re-derived whenever elapsedSec ticks).
  const { todayTotalSec, weekTotalSec } = useMemo(() => {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);
    return {
      todayTotalSec: sumEntryDurations(entries, startOfToday.getTime(), now, now),
      weekTotalSec: sumEntryDurations(entries, startOfWeek.getTime(), now, now),
    };
    // `elapsedSec` is the heartbeat that re-derives `now` while a timer is
    // running, so the totals tick once a second without a network round-trip.
  }, [entries, elapsedSec]);

  // Elapsed tick — pause when hidden, align to wall-clock seconds.
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!active) {
      setElapsedSec(0);
      return;
    }
    const started = new Date(active.started_at).getTime();
    const update = () => setElapsedSec(Math.floor((Date.now() - started) / 1000));

    let alignmentTimer: ReturnType<typeof setTimeout> | null = null;

    const startInterval = () => {
      if (tickRef.current) clearInterval(tickRef.current);
      update();
      const msToNextSec = 1000 - (Date.now() % 1000);
      alignmentTimer = setTimeout(() => {
        update();
        tickRef.current = window.setInterval(update, 1000);
      }, msToNextSec);
    };

    const stopInterval = () => {
      if (alignmentTimer) {
        clearTimeout(alignmentTimer);
        alignmentTimer = null;
      }
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };

    const onVisibility = () => {
      if (document.hidden) stopInterval();
      else startInterval();
    };

    if (!document.hidden) startInterval();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active?.id, active?.started_at]);

  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active?.id]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: categoriesQueryKey(userId) }),
      queryClient.invalidateQueries({ queryKey: activeEntryQueryKey(userId) }),
      invalidateRollingEntries(queryClient, userId),
    ]);
  }, [queryClient, userId]);

  const setCategoriesData = useCallback(
    (updater: (prev: TimeCategory[]) => TimeCategory[]) => {
      if (!userId) return;
      queryClient.setQueryData<TimeCategory[]>(categoriesQueryKey(userId), (prev) =>
        dedupeCategoriesStable(updater(prev ?? [])),
      );
    },
    [queryClient, userId],
  );

  const setActiveData = useCallback(
    (entry: TimeEntry | null) => {
      if (!userId) return;
      queryClient.setQueryData<TimeEntry | null>(activeEntryQueryKey(userId), entry);
    },
    [queryClient, userId],
  );

  // Long-running timer reminder.
  const stopRef = useRef<() => Promise<boolean>>(async () => false);
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
          onClick: () => {
            void stopRef.current();
          },
        },
      });
    };
    const initial = window.setTimeout(fire, 1500);
    const interval = window.setInterval(fire, 10 * 60_000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [active?.id, active?.started_at]);

  const startSession = async (
    categoryId?: string,
    opts?: { source?: string; note?: string; blockId?: string },
  ) => {
    if (!user) return;
    const cat =
      categoryId || categories.find((c) => c.is_default)?.id || categories[0]?.id;
    if (!cat) {
      toast.error("Add a category first");
      return;
    }
    const { data, error } = await supabase
      .from("time_entries")
      .insert({
        user_id: user.id,
        category_id: cat,
        source: opts?.source || "manual",
        note: opts?.note || null,
        block_id: opts?.blockId || null,
      })
      .select("*")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    const entry = data as TimeEntry;
    setActiveData(entry);
    // Optimistically prepend the live entry to the rolling cache so today/week
    // totals start counting immediately without a second round-trip.
    queryClient.setQueryData<RollingEntry[]>(
      rollingEntriesQueryKey(user.id),
      (prev) => {
        const next: RollingEntry = {
          id: entry.id,
          category_id: entry.category_id,
          started_at: entry.started_at,
          ended_at: entry.ended_at,
          note: entry.note,
          block_id: entry.block_id,
          source: entry.source,
        };
        return [next, ...(prev ?? [])];
      },
    );
    if (opts?.blockId) {
      try {
        const d = new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        localStorage.setItem(`dd_last_plan_progress_${key}`, new Date().toISOString());
      } catch {
        /* ignore */
      }
    }
  };

  const start: Ctx["start"] = async (categoryId, opts) => {
    if (active) return;
    await startSession(categoryId, opts);
  };

  const stop: Ctx["stop"] = async () => {
    if (!active || !user) return false;
    const current = active;
    const endedAt = new Date().toISOString();
    const { error } = await supabase
      .from("time_entries")
      .update({ ended_at: endedAt })
      .eq("id", current.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    const dur = Math.floor((Date.now() - new Date(current.started_at).getTime()) / 1000);
    if (current.block_id) {
      try {
        const { data: rows } = await supabase
          .from("time_entries")
          .select("started_at,ended_at")
          .eq("user_id", user.id)
          .eq("block_id", current.block_id)
          .not("ended_at", "is", null);
        const actualMin = Math.max(
          0,
          Math.round(
            (rows || []).reduce((sum: number, e: any) => {
              const s = new Date(e.started_at).getTime();
              const en = e.ended_at ? new Date(e.ended_at).getTime() : s;
              return sum + Math.max(0, (en - s) / 60000);
            }, 0),
          ),
        );
        await supabase.from("blocks").update({ actual_minutes: actualMin }).eq("id", current.block_id);
        try {
          window.dispatchEvent(
            new CustomEvent("dd-block-timer-stopped", {
              detail: { blockId: current.block_id, actualMinutes: actualMin },
            }),
          );
        } catch {
          /* ignore */
        }
      } catch {
        /* non-fatal */
      }
    }
    setActiveData(null);
    queryClient.setQueryData<RollingEntry[]>(
      rollingEntriesQueryKey(user.id),
      (prev) =>
        (prev ?? []).map((e) =>
          e.id === current.id ? { ...e, ended_at: endedAt } : e,
        ),
    );
    const m = Math.floor(dur / 60);
    toast.success(`Tracked ${m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`}`);
    return true;
  };
  stopRef.current = stop;

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
        keys
          .sort()
          .slice(0, keys.length - keepCount)
          .forEach((k) => localStorage.removeItem(k));
      }
      sessionStorage.setItem("dd_track_titles_swept", "1");
    } catch {
      /* ignore */
    }
  }, []);

  const switchCategory: Ctx["switchCategory"] = async (categoryId) => {
    if (!active) {
      await start(categoryId);
      return;
    }
    if (active.category_id === categoryId) return;
    const stopped = await stop();
    if (!stopped) return;
    await startSession(categoryId);
  };

  const addCategory: Ctx["addCategory"] = async (name, color) => {
    if (!user) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = categories.find(
      (c) => c.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) return existing;
    const usedColors = new Set(categories.map((c) => c.color));
    const pick =
      color || PALETTE.find((c) => !usedColors.has(c)) || PALETTE[categories.length % PALETTE.length];
    const { data, error } = await supabase
      .from("time_categories")
      .insert({
        user_id: user.id,
        name: trimmed,
        color: pick,
        is_default: false,
      })
      .select("*")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        const { data: again } = await supabase
          .from("time_categories")
          .select("*")
          .eq("user_id", user.id);
        const hit = (again || []).find(
          (c: TimeCategory) => c.name.trim().toLowerCase() === trimmed.toLowerCase(),
        );
        if (hit) {
          setCategoriesData(() => (again || []) as TimeCategory[]);
          return hit as TimeCategory;
        }
      }
      toast.error(error.message);
      return null;
    }
    setCategoriesData((prev) => [...prev, data as TimeCategory]);
    return data as TimeCategory;
  };

  const deleteCategory: Ctx["deleteCategory"] = async (id) => {
    const cat = categories.find((c) => c.id === id);
    if (cat?.is_default) {
      toast.error("Can't delete default category");
      return;
    }
    const { error } = await supabase.from("time_categories").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCategoriesData((prev) => prev.filter((c) => c.id !== id));
  };

  const renameCategory: Ctx["renameCategory"] = async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name can't be empty");
      return;
    }
    const { error } = await supabase
      .from("time_categories")
      .update({ name: trimmed })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCategoriesData((prev) => prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));
  };

  const updateCategoryRate: Ctx["updateCategoryRate"] = async (id, hourlyRate) => {
    const normalized =
      hourlyRate === null ? null : Math.max(0, Math.round(hourlyRate * 100) / 100);
    const { error } = await supabase
      .from("time_categories")
      .update({ hourly_rate: normalized } as any)
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCategoriesData((prev) =>
      prev.map((c) => (c.id === id ? { ...c, hourly_rate: normalized } : c)),
    );
  };

  const updateCategoryBilling: Ctx["updateCategoryBilling"] = async (id, draft) => {
    const row = billingDraftToCategoryUpdate(draft);
    const { error } = await supabase
      .from("time_categories")
      .update(row as any)
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCategoriesData((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...row } : c)),
    );
  };

  const addManualEntry: Ctx["addManualEntry"] = async (categoryId, durationSec, opts) => {
    if (!user) return;
    const end = opts?.startedAt
      ? new Date(opts.startedAt.getTime() + durationSec * 1000)
      : new Date();
    const start = opts?.startedAt || new Date(Date.now() - durationSec * 1000);
    const { data, error } = await supabase
      .from("time_entries")
      .insert({
        user_id: user.id,
        category_id: categoryId,
        started_at: start.toISOString(),
        ended_at: end.toISOString(),
        source: "manual_add",
        note: opts?.note || null,
      })
      .select("*")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    const m = Math.round(durationSec / 60);
    toast.success(`Logged ${m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`}`);
    const inserted = data as any;
    queryClient.setQueryData<RollingEntry[]>(
      rollingEntriesQueryKey(user.id),
      (prev) => {
        const row: RollingEntry = {
          id: inserted.id,
          category_id: inserted.category_id,
          started_at: inserted.started_at,
          ended_at: inserted.ended_at,
          note: inserted.note,
          block_id: inserted.block_id ?? null,
          source: inserted.source,
        };
        return [row, ...(prev ?? [])];
      },
    );
  };

  const deleteEntry: Ctx["deleteEntry"] = async (id) => {
    const { error } = await supabase.from("time_entries").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (user?.id) {
      queryClient.setQueryData<RollingEntry[]>(
        rollingEntriesQueryKey(user.id),
        (prev) => (prev ?? []).filter((e) => e.id !== id),
      );
    }
  };

  const value: Ctx = useMemo(
    () => ({
      categories,
      active,
      loading,
      start,
      stop,
      switchCategory,
      addCategory,
      deleteCategory,
      renameCategory,
      updateCategoryRate,
      updateCategoryBilling,
      addManualEntry,
      deleteEntry,
      todayTotalSec,
      weekTotalSec,
      refresh,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, active, loading, todayTotalSec, weekTotalSec, refresh],
  );

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
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

export const fmtHM = (s: number) => {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};
