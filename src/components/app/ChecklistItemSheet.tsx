import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Pencil, Trash2, FolderInput, CalendarArrowUp, CalendarClock, Check, Inbox } from "lucide-react";
import { haptics } from "@/lib/haptics";
import { shiftDate, todayDateStr } from "@/lib/daydraft";
import type { ChecklistGroup, ChecklistItem, MoveTarget } from "@/hooks/useChecklist";

/**
 * Per-item action sheet — opened by tapping an item's body (the same
 * tap → bottom-sheet pattern the timeline blocks use). Rename / Move to a
 * category / Move to another day / Delete. The full date picker is delegated
 * to the parent (avoids nesting one bottom sheet inside another).
 */

const Row = ({
  onClick,
  icon,
  label,
  destructive,
  active,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
  active?: boolean;
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-xl pressable transition-colors text-[14px] ${
      destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted/40"
    }`}
  >
    <span className={`shrink-0 ${destructive ? "text-destructive/80" : "text-secondary-fg"}`}>{icon}</span>
    <span className="flex-1 text-left truncate">{label}</span>
    {active && <Check className="h-4 w-4 text-accent shrink-0" />}
  </button>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/55">
    {children}
  </p>
);

export function ChecklistItemSheet({
  item,
  groups,
  planDate,
  onClose,
  onRename,
  onMove,
  onRequestPickDate,
  onDelete,
}: {
  item: ChecklistItem | null;
  groups: ChecklistGroup[];
  planDate: string;
  onClose: () => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, target: MoveTarget) => void;
  onRequestPickDate: (item: ChecklistItem) => void;
  onDelete: (id: string) => void;
}) {
  const [mode, setMode] = useState<"menu" | "rename">("menu");
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset to the menu whenever a different item is opened.
  useEffect(() => {
    if (item) {
      setMode("menu");
      setDraft(item.title);
    }
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode === "rename") {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [mode]);

  const open = !!item;
  const nextDayLabel = planDate === todayDateStr() ? "Move to tomorrow" : "Move to next day";

  const commitRename = () => {
    if (!item) return;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== item.title) onRename(item.id, trimmed);
    haptics.tap();
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover">
        {item && (
          <div className="space-y-1">
            <SheetHeader className="text-left mb-2">
              <SheetTitle className="text-[16px] leading-snug">{item.title}</SheetTitle>
            </SheetHeader>

            {mode === "rename" ? (
              <div className="space-y-3 pb-1">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setMode("menu");
                  }}
                  placeholder="Item name"
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
            ) : (
              <>
                <Row
                  onClick={() => setMode("rename")}
                  icon={<Pencil className="h-4 w-4" />}
                  label="Rename"
                />

                <Label>Move to list</Label>
                {item.group_id !== null && (
                  <Row
                    onClick={() => {
                      onMove(item.id, { groupId: null });
                      haptics.tap();
                      onClose();
                    }}
                    icon={<Inbox className="h-4 w-4" />}
                    label="No category"
                  />
                )}
                {groups
                  .filter((g) => g.id !== item.group_id)
                  .map((g) => (
                    <Row
                      key={g.id}
                      onClick={() => {
                        onMove(item.id, { groupId: g.id });
                        haptics.tap();
                        onClose();
                      }}
                      icon={<FolderInput className="h-4 w-4" />}
                      label={g.title}
                    />
                  ))}
                {groups.filter((g) => g.id !== item.group_id).length === 0 && item.group_id === null && (
                  <p className="px-3 py-1.5 text-[12px] text-secondary-fg/60">No other lists yet.</p>
                )}

                <Label>Move to day</Label>
                <Row
                  onClick={() => {
                    onMove(item.id, { date: shiftDate(planDate, 1) });
                    haptics.tap();
                    onClose();
                  }}
                  icon={<CalendarArrowUp className="h-4 w-4" />}
                  label={nextDayLabel}
                />
                <Row
                  onClick={() => onRequestPickDate(item)}
                  icon={<CalendarClock className="h-4 w-4" />}
                  label="Pick a date…"
                />

                <div className="h-px bg-border/40 my-1.5 mx-3" />
                <Row
                  onClick={() => {
                    onDelete(item.id);
                    haptics.impact("medium");
                    onClose();
                  }}
                  icon={<Trash2 className="h-4 w-4" />}
                  label="Delete"
                  destructive
                />
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
