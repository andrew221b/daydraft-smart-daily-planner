import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Block, fmtTime, inferScheduleBlockType, isOpenUserTask, isUserTaskDone } from "@/lib/daydraft";
import { Check, Calendar, Sparkles, Layers, GripVertical } from "lucide-react";

export const SortableBlock = ({
  block, editing, onTap, onTapTime, onToggleComplete, onAskAi, tourSpotlight,
}: {
  block: Block & {
    ai_reasoning?: string | null;
    location?: string | null;
    location_lat?: number | null;
    location_lng?: number | null;
    is_calendar_event?: boolean;
    overlap_ok?: boolean | null;
    slot_end_time?: string | null;
    completed_at?: string | null;
    resolution?: string | null;
    resolved_at?: string | null;
  };
  editing: boolean;
  onTap?: (b: any) => void;
  onTapTime?: (b: any) => void;
  onToggleComplete?: (b: any) => void;
  onAskAi?: (b: any) => void;
  /** First visible row — tour hotspot only on one element. */
  tourSpotlight?: boolean;
}) => {
  const sortableDisabled =
    !!block.is_calendar_event || (block.kind === "task" && !isOpenUserTask(block));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    disabled: sortableDisabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const isCal = block.is_calendar_event;
  const rhythmType = inferScheduleBlockType(block);
  const stripeColor = isCal
    ? "hsl(var(--border))"
    : rhythmType === "personal"
      ? "hsl(270 78% 66%)"
      : rhythmType === "rest"
        ? "hsl(var(--muted-foreground) / 0.7)"
        : "hsl(var(--primary))";
  const dur = block.duration_min < 60
    ? `${block.duration_min}m`
    : `${Math.floor(block.duration_min/60)}h${block.duration_min%60 ? ` ${block.duration_min%60}m` : ""}`;
  const fmtMin = (mins: number) =>
    mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
  const estimatedMin = block.estimated_minutes ?? block.duration_min;
  const actualMin = typeof block.actual_minutes === "number" ? block.actual_minutes : null;
  const actualDeltaRatio = actualMin != null && estimatedMin > 0 ? (actualMin - estimatedMin) / estimatedMin : 0;
  const actualToneClass =
    actualMin == null
      ? "text-secondary-fg"
      : actualDeltaRatio > 0.4
        ? "text-destructive"
        : actualDeltaRatio > 0.2
          ? "text-amber-400"
          : actualDeltaRatio < -0.2
            ? "text-emerald-400"
            : "text-secondary-fg";
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tour={tourSpotlight ? "dayview-block" : undefined}
      className={`group cursor-pointer pressable transition-all duration-200 app-card px-3 py-4 shadow-none ${
        isUserTaskDone(block) && block.kind === "task" ? "opacity-95" : ""
      } ${
        !isCal && block.overlap_ok ? "border-l-[3px] border-l-primary/45" : ""
      } ${
        isCal
          ? "!border-border/35"
          : rhythmType === "rest"
            ? "bg-muted/25 !border-border/35 hover:border-border/50"
            : rhythmType === "personal"
              ? "bg-[linear-gradient(165deg,hsl(278_72%_62%/.08)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] border-[hsl(270_70%_66%/.28)] hover:border-[hsl(270_72%_70%/.44)]"
              : "!border-border/40 hover:border-border/55 hover:!border-primary/25"
      }`}
    >
      <div className="flex items-center gap-2">
        {!sortableDisabled ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="touch-none shrink-0 flex h-9 w-8 items-center justify-center rounded-lg text-secondary-fg/70 hover:bg-muted/50 pressable cursor-grab active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : (
          <div className="w-8 shrink-0" aria-hidden />
        )}
        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
          onClick={() => onTap?.(block)}
        >
        {onTapTime && !block.is_calendar_event ? (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onTapTime?.(block); }}
            className="shrink-0 min-w-[54px] h-9 rounded-xl border border-border/40 bg-background/30 backdrop-blur-sm px-2 inline-flex items-center justify-center text-secondary-fg/90 text-[11px] font-mono-sf tabular-nums pressable hover:border-primary/40 hover:text-foreground"
            aria-label="Change start time"
          >
            {fmtTime(block.start_time)}
          </button>
        ) : (
          <div className="shrink-0 min-w-[54px] h-9 rounded-xl border border-border/40 bg-background/30 backdrop-blur-sm px-2 inline-flex items-center justify-center text-secondary-fg/90 text-[11px] font-mono-sf tabular-nums">
            {fmtTime(block.start_time)}
          </div>
        )}
        <div className="w-[4px] h-9 rounded-full shrink-0" style={{ background: stripeColor }} />
        <div className="flex-1 min-w-0">
          <div className={`leading-tight flex items-center gap-1.5 min-w-0 ${rhythmType === "rest" ? "text-[12.5px]" : "text-[14px]"} ${isUserTaskDone(block) && block.kind === "task" ? "text-foreground/80" : "text-foreground"}`}>
          {isCal && <Calendar className="h-3 w-3 text-secondary-fg shrink-0" />}
          {!isCal && rhythmType === "rest" && <span className="shrink-0 text-[12px] leading-none" aria-hidden>☕</span>}
          <span className="truncate">{block.title}</span>
          {!isCal && Boolean(block.overlap_ok) && (
            <span className="shrink-0 text-secondary-fg" title="Runs alongside other work">
              <Layers className="h-3 w-3" aria-hidden />
            </span>
          )}
          {!isCal && block.ai_reasoning && (
            <span className="shrink-0 text-primary/70" title="Why this slot">
              <Sparkles className="h-3 w-3" aria-hidden />
            </span>
          )}
          </div>
          <div className={`${rhythmType === "rest" ? "text-[10px]" : "text-[10.5px]"} text-secondary-fg mt-1 tabular-nums`}>
            {block.kind === "task" && !isCal && block.resolution === "skipped" && block.resolved_at && (
              <span className="text-amber-700/90 dark:text-amber-400/85">
                Skipped ·{" "}
                {new Date(block.resolved_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "")}
                <span className="text-faint mx-1">·</span>
              </span>
            )}
            {block.kind === "task" && !isCal && block.resolution === "missed" && block.resolved_at && (
              <span className="text-destructive/85">
                Missed ·{" "}
                {new Date(block.resolved_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "")}
                <span className="text-faint mx-1">·</span>
              </span>
            )}
            {isUserTaskDone(block) && block.completed_at && (
              <span className="text-faint">
                Done {new Date(block.completed_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "")}
                <span className="text-faint mx-1">·</span>
              </span>
            )}
            {isUserTaskDone(block) && actualMin != null ? (
              <>
                <span className="font-medium text-foreground">{fmtMin(actualMin)}</span>
                <span className="text-faint"> actual</span>
                {estimatedMin !== actualMin && (
                  <span className="text-faint"> · {fmtMin(estimatedMin)} est</span>
                )}
              </>
            ) : (
              <span className="text-faint">{dur}</span>
            )}
          </div>
          {isUserTaskDone(block) && actualMin != null && estimatedMin > 0 && (
            <div className={`mt-0.5 text-[10px] tabular-nums ${actualToneClass}`}>
              {actualDeltaRatio > 0.15
                ? `${Math.round(actualDeltaRatio * 100)}% longer than planned`
                : actualDeltaRatio < -0.15
                  ? `${Math.round(-actualDeltaRatio * 100)}% under plan`
                  : "On track vs plan"}
            </div>
          )}
        </div>
        {block.kind === "task" && !isCal && !block.resolution && onAskAi && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAskAi(block);
            }}
            className="h-7 w-7 rounded-full border border-primary/25 bg-primary/10 text-primary shrink-0 grid place-items-center pressable hover:bg-primary/15"
            aria-label="Ask AI about this task"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
        )}
        {block.kind === "task" && !isCal && block.resolution === "skipped" ? (
          <div className="h-6 w-6 rounded-full border border-amber-500/40 bg-amber-500/10 shrink-0" title="Skipped" aria-hidden />
        ) : block.kind === "task" && !isCal && block.resolution === "missed" ? (
          <div className="h-6 w-6 rounded-full border border-destructive/35 bg-destructive/10 shrink-0" title="Missed" aria-hidden />
        ) : isUserTaskDone(block) || (block.completed && block.kind !== "task") ? (
          <button
            type="button"
            data-tour={tourSpotlight ? "dayview-complete" : undefined}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete?.(block);
            }}
            className="h-6 w-6 rounded-full bg-success flex items-center justify-center shrink-0 pressable"
            aria-label="Mark as not done"
          >
            <Check className="h-3 w-3 text-success-foreground" strokeWidth={3} />
          </button>
        ) : (
          <button
            type="button"
            data-tour={tourSpotlight ? "dayview-complete" : undefined}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete?.(block);
            }}
            className="h-6 w-6 rounded-full border-[1.5px] border-border/45 shrink-0 pressable hover:border-primary/35"
            aria-label="Mark done"
          />
        )}
        </div>
      </div>
    </div>
  );
};
