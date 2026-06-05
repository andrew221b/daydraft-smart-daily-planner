import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { enqueueWrite } from "@/lib/idbCache";
import { scheduleChecklistReminder } from "@/lib/localNotifications";
import { dateStr } from "@/lib/daydraft";
import type { Database } from "@/integrations/supabase/types";

/**
 * Checklist mode data layer — an untimed, parallel list that lives alongside
 * the timeline plan but never touches `blocks`/`plans`.
 *
 * Source of truth is Supabase (so it syncs across devices, survives reinstall,
 * and is isolated per-user by RLS). On top of that:
 *   • a localStorage cache (namespaced by userId) paints instantly + offline,
 *   • optimistic updates with client-generated UUIDs,
 *   • the existing offline write queue as a fallback when a write fails,
 *   • a reminder reschedule whenever the day's items change.
 *
 * Items never become "missed"; there is no time/tracking here at all.
 */

export type ChecklistGroup = Database["public"]["Tables"]["checklist_groups"]["Row"];
export type ChecklistItem = Database["public"]["Tables"]["checklist_items"]["Row"];

type DayBucket = { groups: ChecklistGroup[]; items: ChecklistItem[] };
type Cache = Record<string, DayBucket>;

const CACHE_PREFIX = "dd_checklist_cache_";
const PRUNE_DAYS = 30;

const newId = (): string => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* ignore */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};
const nowIso = () => new Date().toISOString();

function readCache(userId: string): Cache {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + userId);
    return raw ? (JSON.parse(raw) as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(userId: string, cache: Cache) {
  try {
    // Prune buckets older than PRUNE_DAYS so the blob can't grow unbounded.
    // YYYY-MM-DD strings sort lexicographically, so a plain string compare works.
    const cutoff = dateStr(new Date(Date.now() - PRUNE_DAYS * 86_400_000));
    const pruned: Cache = {};
    for (const [date, bucket] of Object.entries(cache)) {
      if (date >= cutoff) pruned[date] = bucket;
    }
    localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(pruned));
  } catch {
    /* quota / unavailable — best effort */
  }
}

const maxPos = (rows: { position: number }[]) =>
  rows.reduce((m, r) => Math.max(m, r.position), -1);

/**
 * Synchronous, network-free peek at a day's checklist from the local cache —
 * used by DayView to show the "open items" badge on the mode switcher without
 * mounting the full view or issuing a fetch. `open` = unchecked item count.
 */
export function peekChecklistCounts(
  userId: string | undefined,
  planDate: string,
): { total: number; open: number; groups: number } {
  if (!userId) return { total: 0, open: 0, groups: 0 };
  const bucket = readCache(userId)[planDate];
  if (!bucket) return { total: 0, open: 0, groups: 0 };
  const total = bucket.items.length;
  const open = bucket.items.filter((i) => !i.done).length;
  // Include category count so the day's "…" menu (and its Delete) stays
  // reachable even when every item is gone but empty categories remain.
  return { total, open, groups: bucket.groups.length };
}

/**
 * Lightweight background fetch — populates the localStorage cache for a day
 * without mounting useChecklist. Called by Home so the checklist progress card
 * appears immediately after login, before the user ever visits the checklist tab.
 * Returns true if new data was written (so the caller can trigger a re-render).
 */
export async function prefetchChecklistCounts(
  userId: string,
  planDate: string,
): Promise<boolean> {
  if (readCache(userId)[planDate]) return false; // already cached
  const [gRes, iRes] = await Promise.all([
    supabase
      .from("checklist_groups")
      .select("*")
      .eq("user_id", userId)
      .eq("plan_date", planDate)
      .order("position", { ascending: true }),
    supabase
      .from("checklist_items")
      .select("*")
      .eq("user_id", userId)
      .eq("plan_date", planDate)
      .order("position", { ascending: true }),
  ]);
  if (gRes.error || iRes.error) return false;
  const cache = readCache(userId);
  cache[planDate] = {
    groups: (gRes.data ?? []) as ChecklistGroup[],
    items: (iRes.data ?? []) as ChecklistItem[],
  };
  writeCache(userId, cache);
  return true;
}

export interface MoveTarget {
  groupId?: string | null;
  date?: string;
}

export function useChecklist(
  userId: string | undefined,
  planDate: string,
  eveningNudgeTime?: string,
) {
  const [groups, setGroups] = useState<ChecklistGroup[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Always-fresh refs so async CRUD reads the latest arrays.
  const groupsRef = useRef(groups);
  const itemsRef = useRef(items);
  groupsRef.current = groups;
  itemsRef.current = items;
  // Monotonic id so only the LATEST reload may commit. On app resume both the
  // window "focus" and document "visibilitychange" events fire a reload, and an
  // in-flight reload from before the device locked can resolve AFTER a fresh
  // one — committing stale rows last. That was the "a task appeared then
  // vanished" glitch. The guard makes any superseded reload a no-op.
  const reloadGenRef = useRef(0);

  // ── local commit: state + cache together ───────────────────────────────
  const commit = useCallback(
    (nextGroups: ChecklistGroup[], nextItems: ChecklistItem[]) => {
      setGroups(nextGroups);
      setItems(nextItems);
      if (userId) {
        const cache = readCache(userId);
        cache[planDate] = { groups: nextGroups, items: nextItems };
        writeCache(userId, cache);
      }
    },
    [userId, planDate],
  );

  // ── instant paint from cache on (user, date) change ────────────────────
  useEffect(() => {
    if (!userId) {
      setGroups([]);
      setItems([]);
      setLoading(false);
      return;
    }
    const bucket = readCache(userId)[planDate];
    if (bucket) {
      setGroups(bucket.groups);
      setItems(bucket.items);
      setLoading(false);
    } else {
      setGroups([]);
      setItems([]);
      setLoading(true);
    }
  }, [userId, planDate]);

  // ── authoritative fetch from Supabase ──────────────────────────────────
  const reload = useCallback(async () => {
    if (!userId) return;
    const gen = ++reloadGenRef.current;
    const [gRes, iRes] = await Promise.all([
      supabase
        .from("checklist_groups")
        .select("*")
        .eq("user_id", userId)
        .eq("plan_date", planDate)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("checklist_items")
        .select("*")
        .eq("user_id", userId)
        .eq("plan_date", planDate)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    // A newer reload started while we were awaiting — drop this (possibly stale)
    // result so it can't clobber the fresher one.
    if (gen !== reloadGenRef.current) return;
    if (gRes.error || iRes.error) {
      // Offline / transient — keep whatever the cache painted.
      setLoading(false);
      return;
    }
    commit((gRes.data ?? []) as ChecklistGroup[], (iRes.data ?? []) as ChecklistItem[]);
    setLoading(false);
  }, [userId, planDate, commit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Refresh when the app/tab regains focus (cheap cross-device freshness).
  useEffect(() => {
    if (!userId) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [userId, reload]);

  // ── reminder: reschedule whenever this day's items change ───────────────
  useEffect(() => {
    if (!userId) return;
    void scheduleChecklistReminder(items, planDate, eveningNudgeTime);
  }, [items, planDate, eveningNudgeTime, userId]);

  // ── remote write helpers (optimistic already applied; offline fallback) ─
  const insertGroup = async (row: ChecklistGroup) => {
    try {
      const { error } = await supabase.from("checklist_groups").insert(row);
      if (error) throw error;
    } catch {
      await enqueueWrite({ table: "checklist_groups", op: "insert", payload: row });
    }
  };
  const updateGroup = async (
    id: string,
    patch: Database["public"]["Tables"]["checklist_groups"]["Update"],
  ) => {
    try {
      const { error } = await supabase.from("checklist_groups").update(patch).eq("id", id);
      if (error) throw error;
    } catch {
      await enqueueWrite({ table: "checklist_groups", op: "update", payload: patch, filter: { id } });
    }
  };
  const deleteGroupRow = async (id: string) => {
    try {
      const { error } = await supabase.from("checklist_groups").delete().eq("id", id);
      if (error) throw error;
    } catch {
      await enqueueWrite({ table: "checklist_groups", op: "delete", filter: { id } });
    }
  };
  const insertItem = async (row: ChecklistItem) => {
    try {
      const { error } = await supabase.from("checklist_items").insert(row);
      if (error) throw error;
    } catch {
      await enqueueWrite({ table: "checklist_items", op: "insert", payload: row });
    }
  };
  const updateItem = async (
    id: string,
    patch: Database["public"]["Tables"]["checklist_items"]["Update"],
  ) => {
    try {
      const { error } = await supabase.from("checklist_items").update(patch).eq("id", id);
      if (error) throw error;
    } catch {
      await enqueueWrite({ table: "checklist_items", op: "update", payload: patch, filter: { id } });
    }
  };
  const deleteItemRow = async (id: string) => {
    try {
      const { error } = await supabase.from("checklist_items").delete().eq("id", id);
      if (error) throw error;
    } catch {
      await enqueueWrite({ table: "checklist_items", op: "delete", filter: { id } });
    }
  };

  // ── public CRUD ─────────────────────────────────────────────────────────
  const addGroup = useCallback(
    (title: string): ChecklistGroup | null => {
      const trimmed = title.trim();
      if (!userId || !trimmed) return null;
      const row: ChecklistGroup = {
        id: newId(),
        user_id: userId,
        plan_date: planDate,
        title: trimmed,
        position: maxPos(groupsRef.current) + 1,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      commit([...groupsRef.current, row], itemsRef.current);
      void insertGroup(row);
      return row;
    },
    [userId, planDate, commit],
  );

  const renameGroup = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      commit(
        groupsRef.current.map((g) => (g.id === id ? { ...g, title: trimmed } : g)),
        itemsRef.current,
      );
      void updateGroup(id, { title: trimmed });
    },
    [commit],
  );

  const deleteGroup = useCallback(
    (id: string) => {
      // DB cascades items; mirror that locally.
      commit(
        groupsRef.current.filter((g) => g.id !== id),
        itemsRef.current.filter((i) => i.group_id !== id),
      );
      void deleteGroupRow(id);
    },
    [commit],
  );

  const addItem = useCallback(
    (title: string, groupId: string | null = null): ChecklistItem | null => {
      const trimmed = title.trim();
      if (!userId || !trimmed) return null;
      const siblings = itemsRef.current.filter((i) => i.group_id === groupId);
      const row: ChecklistItem = {
        id: newId(),
        user_id: userId,
        plan_date: planDate,
        group_id: groupId,
        title: trimmed,
        done: false,
        position: maxPos(siblings) + 1,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      commit(groupsRef.current, [...itemsRef.current, row]);
      void insertItem(row);
      return row;
    },
    [userId, planDate, commit],
  );

  const toggleItem = useCallback(
    (id: string) => {
      let nextDone = false;
      commit(
        groupsRef.current,
        itemsRef.current.map((i) => {
          if (i.id !== id) return i;
          nextDone = !i.done;
          return { ...i, done: nextDone };
        }),
      );
      void updateItem(id, { done: nextDone });
    },
    [commit],
  );

  const renameItem = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      commit(
        groupsRef.current,
        itemsRef.current.map((i) => (i.id === id ? { ...i, title: trimmed } : i)),
      );
      void updateItem(id, { title: trimmed });
    },
    [commit],
  );

  const deleteItem = useCallback(
    (id: string) => {
      commit(groupsRef.current, itemsRef.current.filter((i) => i.id !== id));
      void deleteItemRow(id);
    },
    [commit],
  );

  /**
   * Move an item to another category and/or another date.
   * - When `date` differs from the current day, the item leaves this view; on
   *   the target day it lands ungrouped (the target may not have this category).
   * - Otherwise only its `group_id` changes (appended to the target section).
   */
  const moveItem = useCallback(
    (id: string, target: MoveTarget) => {
      const cur = itemsRef.current.find((i) => i.id === id);
      if (!cur) return;
      const toAnotherDay = target.date != null && target.date !== planDate;
      if (toAnotherDay) {
        commit(groupsRef.current, itemsRef.current.filter((i) => i.id !== id));
        void updateItem(id, { plan_date: target.date, group_id: null });
        return;
      }
      if (target.groupId !== undefined && target.groupId !== cur.group_id) {
        const siblings = itemsRef.current.filter((i) => i.group_id === target.groupId);
        const position = maxPos(siblings) + 1;
        commit(
          groupsRef.current,
          itemsRef.current.map((i) =>
            i.id === id ? { ...i, group_id: target.groupId ?? null, position } : i,
          ),
        );
        void updateItem(id, { group_id: target.groupId ?? null, position });
      }
    },
    [planDate, commit],
  );

  /**
   * Apply a drag-computed ordering. The view passes the full next items array
   * (with updated group_id / position already set); we persist only the rows
   * whose group_id or position actually changed.
   */
  const reorder = useCallback(
    (nextItems: ChecklistItem[]) => {
      const prev = new Map(itemsRef.current.map((i) => [i.id, i]));
      commit(groupsRef.current, nextItems);
      for (const it of nextItems) {
        const before = prev.get(it.id);
        if (!before) continue;
        if (before.group_id !== it.group_id || before.position !== it.position) {
          void updateItem(it.id, { group_id: it.group_id, position: it.position });
        }
      }
    },
    [commit],
  );

  const deleteItems = useCallback((itemIds: string[]) => {
    if (!userId || itemIds.length === 0) return;
    const idsSet = new Set(itemIds);
    commit(groupsRef.current, itemsRef.current.filter((i) => !idsSet.has(i.id)));
    (async () => {
      try {
        const { error } = await supabase
          .from("checklist_items")
          .delete()
          .in("id", itemIds);
        if (error) throw error;
      } catch {
        for (const id of itemIds) {
          await enqueueWrite({ table: "checklist_items", op: "delete", filter: { id } });
        }
      }
    })();
  }, [userId, commit]);

  const moveItemsToDate = useCallback((itemIds: string[], targetDate: string) => {
    if (!userId || itemIds.length === 0) return;
    const idsSet = new Set(itemIds);
    // Optimistically remove them from the current view
    commit(groupsRef.current, itemsRef.current.filter((i) => !idsSet.has(i.id)));
    (async () => {
      try {
        const { error } = await supabase
          .from("checklist_items")
          // MUST null group_id: the source group doesn't exist on the target
          // day, so a carried item that kept its group_id would render in
          // neither the group nor the ungrouped list (orphaned/invisible). This
          // path is for ungrouped carries; grouped carries use moveGroupToDate.
          .update({ plan_date: targetDate, group_id: null })
          .in("id", itemIds);
        if (error) throw error;
      } catch {
        // Fallback to queue
        for (const id of itemIds) {
          await enqueueWrite({ table: "checklist_items", op: "update", filter: { id }, payload: { plan_date: targetDate, group_id: null } });
        }
      }
    })();
  }, [userId, commit]);

  /**
   * Carry a whole category to another day, PRESERVING the grouping: find (or
   * create) a same-named list on the target day and move the items into it.
   * `mode` "unfinished" carries only open items (the source list keeps its done
   * ones); "all" carries everything. Items are never orphaned — they always land
   * inside a real group on the target day.
   */
  const moveGroupToDate = useCallback(
    (group: ChecklistGroup, targetDate: string, mode: "unfinished" | "all") => {
      if (!userId) return;
      const groupItems = itemsRef.current.filter((i) => i.group_id === group.id);
      const targets = mode === "unfinished" ? groupItems.filter((i) => !i.done) : groupItems;
      if (targets.length === 0) return;
      const ids = targets.map((i) => i.id);
      const idsSet = new Set(ids);
      // Optimistically remove the carried items from this day.
      commit(groupsRef.current, itemsRef.current.filter((i) => !idsSet.has(i.id)));

      // Generate the fallback group id up-front so both the online and offline
      // paths use THE SAME id — fixes a race where the offline fallback could
      // enqueue items pointing at freshGroupId while the online path had already
      // written them to a *different* (found) group id, leaving items orphaned.
      const freshGroupId = newId();
      const groupRow: ChecklistGroup = {
        id: freshGroupId,
        user_id: userId,
        plan_date: targetDate,
        title: group.title,
        position: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      (async () => {
        // Resolve the target group id FIRST — we need it before we can write
        // items, so the online and offline paths both finish with the same id.
        let targetGroupId: string;
        let groupResolved = false;
        try {
          // Reuse a same-named list on the target day if present, so repeated
          // carries don't pile up duplicate categories.
          const { data: existing } = await supabase
            .from("checklist_groups")
            .select("id")
            .eq("user_id", userId)
            .eq("plan_date", targetDate)
            .eq("title", group.title)
            .limit(1)
            .maybeSingle();
          if (existing?.id) {
            targetGroupId = existing.id;
          } else {
            const { error: gErr } = await supabase.from("checklist_groups").insert(groupRow);
            if (gErr) throw gErr;
            targetGroupId = freshGroupId;
          }
          groupResolved = true;
        } catch {
          // Offline — fall through with freshGroupId; queue the insert below.
          targetGroupId = freshGroupId;
        }

        // Now update the items to the resolved group.
        let itemsWritten = false;
        if (groupResolved) {
          try {
            const { error: iErr } = await supabase
              .from("checklist_items")
              .update({ plan_date: targetDate, group_id: targetGroupId })
              .in("id", ids);
            if (iErr) throw iErr;
            itemsWritten = true;
          } catch {
            // Partial failure — fall through to queue.
          }
        }

        // Queue anything that didn't make it online. FIFO order: group first,
        // then items, so the list exists before the items reference it.
        if (!groupResolved) {
          await enqueueWrite({ table: "checklist_groups", op: "insert", payload: groupRow });
        }
        if (!itemsWritten) {
          for (const id of ids) {
            await enqueueWrite({
              table: "checklist_items",
              op: "update",
              filter: { id },
              payload: { plan_date: targetDate, group_id: targetGroupId },
            });
          }
        }
      })();
    },
    [userId, commit],
  );

  const clearCompleted = useCallback(() => {
    if (!userId) return;
    const doneIds = itemsRef.current.filter((i) => i.done).map((i) => i.id);
    if (doneIds.length === 0) return;
    commit(groupsRef.current, itemsRef.current.filter((i) => !i.done));
    (async () => {
      try {
        const { error } = await supabase
          .from("checklist_items")
          .delete()
          .eq("user_id", userId)
          .eq("plan_date", planDate)
          .eq("done", true);
        if (error) throw error;
      } catch {
        for (const id of doneIds) {
          await enqueueWrite({ table: "checklist_items", op: "delete", filter: { id } });
        }
      }
    })();
  }, [userId, planDate, commit]);

  /** Wipe the ENTIRE checklist for this day — every item AND every category.
   *  Scoped by plan_date so it only ever touches checklist tables (never the
   *  timeline `blocks`/`plans`). Items are deleted before groups. */
  const deleteAllForDay = useCallback(() => {
    if (!userId) return;
    const itemIds = itemsRef.current.map((i) => i.id);
    const groupIds = groupsRef.current.map((g) => g.id);
    if (itemIds.length === 0 && groupIds.length === 0) return;
    commit([], []); // optimistic: clear the whole day
    (async () => {
      try {
        const delItems = await supabase
          .from("checklist_items")
          .delete()
          .eq("user_id", userId)
          .eq("plan_date", planDate);
        if (delItems.error) throw delItems.error;
        const delGroups = await supabase
          .from("checklist_groups")
          .delete()
          .eq("user_id", userId)
          .eq("plan_date", planDate);
        if (delGroups.error) throw delGroups.error;
      } catch {
        for (const id of itemIds) {
          await enqueueWrite({ table: "checklist_items", op: "delete", filter: { id } });
        }
        for (const id of groupIds) {
          await enqueueWrite({ table: "checklist_groups", op: "delete", filter: { id } });
        }
      }
    })();
  }, [userId, planDate, commit]);

  return {
    groups,
    items,
    loading,
    reload,
    addGroup,
    renameGroup,
    deleteGroup,
    addItem,
    toggleItem,
    renameItem,
    deleteItem,
    moveItem,
    reorder,
    clearCompleted,
    deleteItems,
    moveItemsToDate,
    moveGroupToDate,
    deleteAllForDay,
  };
}
