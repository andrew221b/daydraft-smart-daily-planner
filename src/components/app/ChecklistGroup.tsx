import { useRef, useState, useEffect, type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ChevronDown, MoreHorizontal, Plus, Check, ListChecks, Flag } from "lucide-react";
import type { ChecklistGroup as Group, ChecklistItem } from "@/hooks/useChecklist";
import { haptics } from "@/lib/haptics";
import { checklistCategoryTint, checklistTintVars } from "@/lib/checklistColors";

/* The checklist's identity colour is a vivid two-stop accent gradient
   (`--accent` → `--accent-2`, theme-aware). It carries the done checkbox, the
   list chip, the progress and the "Add list" affordance, so the mode reads with
   one confident, saturated colour. Cards are lifted with layered shadows + an
   inset highlight (`app-card` + `.checklist-surface`) — 3D depth, no transforms. */

/** Round checkbox: hollow ring when open; a glowing accent-gradient disc with a
 *  white check when done (springs in via cheap CSS transitions — no per-row JS). */
export function CheckCircleAccent({ done, size = 22 }: { done: boolean; size?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <span
        className={`absolute inset-0 rounded-full border-[1.5px] transition-all duration-200 ${
          done ? "border-transparent scale-90" : "border-secondary-fg/35"
        }`}
      />
      <span
        className="accent-grad accent-glow absolute inset-0 rounded-full flex items-center justify-center transition-[transform,opacity] duration-200 ease-out"
        style={{ transform: done ? "scale(1)" : "scale(0.4)", opacity: done ? 1 : 0 }}
      >
        <Check className="text-white" strokeWidth={3} style={{ width: size * 0.58, height: size * 0.58 }} />
      </span>
    </span>
  );
}

/** Compact progress ring with X/Y count inside. Collapses to a glowing
 *  accent-gradient check disc once everything is done. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const size = 30;
  const r = 12;
  const c = 2 * Math.PI * r;
  const offset = total === 0 ? c : ((total - done) / total) * c;
  const allDone = total > 0 && done === total;

  if (allDone) {
    return (
      <div className="accent-grad accent-glow flex items-center justify-center h-[30px] w-[30px] rounded-full shrink-0">
        <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
      </div>
    );
  }

  const label = total > 0 ? `${done}/${total}` : "";
  const fontSize = label.length <= 3 ? 8.5 : label.length <= 4 ? 7.5 : 6.5;

  return (
    <div className="relative h-[30px] w-[30px] shrink-0 flex items-center justify-center">
      {/* Ring arc — rotated so it starts at the top */}
      <svg className="-rotate-90 absolute inset-0 h-full w-full" viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="1.8" className="text-secondary-fg/20" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--accent))" strokeWidth="1.8"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      {/* Count — centered over the ring */}
      {total > 0 && (
        <span
          className="relative z-10 tabular-nums font-bold leading-none"
          style={{ fontSize, color: "hsl(var(--accent))", letterSpacing: "-0.3px" }}
        >
          {done}/{total}
        </span>
      )}
    </div>
  );
}

/** Round selection indicator for multi-select mode: a hollow ring that fills
 *  with the accent + a white tick when picked. Distinct from the done checkbox
 *  (which is hidden while selecting), so there's only ever one circle per row. */
function SelectionDot({ selected }: { selected: boolean }) {
  return (
    <span className="relative inline-flex h-[22px] w-[22px] items-center justify-center">
      <span
        className={`absolute inset-0 rounded-full border-[1.5px] transition-all duration-150 ${
          selected ? "border-transparent" : "border-secondary-fg/45"
        }`}
      />
      <span
        className="accent-grad accent-glow absolute inset-0 rounded-full flex items-center justify-center transition-[transform,opacity] duration-150 ease-out"
        style={{ transform: selected ? "scale(1)" : "scale(0.4)", opacity: selected ? 1 : 0 }}
      >
        <Check className="text-white" strokeWidth={3} style={{ width: 13, height: 13 }} />
      </span>
    </span>
  );
}

/** One flat row: grip · title (tap → sheet) · checkbox (tap → toggle).
 *  In multi-select mode the grip + done-checkbox are replaced by a selection
 *  dot, dragging is disabled, and tapping anywhere toggles selection.
 *  Sits inside a list card, divided from neighbours by hairlines. */
export function ChecklistItemRow({
  item,
  onToggle,
  onOpenSheet,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  item: ChecklistItem;
  onToggle: (id: string) => void;
  onOpenSheet: (item: ChecklistItem) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: selectMode, // no reordering while selecting
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const pickRow = () => {
    haptics.impact("light");
    onToggleSelect?.(item.id);
  };

  // Priority items get an amber flag + a soft amber wash so they stand out from
  // the rest of the list — same accent the timeline + calendar use. Done items
  // drop the wash (the strike-through already signals "handled").
  const showPriority = !!item.priority && !item.done;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative z-10 flex items-center gap-1.5 py-2.5 px-1.5 -mx-1.5 rounded-xl transition-colors ${
        isDragging ? "opacity-40" : ""
      } ${selectMode && selected ? "bg-accent/[0.1]" : showPriority ? "bg-amber-400/[0.07]" : ""}`}
    >
      {selectMode ? (
        <button
          onClick={pickRow}
          aria-label={selected ? "Deselect" : "Select"}
          aria-pressed={selected}
          className="shrink-0 flex h-7 w-7 items-center justify-center pressable active:scale-90 transition-transform"
        >
          <SelectionDot selected={selected} />
        </button>
      ) : (
        <button
          {...attributes}
          {...listeners}
          aria-label="Reorder"
          className="shrink-0 flex h-7 w-6 items-center justify-center rounded-md touch-none cursor-grab active:cursor-grabbing text-secondary-fg/30 hover:text-secondary-fg/55 transition-colors"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}

      <button
        onClick={() => (selectMode ? pickRow() : onOpenSheet(item))}
        className="flex-1 min-w-0 text-left py-0.5 pressable flex items-center gap-1.5"
      >
        {showPriority && (
          <Flag className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" fill="currentColor" aria-label="Priority" />
        )}
        <span
          className={`min-w-0 text-[14.5px] font-medium leading-snug break-words strikethrough-animated ${
            item.done ? "is-done text-foreground/40" : "text-foreground/90"
          }`}
        >
          {item.title}
        </span>
      </button>

      {!selectMode && (
        <button
          onClick={() => {
            haptics.impact("light");
            onToggle(item.id);
          }}
          aria-label={item.done ? "Mark not done" : "Mark done"}
          className="shrink-0 h-9 w-9 -mr-1 flex items-center justify-center pressable active:scale-90 transition-transform"
        >
          <CheckCircleAccent done={item.done} />
        </button>
      )}
    </div>
  );
}

/** Quiet "add" row — a plain row whose accent `+` turns into a real input with a
 *  vivid accent-gradient Add button. No border: it reads as the list's last line. */
export function AddItemRow({
  onAdd,
  placeholder = "Add item…",
  autoFocus = false,
}: {
  onAdd: (title: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reveal = (delay = 0) => {
    window.setTimeout(() => {
      try {
        inputRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
      } catch {}
    }, delay);
  };

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => {
        inputRef.current?.focus();
        reveal();
      }, 50);
    }
  }, [autoFocus]);

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      reveal();
    });
  };
  return (
    <label className="relative z-10 flex items-center gap-1.5 py-2.5 cursor-text">
      <span className="shrink-0 flex h-7 w-6 items-center justify-center" style={{ color: "hsl(var(--accent))" }}>
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => reveal(300)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder={placeholder}
        enterKeyHint="done"
        className="checklist-add-item-input flex-1 min-w-0 bg-transparent text-[14px] outline-none placeholder:text-secondary-fg/40"
        style={{ fontSize: 16 }}
      />
      {draft.trim() && (
        <button
          onClick={(e) => {
            e.preventDefault();
            submit();
          }}
          className="accent-grad shrink-0 h-7 px-3.5 rounded-full text-[12px] font-bold text-white pressable shadow-sm"
        >
          Add
        </button>
      )}
    </label>
  );
}

/** A category = one unified card: header row (chevron · icon · title · ring ·
 *  menu) always visible, items below with animated collapse. The card is the
 *  "плашка" — it stays on screen even when folded so the user can always tap
 *  to expand without hunting for a separator that looks invisible. */
export function ChecklistGroup({
  group,
  items,
  collapsed,
  dragging,
  onToggleCollapse,
  onOpenGroupMenu,
  onToggleItem,
  onOpenItemSheet,
  onAddItem,
  selectMode = false,
  selectedIds,
  onToggleSelect,
  autoFocusAdd = false,
}: {
  group: Group;
  items: ChecklistItem[];
  collapsed: boolean;
  dragging: boolean;
  onToggleCollapse: () => void;
  onOpenGroupMenu: (group: Group) => void;
  onToggleItem: (id: string) => void;
  onOpenItemSheet: (item: ChecklistItem) => void;
  onAddItem: (title: string, groupId: string) => void;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  autoFocusAdd?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const tint = checklistCategoryTint(group.id);

  return (
    <div style={checklistTintVars(tint) as CSSProperties} className="mt-4">
      <div
        className={`relative app-card checklist-surface rounded-[20px] overflow-hidden transition-shadow ${
          isOver ? "ring-2 ring-accent/55" : ""
        }`}
      >
        {/* ── Card header — always visible ─────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2.5">
          <button
            onClick={onToggleCollapse}
            className="flex items-center justify-center pressable shrink-0 text-secondary-fg/40 hover:text-secondary-fg/70 transition-colors"
            aria-label={collapsed ? "Expand list" : "Collapse list"}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : ""}`}
              strokeWidth={2.5}
            />
          </button>
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
            <ProgressRing done={done} total={total} />
            <button
              onClick={() => onOpenGroupMenu(group)}
              aria-label="List options"
              className="flex items-center justify-center h-7 w-7 rounded-full text-secondary-fg/50 hover:text-secondary-fg/80 hover:bg-muted/50 pressable transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Hairline divider — only when expanded so the card edge is clean when folded */}
        <div
          className={`mx-3 transition-all duration-300 ${collapsed ? "h-0 opacity-0" : "h-px opacity-100"}`}
          style={{ backgroundColor: "hsl(var(--accent) / 0.18)" }}
        />

        {/* ── Items — animated collapse via grid-template-rows ──────────── */}
        <div
          className={`relative z-10 grid transition-all duration-300 ease-out origin-top ${
            collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
          }`}
        >
          <div className="overflow-hidden">
            <div
              ref={setNodeRef}
              className={`px-3 pb-1 pt-1 transition-colors ${isOver ? "bg-accent/[0.06]" : ""}`}
            >
              <div className="divide-y divide-border/25">
                <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  {items.map((i) => (
                    <ChecklistItemRow
                      key={i.id}
                      item={i}
                      onToggle={onToggleItem}
                      onOpenSheet={onOpenItemSheet}
                      selectMode={selectMode}
                      selected={!!selectedIds?.has(i.id)}
                      onToggleSelect={onToggleSelect}
                    />
                  ))}
                </SortableContext>
                {items.length === 0 && (
                  <div
                    className={`my-1 rounded-xl py-3.5 text-center text-[13px] transition-colors ${
                      dragging
                        ? "border border-dashed border-accent/50 text-accent font-medium bg-accent/[0.05]"
                        : "text-secondary-fg/45"
                    }`}
                  >
                    {dragging ? "Drop here" : "No items yet"}
                  </div>
                )}
                {!selectMode && <AddItemRow onAdd={(t) => onAddItem(t, group.id)} placeholder="Add to list…" autoFocus={autoFocusAdd} />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
