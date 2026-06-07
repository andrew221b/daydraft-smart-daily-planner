import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
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
import { GripVertical, FolderPlus, ListChecks, Trash2, Pencil, X, CalendarDays, Copy } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DayPickerSheet } from "@/components/app/DayPickerSheet";
import { ChecklistGroup, ChecklistItemRow, AddItemRow, CheckCircleAccent } from "@/components/app/ChecklistGroup";
import { ChecklistItemSheet } from "@/components/app/ChecklistItemSheet";
import { useChecklist, type ChecklistGroup as Group, type ChecklistItem } from "@/hooks/useChecklist";
import { haptics } from "@/lib/haptics";
import { checklistCategoryTint, checklistTintVars } from "@/lib/checklistColors";

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
    toggleItem,
    renameItem,
    deleteItem,
    moveItem,
    reorder,
    deleteItems,
    moveItemsToDate,
    moveGroupToDate,
    deleteAllForDay,
  } = useChecklist(userId, viewDate, eveningNudgeTime);

  // ── Multi-select ────────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMoveOpen, setSelectMoveOpen] = useState(false);

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
  const [groupDraft, setGroupDraft] = useState("");
  const groupInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  const sortPos = (a: ChecklistItem, b: ChecklistItem) =>
    a.position - b.position || a.created_at.localeCompare(b.created_at);

  const ungrouped = useMemo(
    () => items.filter((i) => i.group_id === null).sort(sortPos),
    [items],
  );
  const itemsByGroup = useMemo(() => {
    const m = new Map<string, ChecklistItem[]>();
    for (const g of groups) m.set(g.id, []);
    for (const i of items) {
      if (i.group_id && m.has(i.group_id)) m.get(i.group_id)!.push(i);
    }
    for (const arr of m.values()) arr.sort(sortPos);
    return m;
  }, [items, groups]);

  const total = items.length;
  const done = items.filter((i) => i.done).length;
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

  const handleToggle = (id: string) => {
    haptics.tap();
    toggleItem(id);
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
    addGroup(t);
    setGroupDraft("");
    requestAnimationFrame(() => {
      groupInputRef.current?.focus();
      revealGroupInput();
    });
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
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="text-[13.5px] text-foreground/95 tabular-nums">
                  <span className="font-bold text-[15px]">{done}</span>
                  <span className="text-secondary-fg/60 font-normal"> / {total} done</span>
                </div>
                {done > 0 && (
                  <span className="text-[12px] font-semibold" style={{ color: "hsl(var(--accent))" }}>
                    {done === total ? "All done! Nice work." : "Nice, keep going!"}
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        {/* Flat / ungrouped section — quick to-dos with no category. One lifted
            3D card, flat divided rows, ending in the quiet add row. */}
        <div className="relative app-card checklist-surface rounded-[20px] overflow-hidden">
          {/* "No category" label — only visible when categories exist so the user
              can distinguish the uncategorized section from the named lists below. */}
          {groups.length > 0 && (
            <div className="relative z-10 flex items-center gap-2 px-3 pt-2.5 pb-0.5">
              <div className="h-[22px] w-[22px] flex items-center justify-center rounded-[7px] bg-foreground/[0.08] border border-border/50 shrink-0">
                <ListChecks className="h-3 w-3 text-secondary-fg/55" strokeWidth={2.75} />
              </div>
              <span className="text-[13px] font-semibold text-secondary-fg/60">No category</span>
            </div>
          )}
          <Droppable id={UNGROUPED} isActive={!!activeId}>
            <SortableContext items={ungrouped.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {ungrouped.map((i) => (
                <ChecklistItemRow
                  key={i.id}
                  item={i}
                  onToggle={handleToggle}
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

        {/* Categories */}
        {groups.map((g) => (
          <ChecklistGroup
            key={g.id}
            group={g}
            items={itemsByGroup.get(g.id) ?? []}
            collapsed={collapsed.has(g.id)}
            dragging={!!activeId}
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
            onOpenItemSheet={setSheetItem}
            onAddItem={(t, gid) => addItem(t, gid)}
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
                ...(activeItem.group_id ? checklistTintVars(checklistCategoryTint(activeItem.group_id)) : {}),
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
        <button
          onClick={() => {
            haptics.tap();
            setAddingGroup(true);
          }}
          className="checklist-add-list-btn w-full flex items-center justify-center gap-2 h-12 rounded-2xl border border-dashed text-[13px] font-semibold pressable transition-colors"
          style={{
            color: "hsl(var(--accent))",
            borderColor: "hsl(var(--accent) / 0.45)",
            background: "hsl(var(--accent) / 0.05)",
          }}
        >
          <FolderPlus className="h-4 w-4" strokeWidth={2.25} /> Add list
        </button>
      )}

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
        onClose={() => setGroupMenu(null)}
        onRename={renameGroup}
        onDelete={deleteGroup}
        onCarryUnfinished={() => {
          if (groupMenu) setDatePickGroup({ id: groupMenu.id, mode: "unfinished" });
        }}
        onCarryAll={() => {
          if (groupMenu) setDatePickGroup({ id: groupMenu.id, mode: "all" });
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
                className="flex-1 h-11 rounded-2xl inline-flex items-center justify-center gap-2 text-[14px] font-semibold pressable transition-all disabled:opacity-40 disabled:pointer-events-none"
                style={{ color: "hsl(var(--accent))", background: "hsl(var(--accent) / 0.12)" }}
              >
                <CalendarDays className="h-4 w-4" strokeWidth={2.25} /> Move
              </button>
              <button
                onClick={deleteSelected}
                disabled={selectedCount === 0}
                className="flex-1 h-11 rounded-2xl inline-flex items-center justify-center gap-2 text-[14px] font-semibold text-destructive bg-destructive/[0.12] pressable transition-all disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]"
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

/** Rename / delete a category. Delete shows an inline confirm (it cascades items). */
function GroupMenuSheet({
  group,
  itemCount,
  onClose,
  onRename,
  onDelete,
  onCarryUnfinished,
  onCarryAll,
  onCopyAsText,
}: {
  group: Group | null;
  itemCount: number;
  onClose: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onCarryUnfinished: () => void;
  onCarryAll: () => void;
  onCopyAsText: () => void;
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
      <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover">
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
                <button
                  onClick={() => setMode("rename")}
                  className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl pressable transition-colors text-[14px] text-foreground hover:bg-muted/40"
                >
                  <Pencil className="h-4 w-4 text-secondary-fg shrink-0" />
                  <span className="flex-1 text-left">Rename list</span>
                </button>
                <button
                  onClick={() => { onClose(); onCarryUnfinished(); }}
                  className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl pressable transition-colors text-[14px] text-foreground hover:bg-muted/40"
                >
                  <CalendarDays className="h-4 w-4 text-secondary-fg shrink-0" />
                  <span className="flex-1 text-left">Carry unfinished to…</span>
                </button>
                <button
                  onClick={() => { onClose(); onCarryAll(); }}
                  className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl pressable transition-colors text-[14px] text-foreground hover:bg-muted/40"
                >
                  <CalendarDays className="h-4 w-4 text-secondary-fg shrink-0" />
                  <span className="flex-1 text-left">Carry entire category to…</span>
                </button>
                <button
                  onClick={onCopyAsText}
                  className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl pressable transition-colors text-[14px] text-foreground hover:bg-muted/40"
                >
                  <Copy className="h-4 w-4 text-secondary-fg shrink-0" />
                  <span className="flex-1 text-left">Copy as text</span>
                </button>
                <button
                  onClick={() => setMode("confirm")}
                  className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl pressable transition-colors text-[14px] text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left">Delete list</span>
                </button>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
