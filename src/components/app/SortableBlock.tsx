import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Block, fmtTime, inferScheduleBlockType } from "@/lib/daydraft";
import { Check, Calendar, Sparkles } from "lucide-react";

export const SortableBlock = ({
  block, editing, onTap, onToggleComplete, tourSpotlight,
}: {
  block: Block & { ai_reasoning?: string | null; location?: string | null; location_lat?: number | null; location_lng?: number | null; is_calendar_event?: boolean };
  editing: boolean;
  onTap?: (b: any) => void;
  onToggleComplete?: (b: any) => void;
  /** First visible row — tour hotspot only on one element. */
  tourSpotlight?: boolean;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: block.is_calendar_event });
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
      {...(isCal ? {} : attributes)}
      {...(isCal ? {} : listeners)}
      onClick={() => onTap?.(block)}
    className={`group cursor-pointer pressable transition-all duration-200 app-card px-2.5 ${
        block.completed ? "opacity-65" : ""
      } ${
        isCal
          ? "border-soft"
          : rhythmType === "rest"
            ? "bg-muted/40 border-soft hover:border-strong"
            : rhythmType === "personal"
              ? "bg-[linear-gradient(165deg,hsl(278_72%_62%/.10)_0%,hsl(var(--surface)/.80)_58%,hsl(var(--surface-elevated)/.74)_100%)] border-[hsl(270_70%_66%/.36)] hover:border-[hsl(270_72%_70%/.52)]"
              : "hover:border-primary/30"
      } py-5`}
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0 min-w-[54px] h-9 rounded-lg border border-strong bg-background/45 backdrop-blur-sm px-2 inline-flex items-center justify-center text-secondary-fg text-[11px] font-mono-sf tabular-nums">
          {fmtTime(block.start_time)}
        </div>
        <div className="w-[4px] h-9 rounded-full shrink-0" style={{ background: stripeColor }} />
        <div className="flex-1 min-w-0">
          <div className={`leading-tight flex items-center gap-1.5 min-w-0 ${rhythmType === "rest" ? "text-[12.5px]" : "text-[14px]"} ${block.completed ? "line-through text-secondary-fg" : "text-foreground"}`}>
          {isCal && <Calendar className="h-3 w-3 text-secondary-fg shrink-0" />}
          {!isCal && rhythmType === "rest" && <span className="shrink-0 text-[12px] leading-none" aria-hidden>☕</span>}
          <span className="truncate">{block.title}</span>
          {!isCal && block.ai_reasoning && (
            <span className="shrink-0 text-primary/70" title="Why this slot">
              <Sparkles className="h-3 w-3" aria-hidden />
            </span>
          )}
          </div>
          <div className={`${rhythmType === "rest" ? "text-[10px]" : "text-[10.5px]"} text-secondary-fg mt-1 tabular-nums`}>{dur}</div>
          {actualMin != null && (
            <div className={`mt-1 text-[10px] tabular-nums ${actualToneClass}`}>
              {fmtMin(estimatedMin)} planned · {fmtMin(actualMin)} actual
            </div>
          )}
        </div>
        {block.completed ? (
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
            className="h-6 w-6 rounded-full border-[1.5px] border-soft shrink-0 pressable"
            aria-label="Mark done"
          />
        )}
      </div>
    </div>
  );
};
