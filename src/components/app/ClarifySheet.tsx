import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sparkles, Clock, X, Check, Loader2, Split, GripVertical,
  ChevronDown, ChevronUp, ExternalLink, CalendarClock, Activity, AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, verticalListSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DurationPicker } from "@/components/app/DurationPicker";
import { useProfile } from "@/hooks/useProfile";
import { getTone, t as toneCopy } from "@/lib/tone";

export type ClarifiedTask = {
  title: string;
  estimate_min: number;
  priority: "high" | "medium" | "low";
  fixed_time?: string; // HH:MM
  notes?: string;
  track_time?: boolean; // user opted-in to time-tracking for this task
};

type Row = ClarifiedTask & {
  ai_estimate_min?: number;
  ai_reason?: string;
  ai_links?: { label: string; url: string }[];
  ai_should_split?: boolean;
  ai_split_into?: { title: string; estimate_min: number }[];
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rawInput: string;
  onConfirm: (tasks: ClarifiedTask[]) => void;
  /** Date the plan is for, YYYY-MM-DD. Used to compute remaining hours. */
  planDate?: string;
}

// naive parse: extract "30m"/"1h", "at 2pm", urgency hints
function parseLine(line: string): Row {
  let title = line.trim();
  let estimate_min = 30;
  let fixed_time: string | undefined;

  const dur = title.match(/\b(\d+)\s*(h|hr|hour|hrs|hours|m|min|mins|minutes)\b/i);
  if (dur) {
    const n = parseInt(dur[1], 10);
    estimate_min = /^h/i.test(dur[2]) ? n * 60 : n;
    title = title.replace(dur[0], "").trim();
  }
  const at = title.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (at) {
    let h = parseInt(at[1], 10);
    const m = at[2] ? parseInt(at[2], 10) : 0;
    const ap = at[3]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    fixed_time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    title = title.replace(at[0], "").trim();
  }
  let priority: ClarifiedTask["priority"] = "medium";
  if (/!{2,}|urgent|asap|critical/i.test(title)) priority = "high";
  if (/maybe|nice to have|optional|low/i.test(title)) priority = "low";
  title = title.replace(/!+$/, "").replace(/[-•*]\s*/, "").trim();
  return { title, estimate_min, priority, fixed_time };
}

const fmt = (m: number) =>
  m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
const STEP = 5;
const MIN = 5;
const MAX = 240;

// Best-effort local fallback: split by newlines, semicolons, and bullets.
// We DO NOT split on " and "/" plus " etc. — those connectors live inside
// real task names ("John and Bob meeting", "Pick up Anna and Mark") and
// splitting on them mangles titles. The AI splitter handles natural-language
// task separation server-side; this is purely a holding fallback.
function localSplit(input: string): string[] {
  return input
    .split(/\r?\n|;|•|(?:^|\s)[-*]\s+|(?:^|\s)\d+[.)]\s+/g)
    .map(s => s.trim().replace(/^[,.\s]+|[,.\s]+$/g, ""))
    .filter(Boolean);
}

export function ClarifySheet({ open, onOpenChange, rawInput, onConfirm, planDate }: Props) {
  const initial = useMemo(
    () => localSplit(rawInput).map(parseLine),
    [rawInput],
  );
  const [tasks, setTasks] = useState<Row[]>(initial);
  const [loadingAI, setLoadingAI] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  useEffect(() => {
    if (!open) return;
    setTasks(initial);
    splitWithAI(rawInput, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rawInput]);

  const splitWithAI = async (raw: string, fallback: Row[]) => {
    if (!raw.trim()) return;
    setSplitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("split-tasks", {
        body: { raw_input: raw },
      });
      if (error) throw error;
      const split: string[] = Array.isArray(data?.tasks) ? data.tasks : [];
      const rows = split.map(parseLine);
      // Only swap if AI returned something meaningful
      const next = rows.length > 0 ? rows : fallback;
      setTasks(next);
      if (next.length > 0) fetchSuggestions(next);
    } catch (e) {
      console.error("split-tasks failed", e);
      // keep fallback rows, still try to estimate them
      if (fallback.length > 0) fetchSuggestions(fallback);
    } finally {
      setSplitting(false);
    }
  };

  const fetchSuggestions = async (rows: Row[]) => {
    setLoadingAI(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-estimates", {
        body: { tasks: rows.map(r => r.title) },
      });
      if (error) throw error;
      const ests: Array<any> = data?.estimates || [];
      // Auto-apply AI estimate so the user doesn't have to "Accept" anything.
      // They can still adjust with the +/- stepper.
      setTasks(prev => prev.map((r, i) => {
        const e = ests.find((x: any) => x.index === i);
        if (!e) return r;
        return {
          ...r,
          ai_estimate_min: e.estimate_min,
          ai_reason: e.reason,
          ai_links: e.links || [],
          ai_should_split: e.should_split,
          ai_split_into: e.split_into || [],
          // Apply AI estimate by default. User edits override.
          estimate_min: e.estimate_min || r.estimate_min,
        };
      }));
    } catch (e: any) {
      console.error(e);
      // Quiet failure — user still has their own estimates.
    } finally {
      setLoadingAI(false);
    }
  };

  const update = (i: number, patch: Partial<Row>) =>
    setTasks(t => t.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => setTasks(t => t.filter((_, idx) => idx !== i));
  const bump = (i: number, delta: number) => {
    const next = Math.max(MIN, Math.min(MAX, Math.round((tasks[i].estimate_min + delta) / STEP) * STEP));
    update(i, { estimate_min: next });
  };

  // Drag-reorder = priority. Top third = high, middle = medium, bottom = low.
  const onReorder = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = parseInt(String(active.id), 10);
    const newIdx = parseInt(String(over.id), 10);
    if (Number.isNaN(oldIdx) || Number.isNaN(newIdx)) return;
    setTasks(prev => {
      const moved = arrayMove(prev, oldIdx, newIdx);
      const total = moved.length;
      return moved.map((t, idx) => ({
        ...t,
        priority:
          idx < Math.max(1, Math.ceil(total / 3))
            ? "high"
            : idx < Math.ceil((2 * total) / 3)
              ? "medium"
              : "low",
      }));
    });
  };

  const applySplit = (i: number) => {
    const r = tasks[i];
    if (!r.ai_split_into?.length) return;
    const newRows: Row[] = r.ai_split_into.map((s, idx) => ({
      title: s.title,
      estimate_min: s.estimate_min,
      priority: r.priority,
      fixed_time: idx === 0 ? r.fixed_time : undefined,
    }));
    setTasks(t => [...t.slice(0, i), ...newRows, ...t.slice(i + 1)]);
    toast.success(`Split into ${newRows.length} blocks`);
  };

  const totalMin = tasks.reduce((a, t) => a + (t.estimate_min || 0), 0);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;

  // Capacity check: how many minutes are realistically left to fill?
  // - Today: from now until 23:59 local.
  // - Future date: a generous full waking day (16h) from 7am.
  // We compare against the sum of estimates so the user notices when they
  // overcommit (e.g. planning 8h at 11pm).
  const capacityMin = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear(), mo = today.getMonth(), d = today.getDate();
    const todayKey = `${y}-${String(mo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    if (!planDate || planDate === todayKey) {
      const endOfDay = new Date(y, mo, d, 23, 59, 0, 0);
      return Math.max(0, Math.round((endOfDay.getTime() - today.getTime()) / 60000));
    }
    return 16 * 60; // future day budget
  }, [planDate, open]);
  const overCapacity = totalMin > capacityMin;
  const capH = Math.floor(capacityMin / 60);
  const capM = capacityMin % 60;

  // Detect tasks pinned to a time that's already in the past (today only).
  const pastFixedIdxs = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear(), mo = today.getMonth(), d = today.getDate();
    const todayKey = `${y}-${String(mo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    if (planDate && planDate !== todayKey) return new Set<number>();
    const nowMin = today.getHours() * 60 + today.getMinutes();
    const out = new Set<number>();
    tasks.forEach((t, i) => {
      if (!t.fixed_time) return;
      const [h, m] = t.fixed_time.split(":").map(Number);
      if (Number.isFinite(h) && Number.isFinite(m) && h * 60 + m < nowMin) out.add(i);
    });
    return out;
  }, [tasks, planDate, open]);
  const hasPastFixed = pastFixedIdxs.size > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[94vh] overflow-y-auto p-0 border-border">
        {/* Header — minimal */}
        <div className="px-5 pt-5 pb-4 sticky top-0 bg-background z-10 border-b border-border">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-xl">
              Review tasks
              {(loadingAI || splitting) && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {splitting ? "AI is splitting your tasks…" : "Drag to reorder · top = highest priority"} ·{" "}
              <span className={overCapacity ? "text-destructive font-medium" : "text-primary font-medium"}>
                {hours > 0 ? `${hours}h ` : ""}{mins}m total
              </span>
            </SheetDescription>
          </SheetHeader>
          {overCapacity && tasks.length > 0 && (
            <div className="mt-2 flex items-start gap-2 px-2.5 py-2 rounded-lg bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <p className="text-[11px] text-destructive leading-snug">
                Only <span className="font-semibold">{capH > 0 ? `${capH}h ` : ""}{capM}m</span> left
                {(!planDate) ? " today" : ""}. Trim tasks or move some to tomorrow.
              </p>
            </div>
          )}
          {hasPastFixed && (
            <div className="mt-2 flex items-start gap-2 px-2.5 py-2 rounded-lg bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <p className="text-[11px] text-destructive leading-snug">
                {pastFixedIdxs.size === 1 ? "1 task is pinned to a time that's already passed." : `${pastFixedIdxs.size} tasks are pinned to times already passed.`} Update or clear the time.
              </p>
            </div>
          )}
        </div>

        {/* List */}
        <div className="px-3 py-3 space-y-2">
          {tasks.length === 0 && (
            <p className="text-sm text-secondary-fg text-center py-8">No tasks detected. Add some first.</p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
            <SortableContext items={tasks.map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
              {tasks.map((t, i) => (
                <SortableTaskCard
                  key={i}
                  id={String(i)}
                  index={i}
                  task={t}
                  loadingAI={loadingAI}
                  onUpdate={update}
                  onRemove={remove}
                  onBump={bump}
                  onSplit={applySplit}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* Footer */}
        <div className="px-5 pb-6 pt-3 sticky bottom-0 bg-background border-t border-border">
          <Button
            onClick={() =>
              onConfirm(
                tasks.map(({ ai_estimate_min, ai_reason, ai_links, ai_should_split, ai_split_into, ...rest }) => rest),
              )
            }
            disabled={tasks.length === 0 || hasPastFixed}
            className="w-full h-12 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
            style={{ background: "var(--gradient-primary)" }}
          >
            {hasPastFixed ? "Fix past times to continue" : <>Plan my day <Sparkles className="h-4 w-4 ml-1" /></>}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --- Sortable card ---
type CardProps = {
  id: string;
  index: number;
  task: Row;
  loadingAI: boolean;
  onUpdate: (i: number, patch: Partial<Row>) => void;
  onRemove: (i: number) => void;
  onBump: (i: number, delta: number) => void;
  onSplit: (i: number) => void;
};

function SortableTaskCard({ id, index: i, task: t, loadingAI, onUpdate, onRemove, onBump, onSplit }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [expanded, setExpanded] = useState(false);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const hasExtras =
    !!(t.ai_links && t.ai_links.length) ||
    !!(t.ai_should_split && t.ai_split_into && t.ai_split_into.length > 1) ||
    !!t.ai_reason ||
    !!t.fixed_time ||
    expanded; // keep open once user expands

  const priorityDot =
    t.priority === "high"
      ? "bg-destructive"
      : t.priority === "low"
        ? "bg-muted-foreground"
        : "bg-primary";

  return (
    <div ref={setNodeRef} style={style} className="rounded-2xl border border-border bg-surface p-3">
      {/* Row 1 — drag handle, priority dot, title, remove */}
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="text-secondary-fg p-1 cursor-grab active:cursor-grabbing touch-none"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className={`h-2 w-2 rounded-full shrink-0 ${priorityDot}`} aria-label={`${t.priority} priority`} />
        <Input
          value={t.title}
          onChange={e => onUpdate(i, { title: e.target.value })}
          className="flex-1 h-8 bg-transparent border-0 px-0 text-[15px] font-medium focus-visible:ring-0 shadow-none"
          placeholder="Task title"
        />
        <button
          onClick={() => onRemove(i)}
          className="text-secondary-fg hover:text-destructive p-1 pressable"
          aria-label="Remove task"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Row 2 — estimate stepper (the only always-visible control) */}
      <div className="mt-2 flex items-center justify-between gap-2 pl-7">
        <div className="flex items-center gap-1.5 text-[12px] text-secondary-fg">
          <Clock className="h-3.5 w-3.5" />
          <span>Time</span>
          {loadingAI && !t.ai_estimate_min && (
            <Loader2 className="h-3 w-3 animate-spin text-primary ml-1" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onBump(i, -STEP)}
            className="h-8 w-8 rounded-lg bg-background border border-border text-foreground pressable text-base font-medium"
            aria-label="Decrease time"
          >−</button>
          <span className="min-w-[60px] text-center text-sm font-semibold tabular-nums">
            {fmt(t.estimate_min)}
          </span>
          <button
            onClick={() => onBump(i, STEP)}
            className="h-8 w-8 rounded-lg bg-background border border-border text-foreground pressable text-base font-medium"
            aria-label="Increase time"
          >+</button>
        </div>
      </div>

      {/* Row 2b — track time toggle */}
      <div className="mt-2 flex items-center justify-between gap-2 pl-7">
        <div className="flex items-center gap-1.5 text-[12px] text-secondary-fg">
          <Timer className="h-3.5 w-3.5" />
          <span>Track time</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!t.track_time}
          onClick={() => onUpdate(i, { track_time: !t.track_time })}
          className={`relative h-7 w-12 rounded-full transition-colors pressable shrink-0 ${
            t.track_time ? "bg-primary" : "bg-muted border border-border"
          }`}
          aria-label="Toggle time tracking for this task"
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
              t.track_time ? "translate-x-[26px]" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Row 3 — More toggle, only if there are extras */}
      {hasExtras && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-2 ml-7 inline-flex items-center gap-1 text-[11px] text-secondary-fg hover:text-foreground pressable"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Less" : "More options"}
        </button>
      )}

      {/* Expanded extras */}
      {expanded && (
        <div className="mt-2 ml-7 space-y-2">
          {t.ai_reason && (
            <p className="text-[11px] text-secondary-fg italic">AI: {t.ai_reason}</p>
          )}

          {/* Split suggestion */}
          {t.ai_should_split && t.ai_split_into && t.ai_split_into.length > 1 && (
            <button
              onClick={() => onSplit(i)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-[12px] font-medium text-primary pressable"
            >
              <Split className="h-3 w-3" />
              Split into {t.ai_split_into.length} blocks
              <span className="text-primary/70 font-normal">
                ({t.ai_split_into.map(s => fmt(s.estimate_min)).join(" + ")})
              </span>
            </button>
          )}

          {/* Links */}
          {t.ai_links && t.ai_links.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {t.ai_links.slice(0, 2).map((l, li) => (
                <a
                  key={li}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-background border border-border text-[11px] text-foreground hover:border-primary/40 pressable max-w-full"
                  title={l.url}
                >
                  <ExternalLink className="h-3 w-3 text-primary shrink-0" />
                  <span className="truncate">{l.label}</span>
                </a>
              ))}
            </div>
          )}

          {/* Priority chips */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-secondary-fg mr-1">Priority</span>
            {(["high", "medium", "low"] as const).map(p => (
              <button
                key={p}
                onClick={() => onUpdate(i, { priority: p })}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border pressable ${
                  t.priority === p
                    ? p === "high"
                      ? "bg-destructive/10 text-destructive border-destructive/30"
                      : p === "low"
                        ? "bg-muted text-muted-foreground border-border"
                        : "bg-primary/10 text-primary border-primary/30"
                    : "bg-background text-secondary-fg border-border"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Fixed time */}
          <label className="flex items-center gap-2 text-[12px] text-secondary-fg">
            <CalendarClock className="h-3.5 w-3.5" />
            <span>Fixed time</span>
            <input
              type="time"
              value={t.fixed_time || ""}
              onChange={e => onUpdate(i, { fixed_time: e.target.value || undefined })}
              className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground ml-auto"
            />
            {t.fixed_time && (
              <button
                onClick={() => onUpdate(i, { fixed_time: undefined })}
                className="text-secondary-fg hover:text-foreground"
                aria-label="Clear fixed time"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
        </div>
      )}
    </div>
  );
}
