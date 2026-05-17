import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles, Clock, X, Check, Loader2, Split, GripVertical,
  ChevronDown, ChevronUp, ExternalLink, CalendarClock, AlertTriangle,
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
import { Checkbox } from "@/components/ui/checkbox";
import { setDndBodyScrollLock } from "@/lib/dndScrollLock";
import { useProfile } from "@/hooks/useProfile";
import { getTone, t as toneCopy } from "@/lib/tone";
import { extractTaskTimeAnchors } from "@/lib/taskTimeAnchors";
import { parseBulkTasks } from "@/lib/taskSplitter";

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
  onConfirm: (tasks: ClarifiedTask[], planningContext?: string) => void;
  /** Date the plan is for, YYYY-MM-DD. Used to compute remaining hours. */
  planDate?: string;
  /** Only clean/split the user's input. Do not add estimate/link/split suggestions. */
  organizeOnly?: boolean;
}

// naive parse: extract "30m"/"1h", explicit clock phrases + urgency hints
function parseLine(line: string): Row {
  const anchors = extractTaskTimeAnchors(line);
  let title = anchors.cleanedTitle;
  let estimate_min = 30;
  let fixed_time: string | undefined = anchors.fixedStart;

  const dur = title.match(/\b(\d+)\s*(h|hr|hour|hrs|hours|m|min|mins|minutes)\b/i);
  if (dur) {
    const n = parseInt(dur[1], 10);
    estimate_min = /^h/i.test(dur[2]) ? n * 60 : n;
    title = title.replace(dur[0], "").trim();
  }
  let priority: ClarifiedTask["priority"] = "medium";
  if (/!{2,}|urgent|asap|critical/i.test(title)) priority = "high";
  if (/maybe|nice to have|optional|low/i.test(title)) priority = "low";
  title = title.replace(/!+$/, "").replace(/[-•*]\s*/, "").trim();
  const notes = anchors.deadlineNote?.trim();
  return { title, estimate_min, priority, fixed_time, ...(notes ? { notes } : {}) };
}

const fmt = (m: number) =>
  m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
const STEP = 5;
const MIN = 5;
const MAX = 240;

function localSplit(input: string): string[] {
  return parseBulkTasks(input);
}

export function ClarifySheet({ open, onOpenChange, rawInput, onConfirm, planDate, organizeOnly = false }: Props) {
  const initial = useMemo(
    () => localSplit(rawInput).map(parseLine),
    [rawInput],
  );
  const [tasks, setTasks] = useState<Row[]>(initial);
  const [planningContext, setPlanningContext] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const invokeWithTimeout = async (name: string, body: unknown, timeoutMs: number) => {
    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${name} timed out`)), timeoutMs);
    });
    return await Promise.race([
      supabase.functions.invoke(name, { body }),
      timeout,
    ]);
  };

  const mergeEstimatesIntoRows = (rows: Row[], ests: Array<Record<string, unknown>>): Row[] =>
    rows.map((r, i) => {
      const e = ests.find((x: any) => x.index === i) as any;
      if (!e) return r;
      return {
        ...r,
        ai_estimate_min: e.estimate_min,
        ai_reason: e.reason,
        ai_links: e.links || [],
        ai_should_split: e.should_split,
        ai_split_into: e.split_into || [],
        estimate_min: e.estimate_min || r.estimate_min,
      };
    });

  const sameShapeAsFallback = (rows: Row[], fallback: Row[]) =>
    rows.length === fallback.length &&
    rows.every((r, i) => r.title.trim() === fallback[i]?.title.trim());

  useEffect(() => {
    if (!open) return;
    const fallback = localSplit(rawInput).map(parseLine);
    setTasks(fallback);
    setPlanningContext("");

    if (!rawInput.trim()) return;

    let cancelled = false;
    (async () => {
      setSplitting(true);
      setLoadingAI(true);
      try {
        const splitP = invokeWithTimeout("split-tasks", { raw_input: rawInput }, 9000);
        const suggestP =
          !organizeOnly && fallback.length > 0
            ? invokeWithTimeout("suggest-estimates", { tasks: fallback.map((r) => r.title) }, 9000)
            : Promise.resolve({ data: null as any, error: null as any });

        const [splitSettled, suggestSettled] = await Promise.allSettled([splitP, suggestP]);

        if (cancelled) return;

        let rows = fallback;
        if (splitSettled.status === "fulfilled") {
          const { data, error } = splitSettled.value;
          if (!error && Array.isArray(data?.tasks) && data.tasks.length > 0) {
            const aiRows = data.tasks.map(parseLine);
            rows = aiRows.length < fallback.length ? fallback : aiRows;
          }
        } else {
          console.error("split-tasks failed", splitSettled.reason);
        }

        let parallelEstimates: Array<Record<string, unknown>> | null = null;
        if (suggestSettled.status === "fulfilled") {
          const { data, error } = suggestSettled.value;
          if (!error && Array.isArray(data?.estimates)) parallelEstimates = data.estimates;
        }

        const canUseParallel =
          parallelEstimates &&
          sameShapeAsFallback(rows, fallback);

        if (canUseParallel && parallelEstimates) {
          setTasks(mergeEstimatesIntoRows(rows, parallelEstimates));
        } else {
          setTasks(rows);
          if (!organizeOnly && rows.length > 0) {
            try {
              const { data, error } = await invokeWithTimeout(
                "suggest-estimates",
                { tasks: rows.map((r) => r.title) },
                9000,
              );
              if (cancelled) return;
              if (!error && Array.isArray(data?.estimates)) {
                setTasks(mergeEstimatesIntoRows(rows, data.estimates));
              }
            } catch (e) {
              console.error(e);
              toast("AI suggestions took too long. Using your current estimates.");
            }
          }
        }
      } catch (e) {
        console.error("planning preflight failed", e);
        if (!cancelled && fallback.length > 0) {
          setTasks(fallback);
          if (organizeOnly) return;
          try {
            const { data, error } = await invokeWithTimeout(
              "suggest-estimates",
              { tasks: fallback.map((r) => r.title) },
              9000,
            );
            if (!cancelled && !error && Array.isArray(data?.estimates)) {
              setTasks(mergeEstimatesIntoRows(fallback, data.estimates));
            }
          } catch (e2) {
            console.error(e2);
            toast("AI suggestions took too long. Using your current estimates.");
          }
        }
      } finally {
        if (!cancelled) {
          setSplitting(false);
          setLoadingAI(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, rawInput, organizeOnly]);

  const update = (i: number, patch: Partial<Row>) =>
    setTasks(t => t.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => setTasks(t => t.filter((_, idx) => idx !== i));
  const bump = (i: number, delta: number) => {
    const next = Math.max(MIN, Math.min(MAX, Math.round((tasks[i].estimate_min + delta) / STEP) * STEP));
    update(i, { estimate_min: next });
  };

  // Drag-reorder = priority. Top third = high, middle = medium, bottom = low.
  const onReorder = (e: DragEndEvent) => {
    setDndBodyScrollLock(false);
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
  const normalizedTasks = () =>
    tasks.flatMap((task) => {
      const cleaned = {
        title: task.title,
        estimate_min: task.estimate_min,
        priority: task.priority,
        fixed_time: task.fixed_time,
        notes: task.notes,
        track_time: task.track_time,
      };
      if (organizeOnly) return [cleaned];
      const suggested = task.ai_split_into || [];
      const shouldSplit = task.estimate_min > 90 || !!task.ai_should_split;
      if (!shouldSplit) return [cleaned];
      if (suggested.length > 1) {
        return suggested.map((s, idx) => ({
          ...cleaned,
          title: s.title || cleaned.title,
          estimate_min: Math.max(20, Math.min(90, s.estimate_min || Math.round(cleaned.estimate_min / suggested.length))),
          fixed_time: idx === 0 ? cleaned.fixed_time : undefined,
        }));
      }
      const first = Math.max(30, Math.min(90, Math.round(cleaned.estimate_min / 2 / 5) * 5));
      const second = Math.max(20, cleaned.estimate_min - first);
      return [
        { ...cleaned, title: `${cleaned.title} · part 1`, estimate_min: first },
        { ...cleaned, title: `${cleaned.title} · part 2`, estimate_min: second, fixed_time: undefined },
      ];
    });

  const submitPlan = (context?: string) => {
    const normalized = normalizedTasks();
    onConfirm(normalized, context?.trim() || undefined);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[24px] max-h-[94vh] overflow-y-auto p-0 border-soft bg-background/95 backdrop-blur-xl">
        <div className="px-5 pt-5 pb-3 sticky top-0 z-10 border-b border-soft bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 font-display text-[19px] font-semibold tracking-tight">
              Review tasks
              {(loadingAI || splitting) && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </SheetTitle>
            <SheetDescription className="text-[12.5px] leading-[1.5] text-secondary-fg">
              {splitting ? "Organizing your plan…" : "Review, edit, then build your blocks"} ·{" "}
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
          <div className="px-2">
            <button
              type="button"
              onClick={() => setContextOpen((v) => !v)}
              className="w-full flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary-fg py-1.5"
              aria-expanded={contextOpen}
            >
              <span className="flex items-center gap-1.5">
                {!organizeOnly && <Sparkles className="h-3 w-3" />} Constraints {planningContext.trim() ? "· added" : "(optional)"}
              </span>
              {contextOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {contextOpen && (
              <Textarea
                id="planning-context-ai"
                value={planningContext}
                onChange={(e) => setPlanningContext(e.target.value)}
                placeholder="Deadlines, fixed times, constraints, low energy..."
                rows={2}
                className="mt-1 mb-2 resize-none rounded-xl border-soft bg-muted/30 text-[13px] leading-relaxed"
              />
            )}
          </div>
          {tasks.length === 0 && (
            <p className="text-sm text-secondary-fg text-center py-8">No tasks detected. Add some first.</p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => setDndBodyScrollLock(true)}
            onDragCancel={() => setDndBodyScrollLock(false)}
            onDragEnd={onReorder}
          >
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
        <div className="px-5 pb-6 pt-3 sticky bottom-0 bg-background/95 backdrop-blur-md border-t border-soft supports-[backdrop-filter]:bg-background/80">
          <Button
            onClick={() => submitPlan(planningContext)}
            disabled={tasks.length === 0 || hasPastFixed}
            className="w-full h-12 rounded-[14px] bg-primary hover:bg-primary/92 text-primary-foreground text-[15px] font-medium pressable shadow-card"
          >
            {hasPastFixed ? (
              "Fix past times to continue"
            ) : (
              organizeOnly ? "Build blocks" : <>Build blocks <Sparkles className="ml-1 h-4 w-4" /></>
            )}
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
  const [durOpen, setDurOpen] = useState(false);
  const { profile } = useProfile();
  const tone = getTone(profile as any);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const hasAiExtras =
    !!(t.ai_links && t.ai_links.length) ||
    !!(t.ai_should_split && t.ai_split_into && t.ai_split_into.length > 1) ||
    !!t.ai_reason;

  useEffect(() => {
    if (!hasAiExtras && expanded) setExpanded(false);
  }, [hasAiExtras, expanded]);

  const priorityDot =
    t.priority === "high"
      ? "bg-destructive"
      : t.priority === "low"
        ? "bg-muted-foreground"
        : "bg-primary";

  return (
    <div ref={setNodeRef} style={style} className="rounded-[16px] border border-soft surface-card backdrop-blur-sm p-3.5 shadow-card">
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

      {/* Row 2 — estimate */}
      <div className="mt-2 flex items-center justify-between gap-2 pl-7">
        <div className="flex items-center gap-1.5 text-[12px] text-secondary-fg">
          <Clock className="h-3.5 w-3.5" />
          <span>How long</span>
          {loadingAI && !t.ai_estimate_min && (
            <Loader2 className="h-3 w-3 animate-spin text-primary ml-1" />
          )}
        </div>
        <button
          onClick={() => setDurOpen(true)}
          className="h-8 px-3 rounded-lg bg-background border border-soft pressable text-sm font-semibold tabular-nums hover:border-primary/40"
          aria-label="Edit estimate"
        >
          {fmt(t.estimate_min)}
        </button>
        <DurationPicker
          open={durOpen}
          onClose={() => setDurOpen(false)}
          value={t.estimate_min}
          onChange={(m) => onUpdate(i, { estimate_min: m })}
          title="Estimate"
        />
      </div>

      {/* Row 3 — priority (always visible) */}
      <div className="mt-3 pl-7">
        <div className="text-[10px] font-medium uppercase tracking-wide text-secondary-fg mb-1.5">Priority for scheduling</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(["high", "medium", "low"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onUpdate(i, { priority: p })}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium border pressable ${
                t.priority === p
                  ? p === "high"
                    ? "bg-destructive/10 text-destructive border-destructive/30"
                    : p === "low"
                      ? "bg-muted text-muted-foreground border-soft"
                      : "surface-accent text-primary border-accent"
                  : "bg-background text-secondary-fg border-soft"
              }`}
            >
              {p === "high" ? "High" : p === "low" ? "Low" : "Medium"}
            </button>
          ))}
        </div>
      </div>

      {/* Row 4 — pin to clock time */}
      <div className="mt-3 pl-7 rounded-xl border border-soft/80 bg-muted/20 px-3 py-2.5">
        <div className="flex items-center gap-2 text-[12px] text-secondary-fg mb-1">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium text-foreground">Pin to a start time</span>
        </div>
        <p className="text-[10px] text-secondary-fg leading-snug mb-2">Optional. The planner will start this block at this clock time.</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="time"
            value={t.fixed_time || ""}
            onChange={(e) => onUpdate(i, { fixed_time: e.target.value || undefined })}
            className="bg-background border border-soft rounded-lg px-2 py-1.5 text-xs text-foreground"
            aria-label="Fixed start time"
          />
          {t.fixed_time ? (
            <button
              type="button"
              onClick={() => onUpdate(i, { fixed_time: undefined })}
              className="text-[11px] text-secondary-fg hover:text-foreground pressable"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {/* Row 5 — tracker preference (never auto-starts the timer) */}
      <div className="mt-3 flex items-start gap-3 pl-7 pr-0.5">
        <Checkbox
          id={`clarify-track-${i}`}
          checked={!!t.track_time}
          onCheckedChange={(v) => onUpdate(i, { track_time: v === true })}
          className="mt-0.5 border-soft"
        />
        <label htmlFor={`clarify-track-${i}`} className="min-w-0 cursor-pointer leading-snug">
          <div className="text-[12px] font-medium text-foreground">{toneCopy(tone, "track_label")}</div>
          <p className="text-[10px] text-secondary-fg mt-1 leading-snug">
            Optional marker for scheduling — you start the timer yourself from Focus or Home when ready.
          </p>
        </label>
      </div>

      {hasAiExtras && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 ml-7 inline-flex items-center gap-1 text-[11px] font-medium text-primary pressable"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Hide AI suggestions" : "AI suggestions"}
        </button>
      )}

      {expanded && hasAiExtras && (
        <div className="mt-2 ml-7 space-y-2 rounded-xl border border-soft surface-soft px-3 py-2.5">
          {t.ai_reason && <p className="text-[11px] text-secondary-fg leading-relaxed">{t.ai_reason}</p>}
          {t.ai_should_split && t.ai_split_into && t.ai_split_into.length > 1 && (
            <button
              type="button"
              onClick={() => onSplit(i)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg surface-accent border border-accent text-[12px] font-medium text-primary pressable"
            >
              <Split className="h-3 w-3" />
              Split into {t.ai_split_into.length} blocks
              <span className="text-primary/70 font-normal">
                ({t.ai_split_into.map((s) => fmt(s.estimate_min)).join(" + ")})
              </span>
            </button>
          )}
          {t.ai_links && t.ai_links.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {t.ai_links.slice(0, 2).map((l, li) => (
                <a
                  key={li}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-background border border-soft text-[11px] text-foreground hover:border-primary/40 pressable max-w-full"
                  title={l.url}
                >
                  <ExternalLink className="h-3 w-3 text-primary shrink-0" />
                  <span className="truncate">{l.label}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
