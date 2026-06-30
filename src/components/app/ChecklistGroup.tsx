import { useRef, useState, useEffect, type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ChevronDown, MoreHorizontal, Plus, Check, X, ListChecks, Flag } from "lucide-react";
import type { ChecklistGroup as Group, ChecklistItem } from "@/hooks/useChecklist";
import { haptics } from "@/lib/haptics";
import { checklistCategoryTint, checklistTintVars, type ChecklistTint } from "@/lib/checklistColors";

/* The checklist's identity colour is a vivid two-stop accent gradient
   (`--accent` → `--accent-2`, theme-aware). It carries the done checkbox, the
   list chip, the progress and the "Add list" affordance, so the mode reads with
   one confident, saturated colour. Cards are lifted with layered shadows + an
   inset highlight (`app-card` + `.checklist-surface`) — 3D depth, no transforms. */

/** Tri-state circle: hollow ring (open) · glowing accent-gradient disc + white
 *  check (done) · red ring + red ✗ (failed). All three cross-fade via cheap CSS
 *  transitions — no per-row JS. `done` wins if both are somehow set. */
export function CheckCircleAccent({ done, failed = false, size = 22 }: { done: boolean; failed?: boolean; size?: number }) {
  const showFailed = failed && !done;
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <span
        className={`absolute inset-0 rounded-full border-[1.5px] transition-all duration-200 ${
          done ? "border-transparent scale-90" : showFailed ? "border-red-500/80 dark:border-red-400/80" : "border-secondary-fg/35"
        }`}
      />
      {/* done — accent disc + white check */}
      <span
        className="accent-grad accent-glow absolute inset-0 rounded-full flex items-center justify-center transition-[transform,opacity] duration-200 ease-out"
        style={{ transform: done ? "scale(1)" : "scale(0.4)", opacity: done ? 1 : 0 }}
      >
        <Check className="text-white" strokeWidth={3} style={{ width: size * 0.58, height: size * 0.58 }} />
      </span>
      {/* failed — red ✗ */}
      <span
        className="absolute inset-0 flex items-center justify-center transition-[transform,opacity] duration-200 ease-out text-red-500 dark:text-red-400"
        style={{ transform: showFailed ? "scale(1)" : "scale(0.4)", opacity: showFailed ? 1 : 0 }}
      >
        <X strokeWidth={3} style={{ width: size * 0.56, height: size * 0.56 }} />
      </span>
    </span>
  );
}

/** How long to wait for a possible second tap before committing the single tap.
 *  Human double-taps span ~150–300ms between taps. At 150ms the window was too
 *  tight: taps 160ms apart became two single taps (done→open→done) instead of
 *  one double-tap (done→failed). 220ms catches the full realistic range while
 *  still distinguishing a deliberate "tap … wait … tap" sequence. */
const DOUBLE_TAP_MS = 220;

/** Tap / double-tap / long-press detector for a checklist row.
 *  Single tap → `onTap` (toggle done), double tap → `onDoubleTap` (toggle the
 *  red ✗ failed state), long press (500ms) → `onLongPress` (open the item menu).
 *
 *  The TAP/double-tap path is driven by the `click` event, NOT pointerup: in an
 *  iOS WKWebView `click` is the dependable "this row was tapped" signal (it never
 *  fires on a scroll, and doesn't depend on pointerup landing on the same node),
 *  so a tap can't silently fall through to the long-press menu. Pointer events
 *  are used only to time the long-press and to cancel it on scroll/move; the
 *  long-press swallows the trailing click. The grip (which owns the drag) lives
 *  outside this surface, so dragging is unaffected. */
export function useRowGestures({
  onTap, onDoubleTap, onLongPress, disabled = false,
}: {
  onTap: () => void;
  onDoubleTap: () => void;
  onLongPress: () => void;
  disabled?: boolean;
}) {
  const clickCount = useRef(0);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const clearLong = () => { if (longTimer.current) { clearTimeout(longTimer.current); longTimer.current = null; } };
  const clearClick = () => { if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; } };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    longFired.current = false;
    moved.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    clearLong();
    longTimer.current = setTimeout(() => {
      longTimer.current = null;
      longFired.current = true;       // swallow the click that follows release
      clickCount.current = 0;
      clearClick();
      haptics.impact("medium");
      onLongPress();
    }, 500);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) {
      moved.current = true;
      clearLong();
    }
  };
  const onPointerUp = () => { clearLong(); };
  const onPointerCancel = () => { clearLong(); moved.current = false; };

  const onClick = (e: React.MouseEvent) => {
    if (disabled) return;
    // A long-press already handled this interaction — eat the trailing click.
    if (longFired.current) { longFired.current = false; e.preventDefault(); e.stopPropagation(); return; }
    if (moved.current) { moved.current = false; return; }
    clickCount.current += 1;
    if (clickCount.current === 1) {
      // Fire haptic immediately so the user knows the tap was registered — without
      // this, the 220ms double-tap window feels like dead air and users re-tap,
      // accidentally triggering the double-tap → failed transition.
      haptics.impact("light");
      // DEFER the state change until the double-tap window closes. A double-tap
      // (→ failed ✗) used to fire onTap first, so you'd see the green check
      // flash then flip to the red cross. Waiting it out means a double-tap goes
      // straight to "failed" with no flicker, and "untap" (double-tap a failed
      // item) clears it back to open cleanly.
      clearClick();
      clickTimer.current = setTimeout(() => {
        clickCount.current = 0;
        clickTimer.current = null;
        onTap();
      }, DOUBLE_TAP_MS);
    } else {
      // Second tap inside the window — it's a double tap. Cancel the pending
      // single tap entirely and run ONLY the double-tap action.
      clearClick();
      clickCount.current = 0;
      haptics.impact("medium");
      onDoubleTap();
    }
  };
  const onContextMenu = (e: React.MouseEvent) => { e.preventDefault(); };

  // If the row unmounts mid-gesture (delete / day switch), drop any pending
  // deferred-tap or long-press timer so it can't fire on a gone component.
  useEffect(() => () => { clearLong(); clearClick(); }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick, onContextMenu };
}

/** Compact progress ring with X/Y count inside. Shows a green (done) arc plus a
 *  red (failed) arc around the track. Collapses to a glowing accent-gradient
 *  check disc once everything is done. */
export function ProgressRing({ done, total, failed = 0 }: { done: number; total: number; failed?: number }) {
  const size = 30;
  const r = 12;
  const c = 2 * Math.PI * r;
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
  // Two arcs share the circle: green from the top, then red continues after it.
  const doneLen = total > 0 ? (done / total) * c : 0;
  const failedLen = total > 0 ? (failed / total) * c : 0;
  // A failed item that the ring should flag in red on the small circle.
  const hasFailed = failed > 0;

  return (
    <div className="relative h-[30px] w-[30px] shrink-0 flex items-center justify-center">
      {/* Ring arcs — rotated so they start at the top */}
      <svg className="-rotate-90 absolute inset-0 h-full w-full" viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="1.8" className="text-secondary-fg/20" />
        {done > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--accent))" strokeWidth="1.8"
            strokeDasharray={`${doneLen} ${c - doneLen}`} strokeDashoffset={0} strokeLinecap="round"
            className="transition-[stroke-dasharray] duration-500 ease-out"
          />
        )}
        {failedLen > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(239 68 68)" strokeWidth="1.8"
            strokeDasharray={`${failedLen} ${c - failedLen}`} strokeDashoffset={-doneLen} strokeLinecap="round"
            className="transition-[stroke-dasharray] duration-500 ease-out"
          />
        )}
      </svg>
      {/* Count — centered over the ring (turns red if everything left is failed) */}
      {total > 0 && (
        <span
          className="relative z-10 tabular-nums font-bold leading-none"
          style={{ fontSize, color: hasFailed && done === 0 ? "rgb(239 68 68)" : "hsl(var(--accent))", letterSpacing: "-0.3px" }}
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

/** One flat row: grip (drag) · gesture surface (tap → done, double-tap → failed,
 *  hold → menu) ending in the tri-state status circle. In multi-select mode the
 *  grip + circle are replaced by a selection dot, dragging is disabled, and
 *  tapping anywhere toggles selection. Divided from neighbours by hairlines. */
export function ChecklistItemRow({
  item,
  onToggle,
  onFailed,
  onOpenSheet,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  item: ChecklistItem;
  onToggle: (id: string) => void;
  onFailed: (id: string) => void;
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

  // Whole-row gestures: tap → done, double-tap → failed (red ✗), hold → menu.
  const gestures = useRowGestures({
    onTap: () => { onToggle(item.id); },
    onDoubleTap: () => { onFailed(item.id); },
    onLongPress: () => onOpenSheet(item),
    disabled: selectMode,
  });

  // Priority items get an amber flag + soft amber wash; failed items a soft red
  // wash. Done items drop the wash (the strike-through already signals handled).
  const showFailed = !!item.failed && !item.done;
  const showPriority = !!item.priority && !item.done && !showFailed;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`checklist-item-row group relative z-10 flex items-center gap-1.5 py-2.5 px-1.5 -mx-1.5 rounded-xl transition-colors ${
        isDragging ? "opacity-40" : ""
      } ${selectMode && selected ? "bg-accent/[0.1]" : showFailed ? "bg-red-500/[0.06]" : showPriority ? "bg-amber-400/[0.07]" : ""}`}
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

      {selectMode ? (
        <button
          onClick={pickRow}
          className="flex-1 min-w-0 text-left py-0.5 pressable flex items-center gap-1.5"
        >
          <span className={`min-w-0 text-[14.5px] font-medium leading-snug break-words ${item.done ? "text-foreground/40 line-through" : "text-foreground/90"}`}>
            {item.title}
          </span>
        </button>
      ) : (
        <div
          {...gestures}
          role="button"
          aria-label={item.done ? "Done. Tap to reopen, double-tap to fail, hold for options" : "Tap to complete, double-tap to fail, hold for options"}
          className="flex-1 min-w-0 flex items-center gap-1.5 cursor-pointer select-none touch-pan-y"
        >
          <span className="flex-1 min-w-0 py-0.5 flex items-center gap-1.5">
            {showPriority && (
              <Flag className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" fill="currentColor" aria-label="Priority" />
            )}
            <span
              className={`min-w-0 text-[14.5px] font-medium leading-snug break-words strikethrough-animated ${
                item.done ? "is-done text-foreground/40" : showFailed ? "text-foreground/55" : "text-foreground/90"
              }`}
            >
              {item.title}
            </span>
          </span>
          <span className="shrink-0 h-9 w-9 -mr-1 flex items-center justify-center" aria-hidden>
            <CheckCircleAccent done={item.done} failed={!!item.failed} />
          </span>
        </div>
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
      } catch { /* WKWebView can throw on an early scroll root — safe to ignore */ }
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
  tint: tintProp,
  onToggleCollapse,
  onOpenGroupMenu,
  onToggleItem,
  onFailedItem,
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
  tint?: ChecklistTint;
  onToggleCollapse: () => void;
  onOpenGroupMenu: (group: Group) => void;
  onToggleItem: (id: string) => void;
  onFailedItem: (id: string) => void;
  onOpenItemSheet: (item: ChecklistItem) => void;
  onAddItem: (title: string, groupId: string) => void;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  autoFocusAdd?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  const done = items.filter((i) => i.done).length;
  const failed = items.filter((i) => i.failed && !i.done).length;
  const total = items.length;
  const tint = tintProp ?? checklistCategoryTint(group.id);

  return (
    <div style={checklistTintVars(tint) as CSSProperties} className="mt-4">
      <div
        className={`relative app-card checklist-surface rounded-[20px] overflow-hidden transition-shadow ${
          isOver ? "ring-2 ring-accent/55" : ""
        }`}
      >
        {/* ── Card header — always visible; the whole bar toggles collapse,
            not just the chevron (the menu button stops propagation). ────── */}
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
              onClick={(e) => { e.stopPropagation(); onOpenGroupMenu(group); }}
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
                      onFailed={onFailedItem}
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
