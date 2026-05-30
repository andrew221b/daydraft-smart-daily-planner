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
  hydrateRollingEntries,
  invalidateRollingEntries,
  rollingEntriesQueryKey,
  type RollingEntry,
} from "@/lib/timeEntriesQuery";
import { useAuth } from "./useAuth";
import { toast } from "sonner";
import { recordTimerDrift } from "@/lib/perfMonitor";
import { liveActivity } from "@/lib/liveActivity";

/* ─────────────────────────────────────────────────────────────────────────
 * Live elapsed pub/sub.
 *
 * The per-second tick used to be a `useState(elapsedSec)` that re-rendered
 * the whole provider (and every consumer) once a second. That was the single
 * biggest source of jank — the running timer screen re-rendered ~60 times
 * over a Pomodoro for no visual reason beyond "the digits changed."
 *
 * Now: a singleton store with subscribe/get/set semantics. The display
 * component (`LiveElapsed`) writes the formatted seconds directly into the
 * DOM via `textContent`. Other consumers (totals, ring fills) can still read
 * `elapsedMin` from the React context — that updates only on minute
 * boundaries, which is the granularity those derived values care about.
 * ──────────────────────────────────────────────────────────────────────── */
let elapsedSecValue = 0;
const elapsedListeners = new Set<(sec: number) => void>();

export function getElapsedSec(): number {
  return elapsedSecValue;
}

export function subscribeElapsed(listener: (sec: number) => void): () => void {
  elapsedListeners.add(listener);
  return () => {
    elapsedListeners.delete(listener);
  };
}

function emitElapsed(sec: number): void {
  elapsedSecValue = sec;
  // Snapshot to a small array first so a listener that unsubscribes mid-loop
  // doesn't mutate the live Set we're iterating.
  for (const l of Array.from(elapsedListeners)) {
    try { l(sec); } catch { /* listener failures must not crash the tick */ }
  }
}

export type TimeCategory = {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
  hourly_rate?: number | null;
  /** ISO timestamp of when a rate was first set. Only sessions starting on or
   *  after this moment count toward earnings. NULL = apply rate to all time. */
  rate_set_at?: string | null;
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
  resetRateSetAt: (id: string) => Promise<void>;
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
/** Minute-resolution heartbeat. Drives `fmtHM` totals that only change once a minute. */
const TimeTrackerElapsedMinCtx = createContext(0);

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
  // Minute-resolution heartbeat used to recompute today/week totals.
  // The per-second tick lives outside React (see emitElapsed above) so the
  // running timer never causes a re-render.
  const [elapsedMin, setElapsedMin] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const fallbackTickRef = useRef<number | null>(null);
  const alignmentRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Local-first hydration. On cold launch (or after the gc'd cache clears
  // overnight), prime the React Query cache from IndexedDB before the live
  // fetch lands so totals paint instantly. Runs once per user-id change.
  useEffect(() => {
    if (!userId) return;
    void hydrateRollingEntries(queryClient, userId);
  }, [userId, queryClient]);

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
  // live elapsed window automatically. `elapsedMin` is the minute-resolution
  // heartbeat that re-derives `now`; once-a-minute is the right cadence for
  // `fmtHM` totals (h+m only — sub-minute changes wouldn't be visible).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, elapsedMin]);

  // Timer tick. Runs in a Web Worker so the cadence survives tab throttling /
  // background phone screen, and so it never schedules React work on the main
  // thread. The worker posts {elapsedSec} once a second; we forward to the
  // subscribers (LiveElapsed components write straight to the DOM) and only
  // touch React state on minute boundaries.
  useEffect(() => {
    // Stop any prior tick.
    const stopFallback = () => {
      if (fallbackTickRef.current != null) {
        clearInterval(fallbackTickRef.current);
        fallbackTickRef.current = null;
      }
      if (alignmentRef.current != null) {
        clearTimeout(alignmentRef.current);
        alignmentRef.current = null;
      }
    };
    const stopWorker = () => {
      if (workerRef.current) {
        try { workerRef.current.postMessage({ type: "stop" }); } catch { /* ignore */ }
      }
    };
    stopFallback();
    stopWorker();
    if (!active) {
      emitElapsed(0);
      setElapsedMin(0);
      const ping = () => setElapsedMin((m) => m + 1);
      // Keep a background minute heartbeat alive when idle so that
      // Date.now()-based totals (today/week) re-evaluate when the day rolls over.
      const msToNextMin = 60000 - (Date.now() % 60000);
      alignmentRef.current = setTimeout(() => {
        ping();
        fallbackTickRef.current = window.setInterval(ping, 60000);
      }, msToNextMin);
      
      const onVisibility = () => {
        if (!document.hidden) ping();
      };
      document.addEventListener("visibilitychange", onVisibility);
      
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        stopFallback();
      };
    }

    const started = new Date(active.started_at).getTime();
    let lastMin = -1;

    const handleTick = (sec: number) => {
      emitElapsed(sec);
      const min = Math.floor(sec / 60);
      if (min !== lastMin) {
        lastMin = min;
        setElapsedMin(min);
      }
    };

    // Try the worker first; fall back to a main-thread interval if the
    // environment can't spawn workers (older WebViews, some test runners).
    let usingWorker = false;
    try {
      if (typeof Worker !== "undefined") {
        const worker = new Worker(
          new URL("@/workers/timer.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (e: MessageEvent) => {
          const msg = e.data;
          if (!msg) return;
          if (msg.type === "tick") {
            handleTick(msg.elapsedSec as number);
          } else if (msg.type === "drift") {
            recordTimerDrift(msg.drift as number);
            // Resync from system clock on large drift.
            worker.postMessage({ type: "start", startedAtMs: started });
          }
        };
        worker.postMessage({ type: "start", startedAtMs: started });
        workerRef.current = worker;
        usingWorker = true;
      }
    } catch {
      usingWorker = false;
    }

    if (!usingWorker) {
      const update = () => {
        handleTick(Math.max(0, Math.floor((Date.now() - started) / 1000)));
      };
      update();
      const msToNextSec = 1000 - (Date.now() % 1000);
      alignmentRef.current = setTimeout(() => {
        update();
        fallbackTickRef.current = window.setInterval(update, 1000);
      }, msToNextSec);
    }

    // When the tab comes back to the foreground after a long sleep, the
    // worker will already be in sync (it's not throttled), but we ping it to
    // get an immediate update on the DOM so the digits don't lag a second.
    const onVisibility = () => {
      if (!document.hidden) {
        if (workerRef.current) {
          try { workerRef.current.postMessage({ type: "ping" }); } catch { /* ignore */ }
        } else {
          // Main-thread fallback: recompute now in case the interval was
          // throttled while hidden.
          handleTick(Math.max(0, Math.floor((Date.now() - started) / 1000)));
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopFallback();
      if (workerRef.current) {
        try { workerRef.current.postMessage({ type: "stop" }); } catch { /* ignore */ }
        workerRef.current.terminate();
        workerRef.current = null;
      }
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
    // Surface the running tracker in the Dynamic Island / Lock Screen — but
    // NOT when it was auto-started from a Focus session: Focus shows its own
    // Live Activity (the task), and the native layer only allows one at a
    // time. iOS-only; a no-op elsewhere.
    if (opts?.source !== "focus") {
      const catObj = categories.find((c) => c.id === entry.category_id);
      if (catObj) {
        void liveActivity.startTracker({
          categoryName: catObj.name,
          color: catObj.color,
          hourlyRate: catObj.hourly_rate ?? 0,
          currencyCode: catObj.currency ?? "USD",
          startedAt: new Date(entry.started_at).getTime(),
        });
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
    // Tear down the tracker Live Activity. Safe to call unconditionally — if
    // the session was started from Focus there's no tracker activity and this
    // is a no-op (Focus owns its own activity and tears it down separately).
    void liveActivity.stopTracker();
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
    // Stamp rate_set_at the first time a positive rate is assigned so that
    // previously-tracked time (before the rate existed) is not retroactively
    // counted toward earnings.
    const prev = categories.find((c) => c.id === id);
    const wasUnrated = !prev?.hourly_rate;
    const nowRated = normalized !== null && normalized > 0;
    const rateSetAt = wasUnrated && nowRated ? new Date().toISOString() : undefined;
    const patch: Record<string, unknown> = { hourly_rate: normalized };
    if (rateSetAt !== undefined) patch.rate_set_at = rateSetAt;
    // If rate is cleared, also clear the timestamp so a future re-assignment
    // gets a fresh stamp.
    if (normalized === null) patch.rate_set_at = null;
    const { error } = await supabase
      .from("time_categories")
      .update(patch as any)
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCategoriesData((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, hourly_rate: normalized, ...(patch.rate_set_at !== undefined ? { rate_set_at: patch.rate_set_at as string | null } : {}) }
          : c,
      ),
    );
  };

  const resetRateSetAt: Ctx["resetRateSetAt"] = async (id) => {
    const { error } = await supabase
      .from("time_categories")
      .update({ rate_set_at: null } as any)
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    setCategoriesData((prev) =>
      prev.map((c) => (c.id === id ? { ...c, rate_set_at: null } : c)),
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
      resetRateSetAt,
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
    <TimeTrackerElapsedMinCtx.Provider value={elapsedMin}>
      <TimeTrackerCtx.Provider value={value}>{children}</TimeTrackerCtx.Provider>
    </TimeTrackerElapsedMinCtx.Provider>
  );
}

export function useTimeTracker() {
  const ctx = useContext(TimeTrackerCtx);
  if (!ctx) throw new Error("useTimeTracker must be used inside TimeTrackerProvider");
  return ctx;
}

/**
 * Back-compat hook. Used to re-render once a second; now re-renders once a
 * minute. Suitable for `fmtHM`-style derivations. Pages that need
 * second-level updates should use `<LiveElapsed format={...} />` or
 * subscribe via `subscribeElapsed` directly — those do NOT trigger React
 * renders.
 */
export function useTimeTrackerElapsed() {
  // Returns minute-aligned seconds so consumers that pass this into
  // fmtHM/fmtHMS-like formatters still see a number that grows over time.
  return useContext(TimeTrackerElapsedMinCtx) * 60;
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
  if (h === 0) {
    if (m === 0 && s > 0) return `${Math.floor(s)}s`;
    return `${m}m`;
  }
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};
