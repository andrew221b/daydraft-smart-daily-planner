import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { GripVertical, FolderPlus, Folder, ListChecks, Trash2, Pencil, X, CalendarDays, Copy, Pin, PinOff, Flag, ChevronDown, Palette, Check, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DayPickerSheet } from "@/components/app/DayPickerSheet";
import { ChecklistGroup, ChecklistItemRow, AddItemRow, CheckCircleAccent, ProgressRing, useRowGestures } from "@/components/app/ChecklistGroup";
import { ChecklistItemSheet } from "@/components/app/ChecklistItemSheet";
import { ChecklistDumpSheet } from "@/components/app/ChecklistDumpSheet";
import { useChecklist, type ChecklistGroup as Group, type ChecklistItem } from "@/hooks/useChecklist";
import { useEntitlement } from "@/hooks/useEntitlement";
import { supabase } from "@/integrations/supabase/client";
import { parseBulkTasks, extractDurationFromTitle, extractStartTimeFromTitle, splitShoppingEnumeration } from "@/lib/taskSplitter";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import { todayDateStr } from "@/lib/daydraft";
import {
  checklistCategoryTint,
  checklistTintVars,
  resolveChecklistTints,
  tintAt,
  setColorOverride,
  getColorOverrides,
  swatchGradient,
  CHECKLIST_CATEGORY_PALETTE,
  type ChecklistTint,
} from "@/lib/checklistColors";

const UNGROUPED = "ungrouped";

/** Thin droppable wrapper for the flat (ungrouped) section. */
function Droppable({
  id,
  isActive,
  children,
}: {
  id: string;
  isActive: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`relative z-10 px-3 transition-colors ${isActive && isOver ? "bg-accent/[0.06]" : ""}`}
    >
      <div className="divide-y divide-border/25">{children}</div>
    </div>
  );
}

export interface ChecklistApi {
  getUngroupedUnfinishedItems: () => ChecklistItem[];
  getAllItems: () => ChecklistItem[];
  moveItemsToDate: (itemIds: string[], targetDate: string) => Promise<void>;
  deleteItems: (itemIds: string[]) => void;
  copyPlanAsText: () => void;
  /** Enter multi-select mode (triggered from the day's "…" menu). */
  enterSelectMode: () => void;
  /** Wipe every item AND category for the day (the "…" → Delete action). */
  deleteAllForDay: () => void;
}

export interface ChecklistViewProps {
  userId: string | undefined;
  viewDate: string;
  eveningNudgeTime?: string;
  onChange?: () => void;
}

export const ChecklistView = forwardRef<ChecklistApi, ChecklistViewProps>(({
  userId,
  viewDate,
  eveningNudgeTime,
  onChange,
}, ref) => {
  const {
    groups,
    items,
    loading,
    addGroup,
    renameGroup,
    deleteGroup,
    addItem,
    addItems,
    toggleItem,
    toggleItemFailed,
    renameItem,
    deleteItem,
    togglePinGroup,
    togglePinItem,
    togglePriorityItem,
    moveItem,
    reorder,
    deleteItems,
    moveItemsToDate,
    moveGroupToDate,
    deleteAllForDay,
  } = useChecklist(userId, viewDate, eveningNudgeTime);

  const { isPro } = useEntitlement();

  // ── Brain dump (paste a wall of to-dos → AI/local split → bulk add) ─────
  const [dumpOpen, setDumpOpen] = useState(false);

  // Pending duplicate resolution: set when confirmDump finds existing items.
  const [dupPending, setDupPending] = useState<{
    uniqueTitles: string[];
    dupTitles: string[];
    targetGroupId: string | null;
  } | null>(null);

  const parseDump = useCallback(async (raw: string): Promise<string[]> => {
    if (isPro) {
      try {
        // mode:"checklist" → the edge fn uses its dedicated splitter that breaks
        // a free-form / spoken dump ("купить молоко яйца хлеб корм для кошки")
        // into individual tickable items, instead of the timeline parser that
        // would group it into one shopping errand.
        const { data, error } = await supabase.functions.invoke("parse-tasks", {
          body: { raw_input: raw, mode: "checklist" },
        });
        if (error) throw error;
        const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
        if (tasks.length > 0) return tasks.map((t: { title: string }) => t.title).filter(Boolean);
      } catch (e) {
        console.warn("Checklist dump AI parse failed, falling back to local split", e);
      }
    }
    // Free tier or AI failure: local split. On top of the normal connector/line
    // split, fan out spoken shopping lists ("купить молоко хлеб яйца") into one
    // item each — the AI parser does this by meaning, this is the offline
    // fallback. Then strip any duration/time annotations the splitter recognizes
    // (irrelevant here — checklist items carry only a clean title).
    return parseBulkTasks(raw)
      .flatMap((rawTitle) => splitShoppingEnumeration(rawTitle))
      .map((rawTitle) => {
        const { title: t1 } = extractDurationFromTitle(rawTitle);
        const { title } = extractStartTimeFromTitle(t1 || rawTitle);
        return title || rawTitle;
      }).filter(Boolean);
  }, [isPro]);

  const confirmDump = useCallback((titles: string[], groupId: string | null) => {
    const existing = new Set(
      items.filter((i) => i.group_id === groupId).map((i) => i.title.trim().toLowerCase()),
    );
    const uniqueTitles: string[] = [];
    const dupTitles: string[] = [];
    const seenInBatch = new Set<string>();
    for (const title of titles) {
      const key = title.trim().toLowerCase();
      if (!key || seenInBatch.has(key)) continue;
      seenInBatch.add(key);
      if (existing.has(key)) dupTitles.push(title);
      else uniqueTitles.push(title);
    }
    if (uniqueTitles.length === 0 && dupTitles.length === 0) {
      toast("No to-dos found.");
      return;
    }
    if (dupTitles.length === 0) {
      // No duplicates — add everything immediately (single commit, all items visible at once).
      addItems(uniqueTitles, groupId);
      const where = groupId ? (groups.find((g) => g.id === groupId)?.title ?? "list") : "";
      toast.success(`Added ${uniqueTitles.length} item${uniqueTitles.length === 1 ? "" : "s"}${where ? ` to ${where}` : ""}`);
      return;
    }
    // Duplicates found — surface the resolution dialog instead of silently skipping.
    setDupPending({ uniqueTitles, dupTitles, targetGroupId: groupId });
  }, [addItems, items, groups]);

  // Create a list from inside the brain-dump picker. addGroup commits
  // optimistically and returns the row synchronously, so the new pill shows up
  // on the dump sheet's next render (it reads the same `groups`).
  const createDumpGroup = useCallback((name: string): string | null => {
    const g = addGroup(name);
    return g?.id ?? null;
  }, [addGroup]);

  // ── Multi-select ────────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMoveOpen, setSelectMoveOpen] = useState(false);
  const [selectGroupOpen, setSelectGroupOpen] = useState(false);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const [activeId, setActiveId] = useState<string | null>(null);
  // Bumped whenever a category colour override changes so the tint map recomputes.
  const [colorTick, setColorTick] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("dd_checklist_collapsed");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("dd_checklist_collapsed", JSON.stringify(Array.from(collapsed)));
    } catch {
      // Ignore storage errors
    }
  }, [collapsed]);
  const [sheetItem, setSheetItem] = useState<ChecklistItem | null>(null);
  const [datePickItem, setDatePickItem] = useState<ChecklistItem | null>(null);
  const [datePickGroup, setDatePickGroup] = useState<{ id: string; mode: "unfinished" | "all" } | null>(null);
  const [groupMenu, setGroupMenu] = useState<Group | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [autoFocusGroupId, setAutoFocusGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const groupInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // delay: how long a finger must be held before drag activates. tolerance:
    // how many px of movement are allowed during that delay before the gesture
    // is cancelled. Both raised from 150/8 → 250/14 because a quick tap that
    // moves 8px (a totally normal finger-lift) was activating drag, causing
    // dnd-kit to animate items into "new" positions and snap back on release —
    // this looked like the list was randomly reordering on a tap.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 14 } }),
  );

  const sortPos = (a: ChecklistItem, b: ChecklistItem) =>
    a.position - b.position || a.created_at.localeCompare(b.created_at);

  // Pinned categories / loose items "hang" on every day in a separated section;
  // the rest is the normal date-scoped, drag-and-drop workspace below.
  const isFutureDay = viewDate > todayDateStr();

  const dayGroups = useMemo(() => groups.filter((g) => !g.pinned), [groups]);
  const pinnedGroups = useMemo(() => {
    const pinned = groups.filter((g) => g.pinned);
    if (!isFutureDay) return pinned;
    return pinned.filter((g) =>
      items.filter((i) => i.group_id === g.id).some((i) => !i.done),
    );
  }, [groups, items, isFutureDay]);
  const ungrouped = useMemo(
    () => items.filter((i) => i.group_id === null && !i.pinned).sort(sortPos),
    [items],
  );
  const pinnedUngrouped = useMemo(
    () => items.filter((i) => i.group_id === null && i.pinned && (!isFutureDay || !i.done)).sort(sortPos),
    [items, isFutureDay],
  );
  const hasPinned = pinnedGroups.length > 0 || pinnedUngrouped.length > 0;
  const itemsByGroup = useMemo(() => {
    const m = new Map<string, ChecklistItem[]>();
    for (const g of groups) m.set(g.id, []);
    for (const i of items) {
      if (i.group_id && m.has(i.group_id)) m.get(i.group_id)!.push(i);
    }
    for (const arr of m.values()) arr.sort(sortPos);
    return m;
  }, [items, groups]);

  // Resolve each category's colour: user override → pinned hash → least-used (so
  // colours don't repeat within the day). Stable order (created_at) means adding
  // a list appends a fresh colour without reshuffling the others. `colorTick`
  // forces a recompute after an override changes.
  const colorMap = useMemo(() => {
    void colorTick; // recompute after an override changes (overrides live outside React state)
    const ordered = [...groups].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return resolveChecklistTints(ordered);
  }, [groups, colorTick]);
  const tintOf = useCallback(
    (groupId: string): ChecklistTint =>
      colorMap.has(groupId) ? tintAt(colorMap.get(groupId)!) : checklistCategoryTint(groupId),
    [colorMap],
  );
  const setCategoryColor = useCallback((groupId: string, index: number | null) => {
    setColorOverride(groupId, index);
    setColorTick((t) => t + 1);
    haptics.tap();
  }, []);

  // Progress must reflect what's ACTUALLY on screen, not the raw item set. On a
  // future day the display hides pinned items that are already done (both
  // pinnedUngrouped and each PinnedGroupCard apply `!isFutureDay || !i.done`),
  // so counting raw `items` showed "1 / 1 done" with an empty list. Mirror the
  // exact visible buckets so the count and the list can never disagree.
  const visibleItems = useMemo(() => {
    const out: ChecklistItem[] = [...ungrouped, ...pinnedUngrouped];
    for (const g of dayGroups) out.push(...(itemsByGroup.get(g.id) ?? []));
    for (const g of pinnedGroups) {
      out.push(...(itemsByGroup.get(g.id) ?? []).filter((i) => !isFutureDay || !i.done));
    }
    return out;
  }, [ungrouped, pinnedUngrouped, dayGroups, pinnedGroups, itemsByGroup, isFutureDay]);
  const total = visibleItems.length;
  const done = visibleItems.filter((i) => i.done).length;
  const activeItem = activeId ? items.find((i) => i.id === activeId) ?? null : null;
  const isEmpty = !loading && groups.length === 0 && items.length === 0;

  useImperativeHandle(ref, () => ({
    getUngroupedUnfinishedItems: () => ungrouped.filter((i) => !i.done),
    getAllItems: () => items,
    moveItemsToDate: async (ids: string[], date: string) => { moveItemsToDate(ids, date); },
    deleteItems: (ids: string[]) => deleteItems(ids),
    copyPlanAsText: () => {
      let text = "";
      if (ungrouped.length > 0) {
        text += ungrouped.map((i) => {
          if (i.done) return `✓ ${i.title.split('').map(c => c + '\u0336').join('')}`;
          return `• ${i.title}`;
        }).join("\n") + "\n\n";
      }
      groups.forEach((g) => {
        const gItems = itemsByGroup.get(g.id) || [];
        if (gItems.length > 0) {
          text += `**${g.title}**\n`;
          text += gItems.map((i) => {
            if (i.done) return `✓ ${i.title.split('').map(c => c + '\u0336').join('')}`;
            return `• ${i.title}`;
          }).join("\n") + "\n\n";
        }
      });
      if (navigator.clipboard) {
        void navigator.clipboard.writeText(text.trim());
        haptics.notify("success");
      }
    },
    enterSelectMode: () => {
      setSelectedIds(new Set());
      setSelectMode(true);
    },
    deleteAllForDay: () => deleteAllForDay(),
  }), [ungrouped, items, groups, itemsByGroup, moveItemsToDate, deleteItems, deleteAllForDay]);

  const selectedCount = selectedIds.size;
  // Drop any selected ids whose item is gone (deleted/moved) so the count stays
  // truthful. Leaving select mode when the day empties keeps the UI honest.
  useEffect(() => {
    if (!selectMode) return;
    if (items.length === 0) { exitSelect(); return; }
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const existing = new Set(items.map((i) => i.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) { if (existing.has(id)) next.add(id); else changed = true; }
      return changed ? next : prev;
    });
  }, [items, selectMode, exitSelect]);

  const deleteSelected = () => {
    if (selectedCount === 0) return;
    deleteItems(Array.from(selectedIds));
    haptics.notify("success");
    exitSelect();
  };

  const moveSelectedToDate = (ymd: string) => {
    if (selectedCount === 0 || ymd === viewDate) { setSelectMoveOpen(false); return; }
    // Mixed selection (across categories) → land them ungrouped on the target.
    moveItemsToDate(Array.from(selectedIds), ymd);
    haptics.notify("success");
    setSelectMoveOpen(false);
    exitSelect();
  };

  const moveSelectedToGroup = (targetGroupId: string | null) => {
    if (selectedIds.size === 0) return;
    const idsSet = selectedIds;
    const siblings = items.filter(
      (i) => !idsSet.has(i.id) && (i.group_id ?? null) === targetGroupId,
    );
    const basePos = siblings.length > 0 ? Math.max(...siblings.map((i) => i.position)) + 1 : 0;
    let offset = 0;
    const nextItems = items.map((i) =>
      idsSet.has(i.id) ? { ...i, group_id: targetGroupId, position: basePos + offset++ } : i,
    );
    reorder(nextItems);
    haptics.notify("success");
    setSelectGroupOpen(false);
    exitSelect();
  };

  const selectAll = () => {
    haptics.tap();
    setSelectedIds(new Set(items.map((i) => i.id)));
  };

  // Let the parent (DayView) refresh its switcher badge from the cache.
  useEffect(() => {
    onChange?.();
  }, [items, groups, onChange]);

  // ── drag: resolve which container a drop target belongs to ───────────────
  const containerOf = (id: string): string => {
    if (id === UNGROUPED || groups.some((g) => g.id === id)) return id;
    const it = items.find((i) => i.id === id);
    return it?.group_id ?? UNGROUPED;
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    if (activeKey === overKey) return;

    const from = containerOf(activeKey);
    const to = containerOf(overKey);
    const overIsContainer = overKey === UNGROUPED || groups.some((g) => g.id === overKey);

    let next: ChecklistItem[];
    if (from === to && !overIsContainer) {
      // Reorder within the same container — arrayMove matches dnd-kit's live
      // preview (insert-before would land off-by-one on downward drags).
      const containerItems = items.filter((i) => (i.group_id ?? UNGROUPED) === to).sort(sortPos);
      const ids = containerItems.map((i) => i.id);
      const oldIndex = ids.indexOf(activeKey);
      const newIndex = ids.indexOf(overKey);
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(containerItems, oldIndex, newIndex);
      const others = items.filter((i) => (i.group_id ?? UNGROUPED) !== to);
      next = [...others, ...reordered];
    } else {
      // Move across containers (or onto an empty container's drop zone).
      const arr = [...items];
      const activeIdx = arr.findIndex((i) => i.id === activeKey);
      if (activeIdx < 0) return;
      const [moved] = arr.splice(activeIdx, 1);
      const movedNext: ChecklistItem = { ...moved, group_id: to === UNGROUPED ? null : to };
      let insertAt: number;
      if (overIsContainer) {
        let last = -1;
        arr.forEach((i, idx) => {
          if ((i.group_id ?? UNGROUPED) === to) last = idx;
        });
        insertAt = last + 1;
      } else {
        insertAt = arr.findIndex((i) => i.id === overKey);
        if (insertAt < 0) insertAt = arr.length;
      }
      arr.splice(insertAt, 0, movedNext);
      next = arr;
    }

    // Re-number positions per container by their new array order.
    const counters: Record<string, number> = {};
    const renumbered = next.map((i) => {
      const c = i.group_id ?? UNGROUPED;
      const pos = counters[c] ?? 0;
      counters[c] = pos + 1;
      return i.position === pos ? i : { ...i, position: pos };
    });
    haptics.tap();
    reorder(renumbered);
  };

  // The row gestures own their own haptics (impact on tap/double/long), so these
  // wrappers stay thin — no extra buzz.
  const handleToggle = (id: string) => {
    toggleItem(id);
  };
  const handleFailed = (id: string) => {
    toggleItemFailed(id);
  };

  // Keep the inline "Add list" field above the soft keyboard. It sits at the
  // very bottom of the scrolling page, so on focus and after each add (the
  // global keyboard handler only fires on the keyboard's open transition) we
  // re-center it ourselves — otherwise it slips under the keyboard.
  const revealGroupInput = (delay = 0) => {
    window.setTimeout(() => {
      try {
        // `auto` (instant), not `smooth` — smooth fights the keyboard animation
        // on iOS WKWebView and causes the input to freeze/jank.
        groupInputRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
      } catch {
        /* WKWebView can throw on an early scroll root — safe to ignore */
      }
    }, delay);
  };

  const submitGroup = () => {
    const t = groupDraft.trim();
    if (!t) {
      setAddingGroup(false);
      return;
    }
    const created = addGroup(t);
    setGroupDraft("");
    setAddingGroup(false);
    if (created) {
      setAutoFocusGroupId(created.id);
    }
  };

  return (
    <div className={`mt-4 space-y-3 ${selectMode ? "pb-24" : ""}`}>
      {/* Selection header (replaces the progress card while picking items) */}
      {selectMode ? (
        <div className="relative app-card checklist-surface no-chrome-border rounded-[18px] px-4 py-3 flex items-center justify-between gap-2">
          <div className="text-[14px] font-semibold text-foreground/95 tabular-nums">
            {selectedCount > 0 ? `${selectedCount} selected` : "Select items"}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={selectAll}
              className="h-8 px-3 rounded-full text-[12.5px] font-semibold pressable transition-colors"
              style={{ color: "hsl(var(--accent))", background: "hsl(var(--accent) / 0.12)" }}
            >
              Select all
            </button>
            <button
              onClick={exitSelect}
              className="h-8 px-3 rounded-full text-[12.5px] font-semibold text-secondary-fg/85 hover:text-foreground pressable transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        total > 0 && (
          <div className="relative app-card checklist-surface no-chrome-border rounded-[18px] px-4 py-3.5">
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="text-[13.5px] text-foreground/95 tabular-nums shrink-0">
                  <span className="font-bold text-[15px]">{done}</span>
                  <span className="text-secondary-fg/60 font-normal"> / {total} done</span>
                </div>
                <div className="flex-1 min-w-0" />
                {done > 0 && (
                  <span className="text-[12px] font-semibold shrink-0" style={{ color: "hsl(var(--accent))" }}>
                    {done === total ? "All done!" : "Keep going!"}
                  </span>
                )}
              </div>
              <div className="h-2 rounded-full bg-muted/50 overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]">
                <div
                  className="accent-grad-h h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: total ? `${(done / total) * 100}%` : "0%",
                    boxShadow: done > 0 ? "0 0 10px hsl(var(--accent) / 0.6)" : "none",
                  }}
                />
              </div>
            </div>
          </div>
        )
      )}

      {/* ── Pinned section — categories / loose items kept on every day,
          separated above the day's workspace (like the timeline's Past
          divider). Rendered OUTSIDE the DnD context: pinned rows are standing,
          you check / unpin them, they aren't reordered with the day. ── */}
      {hasPinned && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Pin className="h-3 w-3 text-secondary-fg/50" strokeWidth={2.5} />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-secondary-fg/50">Pinned</span>
            <div className="flex-1 h-px bg-border/40" />
          </div>
          {pinnedUngrouped.length > 0 && (
            <div className="app-card checklist-surface rounded-[20px] overflow-hidden">
              {pinnedUngrouped.map((i) => (
                <PinnedRow
                  key={i.id}
                  item={i}
                  onToggle={toggleItem}
                  onFailed={toggleItemFailed}
                  onUnpin={() => togglePinItem(i.id)}
                  onOpen={() => setSheetItem(i)}
                />
              ))}
            </div>
          )}
          {pinnedGroups.map((g) => (
            <PinnedGroupCard
              key={g.id}
              group={g}
              items={(itemsByGroup.get(g.id) ?? []).filter((i) => !isFutureDay || !i.done)}
              collapsed={collapsed.has(g.id)}
              tint={tintOf(g.id)}
              onToggleCollapse={() => setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                return next;
              })}
              onToggle={toggleItem}
              onFailed={toggleItemFailed}
              onUnpin={() => togglePinGroup(g.id)}
              onOpenItem={(i) => setSheetItem(i)}
            />
          ))}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        {/* Flat / ungrouped section — quick to-dos with no category. One lifted
            3D card, flat divided rows, ending in the quiet add row. */}
        {ungrouped.length > 0 && (
          <div className="flex items-center gap-2 px-1 mt-6 mb-2">
            <ListChecks className="h-3 w-3 text-secondary-fg/50" strokeWidth={2.5} />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-secondary-fg/50">No category</span>
            <div className="flex-1 h-px bg-border/40" />
          </div>
        )}

        <div className="relative app-card checklist-surface rounded-[20px] overflow-hidden">
          <Droppable id={UNGROUPED} isActive={!!activeId}>
            <SortableContext items={ungrouped.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {ungrouped.map((i) => (
                <ChecklistItemRow
                  key={i.id}
                  item={i}
                  onToggle={handleToggle}
                  onFailed={handleFailed}
                  onOpenSheet={setSheetItem}
                  selectMode={selectMode}
                  selected={selectedIds.has(i.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </SortableContext>
            {ungrouped.length === 0 && activeId && (
              <div className="text-center text-[12px] font-medium text-accent py-2.5">
                Drop here for no category
              </div>
            )}
            {!selectMode && <AddItemRow onAdd={(t) => addItem(t, null)} />}
          </Droppable>
        </div>

        {/* Categories separator — same thin-label style as "No category" */}
        {dayGroups.length > 0 && (
          <div className="flex items-center gap-2 px-1 mt-6 mb-1">
            <Folder className="h-3 w-3 text-secondary-fg/50" strokeWidth={2.5} />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-secondary-fg/50">Categories</span>
            <div className="flex-1 h-px bg-border/40" />
          </div>
        )}

        {/* Categories (day workspace — pinned ones render in the section above) */}
        {dayGroups.map((g) => (
          <ChecklistGroup
            key={g.id}
            group={g}
            items={itemsByGroup.get(g.id) ?? []}
            collapsed={collapsed.has(g.id)}
            dragging={!!activeId}
            tint={tintOf(g.id)}
            onToggleCollapse={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(g.id)) next.delete(g.id);
                else next.add(g.id);
                return next;
              })
            }
            onOpenGroupMenu={setGroupMenu}
            onToggleItem={handleToggle}
            onFailedItem={handleFailed}
            onOpenItemSheet={setSheetItem}
            onAddItem={(t, gid) => addItem(t, gid)}
            autoFocusAdd={autoFocusGroupId === g.id}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
        ))}

        <DragOverlay>
          {activeItem && (
            <div
              className="relative app-card checklist-surface rounded-2xl flex items-center gap-1.5 px-3 py-2.5 ring-2 ring-accent/40"
              style={{
                boxShadow: "0 18px 40px -10px rgba(0,0,0,0.6), 0 0 0 0.5px hsl(var(--accent) / 0.3)",
                // Keep the dragged ghost in its category's colour (ungrouped → page accent).
                ...(activeItem.group_id ? checklistTintVars(tintOf(activeItem.group_id)) : {}),
              }}
            >
              <span className="relative z-10 shrink-0 flex h-7 w-6 items-center justify-center" style={{ color: "hsl(var(--accent))" }}>
                <GripVertical className="h-3.5 w-3.5" />
              </span>
              <span className="relative z-10 flex-1 min-w-0 text-[14.5px] font-medium leading-snug break-words text-foreground/95">
                {activeItem.title}
              </span>
              <span className="relative z-10 shrink-0 h-9 w-9 -mr-1 flex items-center justify-center">
                <CheckCircleAccent done={activeItem.done} />
              </span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Add category — hidden while picking items */}
      {selectMode ? null : addingGroup ? (
        <div className="flex items-center gap-2 rounded-2xl border border-soft bg-card px-3 py-2">
          <FolderPlus className="h-4 w-4 text-accent shrink-0" />
          <input
            ref={groupInputRef}
            autoFocus
            value={groupDraft}
            onChange={(e) => setGroupDraft(e.target.value)}
            onFocus={() => revealGroupInput(300)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitGroup();
              if (e.key === "Escape") {
                setGroupDraft("");
                setAddingGroup(false);
              }
            }}
            onBlur={() => {
              if (!groupDraft.trim()) setAddingGroup(false);
            }}
            placeholder="List name (e.g. Groceries)"
            className="flex-1 min-w-0 bg-transparent text-[14px] outline-none placeholder:text-secondary-fg/45"
            style={{ fontSize: 16 }}
          />
          <button
            onClick={() => {
              setGroupDraft("");
              setAddingGroup(false);
            }}
            className="shrink-0 h-7 w-7 flex items-center justify-center rounded-full text-secondary-fg/55 pressable"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              haptics.tap();
              setAddingGroup(true);
            }}
            className="checklist-add-list-btn flex-1 flex items-center justify-center gap-2 h-12 rounded-2xl border border-dashed text-[13px] font-semibold pressable transition-colors"
            style={{
              color: "hsl(var(--accent))",
              borderColor: "hsl(var(--accent) / 0.45)",
              background: "hsl(var(--accent) / 0.05)",
            }}
          >
            <FolderPlus className="h-4 w-4" strokeWidth={2.25} /> Add list
          </button>
          {/* Brain dump — paste a wall of to-dos, AI/local-split adds them all at
              once. Filled (not dashed) so it reads as the "richer" of the two
              add actions, same accent theme as the rest of the page. */}
          <button
            onClick={() => {
              haptics.tap();
              setDumpOpen(true);
            }}
            className="flex-1 flex items-center justify-center gap-2 h-12 rounded-2xl border text-[13px] font-semibold pressable transition-colors"
            style={{
              color: "hsl(var(--accent))",
              borderColor: "hsl(var(--accent) / 0.35)",
              background: "hsl(var(--accent) / 0.12)",
            }}
          >
            <Sparkles className="h-4 w-4" strokeWidth={2.25} /> Brain dump
          </button>
        </div>
      )}

      <ChecklistDumpSheet
        open={dumpOpen}
        onOpenChange={setDumpOpen}
        groups={groups}
        tintOf={tintOf}
        isPro={isPro}
        parseDump={parseDump}
        onConfirm={confirmDump}
        onCreateGroup={createDumpGroup}
      />

      {/* Duplicate resolution — shown when confirmDump finds items already in the list */}
      <DuplicateResolutionSheet
        pending={dupPending}
        groups={groups}
        onClose={() => setDupPending(null)}
        onSkip={() => {
          if (!dupPending) return;
          if (dupPending.uniqueTitles.length) {
            addItems(dupPending.uniqueTitles, dupPending.targetGroupId);
            const where = dupPending.targetGroupId ? (groups.find((g) => g.id === dupPending.targetGroupId)?.title ?? "list") : "";
            toast.success(`Added ${dupPending.uniqueTitles.length} item${dupPending.uniqueTitles.length === 1 ? "" : "s"}${where ? ` to ${where}` : ""}`);
          } else {
            toast("All items were already in your list.");
          }
          setDupPending(null);
        }}
        onAddAll={() => {
          if (!dupPending) return;
          const all = [...dupPending.uniqueTitles, ...dupPending.dupTitles];
          addItems(all, dupPending.targetGroupId);
          const where = dupPending.targetGroupId ? (groups.find((g) => g.id === dupPending.targetGroupId)?.title ?? "list") : "";
          toast.success(`Added all ${all.length} item${all.length === 1 ? "" : "s"}${where ? ` to ${where}` : ""}`);
          setDupPending(null);
        }}
        onAddToNewList={(name) => {
          if (!dupPending) return;
          const newGroup = addGroup(name);
          if (newGroup) {
            addItems(dupPending.dupTitles, newGroup.id);
            if (dupPending.uniqueTitles.length) {
              addItems(dupPending.uniqueTitles, dupPending.targetGroupId);
            }
            const d = dupPending.dupTitles.length;
            const u = dupPending.uniqueTitles.length;
            const where = dupPending.targetGroupId ? (groups.find((g) => g.id === dupPending.targetGroupId)?.title ?? "list") : "";
            toast.success(
              `Added ${d} to "${name}"` +
              (u ? ` · ${u} to ${where || "no category"}` : ""),
            );
          }
          setDupPending(null);
        }}
      />

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center px-6 pt-8 pb-4 empty-state-fade">
          <div
            className="accent-grad relative mb-5 h-16 w-16 rounded-[22px] flex items-center justify-center mx-auto breathe"
            style={{ boxShadow: "0 10px 30px -6px hsl(var(--accent) / 0.6), inset 0 1px 0 rgba(255,255,255,0.4)" }}
          >
            <div className="absolute inset-0 rounded-[22px] bg-gradient-to-tr from-white/25 to-transparent" />
            <ListChecks className="h-7 w-7 relative z-10 text-white" strokeWidth={2} aria-hidden />
          </div>
          <p className="text-[16px] font-semibold text-foreground/95">A simple checklist</p>
          <p className="text-[13.5px] text-secondary-fg/80 mt-2 leading-relaxed max-w-[280px] mx-auto">
            Untimed to-dos — add items above, or group them into lists like “Groceries”.
          </p>
        </div>
      )}

      {/* Per-item action sheet */}
      <ChecklistItemSheet
        item={sheetItem}
        groups={groups}
        planDate={viewDate}
        onClose={() => setSheetItem(null)}
        onRename={renameItem}
        onMove={moveItem}
        onRequestPickDate={(it) => {
          setSheetItem(null);
          setDatePickItem(it);
        }}
        onDelete={deleteItem}
        onTogglePin={togglePinItem}
        onTogglePriority={togglePriorityItem}
      />

      {/* Move-to-date picker (delegated from the item sheet) */}
      <DayPickerSheet
        open={!!datePickItem}
        onOpenChange={(v) => !v && setDatePickItem(null)}
        value={viewDate}
        onPick={(ymd) => {
          if (datePickItem && ymd !== viewDate) moveItem(datePickItem.id, { date: ymd });
          setDatePickItem(null);
        }}
        pastDays={3}
        futureDays={120}
        title="Move item to day"
      />

      {/* Move-to-date picker for groups */}
      <DayPickerSheet
        open={!!datePickGroup}
        onOpenChange={(v) => !v && setDatePickGroup(null)}
        value={viewDate}
        onPick={(ymd) => {
          if (datePickGroup && ymd !== viewDate) {
            const group = groups.find((g) => g.id === datePickGroup.id);
            if (group) {
              // Preserve the category on the target day (recreates/reuses the
              // list there) so carried items are never orphaned.
              moveGroupToDate(group, ymd, datePickGroup.mode);
              haptics.notify("success");
            }
          }
          setDatePickGroup(null);
        }}
        title="Move to…"
      />

      {/* Group (list) menu */}
      <GroupMenuSheet
        group={groupMenu}
        itemCount={groupMenu ? itemsByGroup.get(groupMenu.id)?.length ?? 0 : 0}
        colorIndex={groupMenu ? colorMap.get(groupMenu.id) ?? 0 : 0}
        colorIsAuto={groupMenu ? !(groupMenu.id in getColorOverrides()) : true}
        onSetColor={(idx) => { if (groupMenu) setCategoryColor(groupMenu.id, idx); }}
        onClose={() => setGroupMenu(null)}
        onRename={renameGroup}
        onDelete={deleteGroup}
        onCarryUnfinished={() => {
          if (groupMenu) setDatePickGroup({ id: groupMenu.id, mode: "unfinished" });
        }}
        onCarryAll={() => {
          if (groupMenu) setDatePickGroup({ id: groupMenu.id, mode: "all" });
        }}
        onTogglePin={() => {
          if (groupMenu) togglePinGroup(groupMenu.id);
        }}
        onCopyAsText={() => {
          if (!groupMenu) return;
          const gItems = itemsByGroup.get(groupMenu.id) || [];
          let text = `**${groupMenu.title}**\n`;
          text += gItems.map((i) => {
            if (i.done) return `✓ ${i.title.split('').map(c => c + '\u0336').join('')}`;
            return `• ${i.title}`;
          }).join("\n");
          if (navigator.clipboard) {
            void navigator.clipboard.writeText(text);
            haptics.notify("success");
          }
          setGroupMenu(null);
        }}
      />

      {/* Move selected items to a category (group) */}
      <Sheet open={selectGroupOpen} onOpenChange={(v) => !v && setSelectGroupOpen(false)}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/75 bg-popover">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="text-[16px]">Move to category</SheetTitle>
          </SheetHeader>
          <div className="app-card px-2 py-1.5 divide-y divide-border/25 pb-2">
            <GroupMenuRow onClick={() => moveSelectedToGroup(null)} icon={<ListChecks className="h-4 w-4" />} label="No category" />
            {dayGroups.map((g) => (
              <GroupMenuRow key={g.id} onClick={() => moveSelectedToGroup(g.id)} icon={<Folder className="h-4 w-4" />} label={g.title} />
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Move-to-date picker for the multi-selection */}
      <DayPickerSheet
        open={selectMoveOpen}
        onOpenChange={(v) => !v && setSelectMoveOpen(false)}
        value={viewDate}
        onPick={(ymd) => moveSelectedToDate(ymd)}
        pastDays={3}
        futureDays={120}
        title={`Move ${selectedCount} item${selectedCount === 1 ? "" : "s"} to…`}
      />

      {/* Floating selection toolbar — sits above the tab bar while picking. */}
      {selectMode && (
        <div
          className="fixed bottom-0 inset-x-0 z-[45] pointer-events-none"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 10px)" }}
        >
          <div className="mx-auto w-[min(calc(100vw-24px),424px)] px-px pointer-events-auto">
            <div className="rounded-[24px] backdrop-blur-xl bg-background/95 border border-white/20 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.28),inset_0_1px_1px_rgba(255,255,255,0.3)] px-3 py-2 flex items-center gap-2">
              <button
                onClick={() => { if (selectedCount) { haptics.tap(); setSelectMoveOpen(true); } }}
                disabled={selectedCount === 0}
                className="flex-1 h-11 rounded-2xl inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold pressable transition-all disabled:opacity-40 disabled:pointer-events-none"
                style={{ color: "hsl(var(--accent))", background: "hsl(var(--accent) / 0.12)" }}
              >
                <CalendarDays className="h-4 w-4" strokeWidth={2.25} /> Move
              </button>
              {dayGroups.length > 0 && (
                <button
                  onClick={() => { if (selectedCount) { haptics.tap(); setSelectGroupOpen(true); } }}
                  disabled={selectedCount === 0}
                  className="flex-1 h-11 rounded-2xl inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold pressable transition-all disabled:opacity-40 disabled:pointer-events-none"
                  style={{ color: "hsl(var(--accent))", background: "hsl(var(--accent) / 0.10)" }}
                >
                  <Folder className="h-4 w-4" strokeWidth={2.25} /> Category
                </button>
              )}
              <button
                onClick={deleteSelected}
                disabled={selectedCount === 0}
                className="flex-1 h-11 rounded-2xl inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold text-destructive bg-destructive/[0.12] pressable transition-all disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2.25} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

/** A standing (pinned) item row — non-sortable. Same gestures as a normal row:
 *  tap → done, double-tap → failed (red ✗), hold → menu; plus (for loose items)
 *  an unpin affordance. */
function PinnedRow({
  item,
  onToggle,
  onFailed,
  onUnpin,
  onOpen,
}: {
  item: ChecklistItem;
  onToggle: (id: string) => void;
  onFailed?: (id: string) => void;
  onUnpin?: () => void;
  onOpen?: () => void;
}) {
  const showFailed = !!item.failed && !item.done;
  const showPriority = !!item.priority && !item.done && !showFailed;
  const gestures = useRowGestures({
    onTap: () => { onToggle(item.id); },
    onDoubleTap: () => { onFailed?.(item.id); },
    onLongPress: () => onOpen?.(),
  });
  return (
    <div className={`checklist-item-row flex items-center gap-3 px-3.5 py-2.5 border-b border-border/55 last:border-b-0 ${showFailed ? "bg-red-500/[0.06]" : showPriority ? "bg-amber-400/[0.07]" : ""}`}>
      <div
        {...gestures}
        role="button"
        aria-label={item.done ? "Done. Tap to reopen, double-tap to fail, hold for options" : "Tap to complete, double-tap to fail, hold for options"}
        className="flex-1 min-w-0 flex items-center gap-1.5 cursor-pointer select-none touch-pan-y"
      >
        {showPriority && (
          <Flag className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" fill="currentColor" aria-label="Priority" />
        )}
        <span className={`min-w-0 truncate text-[15px] ${item.done ? "line-through text-secondary-fg/45" : showFailed ? "text-foreground/55" : "text-foreground"}`}>
          {item.title}
        </span>
      </div>
      {onUnpin && (
        <button
          type="button"
          onClick={() => { haptics.tap(); onUnpin(); }}
          className="shrink-0 p-1.5 text-secondary-fg/45 hover:text-foreground pressable"
          aria-label="Unpin"
        >
          <PinOff className="h-4 w-4" />
        </button>
      )}
      <span className="shrink-0 h-9 w-9 -mr-1 flex items-center justify-center" aria-hidden>
        <CheckCircleAccent done={item.done} failed={!!item.failed} />
      </span>
    </div>
  );
}

/** A pinned category — the SAME unified card "плашка" as a normal category
 *  (collapsible header: chevron · icon · accent title · progress ring), so a
 *  pinned list looks and folds exactly like any other. The only differences are
 *  an unpin action in place of the menu and standing (non-sortable) rows. */
function PinnedGroupCard({
  group,
  items,
  collapsed,
  tint: tintProp,
  onToggleCollapse,
  onToggle,
  onFailed,
  onUnpin,
  onOpenItem,
}: {
  group: Group;
  items: ChecklistItem[];
  collapsed: boolean;
  tint?: ChecklistTint;
  onToggleCollapse: () => void;
  onToggle: (id: string) => void;
  onFailed: (id: string) => void;
  onUnpin: () => void;
  onOpenItem: (i: ChecklistItem) => void;
}) {
  const tint = tintProp ?? checklistCategoryTint(group.id);
  const done = items.filter((i) => i.done).length;
  const failed = items.filter((i) => i.failed && !i.done).length;
  const total = items.length;

  return (
    <div style={checklistTintVars(tint) as CSSProperties}>
      <div className="relative app-card checklist-surface rounded-[20px] overflow-hidden">
        {/* ── Card header — always visible, matches ChecklistGroup; the whole
            bar toggles collapse (the unpin button stops propagation). ───── */}
        <div
          onClick={onToggleCollapse}
          role="button"
          aria-label={collapsed ? "Expand list" : "Collapse list"}
          className="flex items-center gap-2 px-3 pt-3 pb-2.5 cursor-pointer select-none pressable"
        >
          <span className="flex items-center justify-center shrink-0 text-secondary-fg/40">
            <ChevronDown
              className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : ""}`}
              strokeWidth={2.5}
            />
          </span>
          <span className="flex items-center justify-center shrink-0" style={{ color: "hsl(var(--accent))" }}>
            <ListChecks className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          <span
            className="text-[13px] font-bold uppercase tracking-[0.1em] flex-1 min-w-0 truncate"
            style={{ color: "hsl(var(--accent))" }}
          >
            {group.title}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <ProgressRing done={done} failed={failed} total={total} />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); haptics.tap(); onUnpin(); }}
              aria-label="Unpin category"
              className="flex items-center justify-center h-7 w-7 rounded-full text-secondary-fg/50 hover:text-secondary-fg/80 hover:bg-muted/50 pressable transition-colors"
            >
              <PinOff className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Hairline divider — only when expanded so the folded card edge is clean */}
        <div
          className={`mx-3 transition-all duration-300 ${collapsed ? "h-0 opacity-0" : "h-px opacity-100"}`}
          style={{ backgroundColor: "hsl(var(--accent) / 0.18)" }}
        />

        {/* ── Items (standing rows) — animated collapse ─────────────────── */}
        <div className={`relative z-10 grid transition-all duration-300 ease-out origin-top ${
          collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
        }`}>
          <div className="overflow-hidden">
            {items.length === 0 ? (
              <div className="px-3.5 py-3.5 text-[13px] text-secondary-fg/45">No items yet</div>
            ) : (
              items.map((i) => (
                <PinnedRow key={i.id} item={i} onToggle={onToggle} onFailed={onFailed} onOpen={() => onOpenItem(i)} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Icon-chip action row for GroupMenuSheet — matches the timeline's "Plan
 *  options" menu so an app-card module of these reads as one premium
 *  surface instead of bare buttons floating on the sheet's flat background. */
const GroupMenuRow = ({
  onClick,
  icon,
  label,
  destructive,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-2 py-2.5 rounded-xl pressable transition-colors text-[14.5px] font-medium ${
      destructive ? "text-destructive hover:bg-destructive/[0.08]" : "text-foreground hover:bg-foreground/[0.05]"
    }`}
  >
    <span
      className="shrink-0 h-8 w-8 rounded-[10px] flex items-center justify-center"
      style={{
        background: destructive ? "hsl(var(--destructive) / 0.12)" : "hsl(var(--primary) / 0.1)",
        boxShadow: destructive
          ? "inset 0 0 0 1px hsl(var(--destructive) / 0.22)"
          : "inset 0 0 0 1px hsl(var(--primary) / 0.18)",
      }}
    >
      <span className={destructive ? "text-destructive" : "text-primary"}>{icon}</span>
    </span>
    <span className="flex-1 text-left truncate">{label}</span>
  </button>
);

/** Rename / delete a category. Delete shows an inline confirm (it cascades items). */
function GroupMenuSheet({
  group,
  itemCount,
  colorIndex,
  colorIsAuto,
  onSetColor,
  onClose,
  onRename,
  onDelete,
  onCarryUnfinished,
  onCarryAll,
  onCopyAsText,
  onTogglePin,
}: {
  group: Group | null;
  itemCount: number;
  colorIndex: number;
  colorIsAuto: boolean;
  onSetColor: (index: number | null) => void;
  onClose: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onCarryUnfinished: () => void;
  onCarryAll: () => void;
  onCopyAsText: () => void;
  onTogglePin: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "rename" | "confirm">("menu");
  const [draft, setDraft] = useState("");

  // Reset to the menu whenever a (different) group opens.
  useEffect(() => {
    if (group) {
      setMode("menu");
      setDraft(group.title);
    }
  }, [group?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitRename = () => {
    if (!group) return;
    const t = draft.trim();
    if (t && t !== group.title) onRename(group.id, t);
    haptics.tap();
    onClose();
  };

  return (
    <Sheet open={!!group} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-[28px] border-border/75 bg-popover">
        {group && (
          <div className="space-y-1">
            <SheetHeader className="text-left mb-2">
              <SheetTitle className="text-[16px] leading-snug">{group.title}</SheetTitle>
            </SheetHeader>

            {mode === "rename" && (
              <div className="space-y-3 pb-1">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setMode("menu");
                  }}
                  placeholder="List name"
                  className="w-full h-12 rounded-2xl border border-soft bg-card px-4 text-[15px] outline-none focus:border-accent/60 transition-colors"
                  style={{ fontSize: 16 }}
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMode("menu")}
                    className="h-11 rounded-2xl border border-soft bg-card text-[14px] font-semibold text-foreground/85 pressable"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={commitRename}
                    className="h-11 rounded-2xl bg-accent text-accent-foreground text-[14px] font-semibold pressable"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {mode === "confirm" && (
              <div className="space-y-3 pb-1">
                <p className="px-1 text-[13.5px] text-secondary-fg/85 leading-relaxed">
                  Delete “{group.title}”
                  {itemCount > 0 ? ` and its ${itemCount} item${itemCount === 1 ? "" : "s"}` : ""}? This
                  can’t be undone.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMode("menu")}
                    className="h-11 rounded-2xl border border-soft bg-card text-[14px] font-semibold text-foreground/85 pressable"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      onDelete(group.id);
                      haptics.impact("medium");
                      onClose();
                    }}
                    className="h-11 rounded-2xl bg-destructive text-destructive-foreground text-[14px] font-semibold pressable"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}

            {mode === "menu" && (
              <>
                {/* Colour picker — tap a swatch to recolour this list, or Auto to
                    let the app pick a non-repeating colour for it. */}
                <div className="px-3 pt-1 pb-2.5">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Palette className="h-3.5 w-3.5 text-secondary-fg/60" strokeWidth={2.25} />
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-secondary-fg/55">Colour</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSetColor(null)}
                      aria-pressed={colorIsAuto}
                      className={`h-8 px-3.5 rounded-full text-[12px] font-semibold pressable transition-colors border ${
                        colorIsAuto
                          ? "border-foreground/25 bg-foreground/[0.07] text-foreground"
                          : "border-border/70 bg-transparent text-secondary-fg/70 hover:text-foreground"
                      }`}
                    >
                      Auto
                    </button>
                    {CHECKLIST_CATEGORY_PALETTE.map((_, i) => {
                      const selected = !colorIsAuto && i === colorIndex;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => onSetColor(i)}
                          aria-label={`Colour ${i + 1}`}
                          aria-pressed={selected}
                          className="relative h-8 w-8 rounded-full pressable transition-transform active:scale-90"
                          style={{
                            background: swatchGradient(i),
                            boxShadow: selected
                              ? "0 0 0 2px hsl(var(--popover)), 0 0 0 3.5px rgba(255,255,255,0.9), 0 4px 10px -3px rgba(0,0,0,0.5)"
                              : "inset 0 1px 0 rgba(255,255,255,0.25), 0 1px 3px rgba(0,0,0,0.3)",
                          }}
                        >
                          {selected && (
                            <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" strokeWidth={3} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2.5">
                  <div className="app-card px-2 py-1.5 divide-y divide-border/25">
                    <GroupMenuRow onClick={() => setMode("rename")} icon={<Pencil className="h-4 w-4" />} label="Rename list" />
                    <GroupMenuRow
                      onClick={() => { onClose(); onTogglePin(); }}
                      icon={group.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      label={group.pinned ? "Unpin from every day" : "Pin to every day"}
                    />
                  </div>
                  <div className="app-card px-2 py-1.5 divide-y divide-border/25">
                    <GroupMenuRow onClick={() => { onClose(); onCarryUnfinished(); }} icon={<CalendarDays className="h-4 w-4" />} label="Carry unfinished to…" />
                    <GroupMenuRow onClick={() => { onClose(); onCarryAll(); }} icon={<CalendarDays className="h-4 w-4" />} label="Carry entire category to…" />
                    <GroupMenuRow onClick={onCopyAsText} icon={<Copy className="h-4 w-4" />} label="Copy as text" />
                  </div>
                  <div className="app-card px-2 py-1.5">
                    <GroupMenuRow onClick={() => setMode("confirm")} icon={<Trash2 className="h-4 w-4" />} label="Delete list" destructive />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Bottom sheet shown when a brain dump contains items already in the target list.
 *  Gives three choices: skip dups / add all anyway / add dups to a brand-new list. */
function DuplicateResolutionSheet({
  pending,
  groups,
  onClose,
  onSkip,
  onAddAll,
  onAddToNewList,
}: {
  pending: { uniqueTitles: string[]; dupTitles: string[]; targetGroupId: string | null } | null;
  groups: Group[];
  onClose: () => void;
  onSkip: () => void;
  onAddAll: () => void;
  onAddToNewList: (name: string) => void;
}) {
  const [newListName, setNewListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);

  const handleClose = () => {
    setNewListName("");
    setCreatingList(false);
    onClose();
  };

  const submitNewList = () => {
    const name = newListName.trim();
    if (!name) { setCreatingList(false); return; }
    onAddToNewList(name);
    setNewListName("");
    setCreatingList(false);
  };

  if (!pending) return null;

  const { dupTitles, uniqueTitles, targetGroupId } = pending;
  const targetName = targetGroupId ? (groups.find((g) => g.id === targetGroupId)?.title ?? "list") : "no category";
  const d = dupTitles.length;
  const u = uniqueTitles.length;

  return (
    <Sheet open onOpenChange={(v) => { if (!v) handleClose(); }}>
      <SheetContent side="bottom" className="rounded-t-[28px] border-border/75 bg-popover max-h-[80vh] flex flex-col">
        <SheetHeader className="text-left shrink-0">
          <SheetTitle className="text-[16px]">
            {d === 1 ? "1 item already exists" : `${d} items already exist`}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-3 flex-1 overflow-y-auto space-y-4 pb-2">
          <p className="text-[13px] text-secondary-fg/80 leading-relaxed">
            {d === 1
              ? `This item is already in "${targetName}":`
              : `These items are already in "${targetName}":`}
          </p>

          {/* Dup list — scrollable if long */}
          <div className="rounded-xl border border-soft bg-card divide-y divide-border/30 max-h-[140px] overflow-y-auto">
            {dupTitles.map((t) => (
              <div key={t} className="px-3 py-2 text-[13.5px] text-foreground/75 truncate">{t}</div>
            ))}
          </div>

          <div className="space-y-2">
            {/* Option 1 — skip dups, add only new */}
            <button
              type="button"
              onClick={() => { haptics.tap(); onSkip(); }}
              className="w-full h-12 rounded-2xl border border-soft bg-card text-[14px] font-semibold text-foreground/90 pressable flex items-center justify-between px-4"
            >
              <span>Skip {d === 1 ? "it" : `${d} duplicates`}</span>
              {u > 0 && (
                <span className="text-[12px] font-normal text-secondary-fg/65">
                  add {u} new item{u === 1 ? "" : "s"}
                </span>
              )}
            </button>

            {/* Option 2 — add everything, ignore dups */}
            <button
              type="button"
              onClick={() => { haptics.impact(); onAddAll(); }}
              className="w-full h-12 rounded-2xl border text-[14px] font-semibold pressable flex items-center justify-between px-4"
              style={{
                color: "hsl(var(--accent))",
                borderColor: "hsl(var(--accent) / 0.35)",
                background: "hsl(var(--accent) / 0.10)",
              }}
            >
              <span>Add all {d + u} anyway</span>
              <span className="text-[12px] font-normal opacity-70">including duplicates</span>
            </button>

            {/* Option 3 — move dups to a new list */}
            {creatingList ? (
              <div className="flex items-center gap-2 rounded-2xl border border-soft bg-card px-3 py-2">
                <FolderPlus className="h-4 w-4 text-accent shrink-0" />
                <input
                  autoFocus
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNewList();
                    if (e.key === "Escape") { setNewListName(""); setCreatingList(false); }
                  }}
                  placeholder="New list name (e.g. Extras)"
                  className="flex-1 min-w-0 bg-transparent text-[14px] outline-none placeholder:text-secondary-fg/45"
                  style={{ fontSize: 16 }}
                />
                <button
                  type="button"
                  onClick={submitNewList}
                  disabled={!newListName.trim()}
                  className="shrink-0 h-7 w-7 flex items-center justify-center rounded-full text-accent disabled:opacity-40 pressable"
                  aria-label="Create list and add duplicates"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { haptics.tap(); setCreatingList(true); }}
                className="w-full h-12 rounded-2xl border border-dashed text-[14px] font-semibold pressable flex items-center gap-2 px-4"
                style={{
                  color: "hsl(var(--accent))",
                  borderColor: "hsl(var(--accent) / 0.40)",
                }}
              >
                <FolderPlus className="h-4 w-4 shrink-0" />
                Add duplicates to new list…
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
