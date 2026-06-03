import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ChevronDown, MoreHorizontal, Plus, Check, ListChecks } from "lucide-react";
import type { ChecklistGroup as Group, ChecklistItem } from "@/hooks/useChecklist";
import { haptics } from "@/lib/haptics";

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

/** Compact progress for a list header: an accent ring that fills, collapsing to
 *  a glowing accent-gradient check disc once everything is done. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const offset = total === 0 ? c : ((total - done) / total) * c;
  const allDone = total > 0 && done === total;

  if (allDone) {
    return (
      <div className="accent-grad accent-glow flex items-center justify-center h-[20px] w-[20px] rounded-full shrink-0">
        <Check className="h-3 w-3 text-white" strokeWidth={3} />
      </div>
    );
  }
  return (
    <svg className="-rotate-90 h-[20px] w-[20px] shrink-0" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-secondary-fg/20" />
      <circle
        cx="10" cy="10" r={r} fill="none" stroke="hsl(var(--accent))" strokeWidth="2.5"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        className="transition-[stroke-dashoffset] duration-500 ease-out"
      />
    </svg>
  );
}

/** One flat row: grip · title (tap → sheet) · checkbox (tap → toggle).
 *  Sits inside a list card, divided from neighbours by hairlines. */
export function ChecklistItemRow({
  item,
  onToggle,
  onOpenSheet,
}: {
  item: ChecklistItem;
  onToggle: (id: string) => void;
  onOpenSheet: (item: ChecklistItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative z-10 flex items-center gap-1.5 py-2.5 ${isDragging ? "opacity-40" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="Reorder"
        className="shrink-0 flex h-7 w-6 items-center justify-center rounded-md touch-none cursor-grab active:cursor-grabbing text-secondary-fg/30 hover:text-secondary-fg/55 transition-colors"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <button
        onClick={() => onOpenSheet(item)}
        className="flex-1 min-w-0 text-left py-0.5 pressable"
      >
        <span
          className={`block text-[14.5px] font-medium leading-snug break-words strikethrough-animated ${
            item.done ? "is-done text-foreground/40" : "text-foreground/90"
          }`}
        >
          {item.title}
        </span>
      </button>

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
    </div>
  );
}

/** Quiet "add" row — a plain row whose accent `+` turns into a real input with a
 *  vivid accent-gradient Add button. No border: it reads as the list's last line. */
export function AddItemRow({
  onAdd,
  placeholder = "Add item…",
}: {
  onAdd: (title: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
    requestAnimationFrame(() => inputRef.current?.focus());
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
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder={placeholder}
        enterKeyHint="done"
        className="flex-1 min-w-0 bg-transparent text-[14px] outline-none placeholder:text-secondary-fg/40"
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

/** A category = one lifted 3D card: header (chevron · accent chip · name ·
 *  progress · menu) over a body of flat, hairline-divided rows + the add row. */
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
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  const done = items.filter((i) => i.done).length;
  const total = items.length;

  return (
    <div
      className={`relative app-card checklist-surface rounded-[20px] overflow-hidden transition-shadow ${
        isOver ? "ring-2 ring-accent/55" : ""
      }`}
    >
      {/* Header */}
      <div className="relative z-10 flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 flex-1 min-w-0 text-left pressable py-0.5"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-secondary-fg/50 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
          <span className="accent-grad accent-glow flex h-[22px] w-[22px] items-center justify-center rounded-[7px] shrink-0">
            <ListChecks className="h-3 w-3 text-white" strokeWidth={2.75} />
          </span>
          <span className="font-semibold text-[15px] text-foreground/95 truncate">{group.title}</span>
        </button>
        <ProgressRing done={done} total={total} />
        <button
          onClick={() => onOpenGroupMenu(group)}
          aria-label="List options"
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full text-secondary-fg/55 pressable hover:bg-muted/50 transition-colors"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Body — animated collapse via grid-template-rows */}
      <div
        className={`relative z-10 grid transition-all duration-300 ease-out origin-top ${
          collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="overflow-hidden">
          <div
            ref={setNodeRef}
            className={`px-3 pb-1 transition-colors ${isOver ? "bg-accent/[0.06]" : ""}`}
          >
            <div className="border-t border-border/40 divide-y divide-border/25">
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                {items.map((i) => (
                  <ChecklistItemRow key={i.id} item={i} onToggle={onToggleItem} onOpenSheet={onOpenItemSheet} />
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
              <AddItemRow onAdd={(t) => onAddItem(t, group.id)} placeholder="Add to list…" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
