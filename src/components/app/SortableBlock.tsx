import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Block, fmtTime, typeColor } from "@/lib/daydraft";
import { Check, Calendar, Sparkles } from "lucide-react";

export const SortableBlock = ({
  block, editing, onTap, tourSpotlight,
}: {
  block: Block & { ai_reasoning?: string | null; location?: string | null; location_lat?: number | null; location_lng?: number | null; is_calendar_event?: boolean };
  editing: boolean;
  onTap?: (b: any) => void;
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
  const dur = block.duration_min < 60
    ? `${block.duration_min}m`
    : `${Math.floor(block.duration_min/60)}h${block.duration_min%60 ? ` ${block.duration_min%60}m` : ""}`;
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tour={tourSpotlight ? "dayview-block" : undefined}
      {...(isCal ? {} : attributes)}
      {...(isCal ? {} : listeners)}
      onClick={() => onTap?.(block)}
      className={`group flex items-center gap-3 py-3 px-3 rounded-xl cursor-pointer pressable transition-colors ${
        block.completed ? "opacity-55" : ""
      } ${isCal ? "bg-surface/40" : "hover:bg-surface"}`}
    >
      <div className="w-12 text-right text-secondary-fg text-[12px] font-mono-sf tabular-nums shrink-0">{fmtTime(block.start_time)}</div>
      <div className="w-[3px] h-7 rounded-full shrink-0" style={{ background: isCal ? "hsl(var(--border))" : typeColor(block.type) }} />
      <div className="flex-1 min-w-0">
        <div className={`text-[14.5px] leading-tight flex items-center gap-1.5 min-w-0 ${block.completed ? "line-through text-secondary-fg" : "text-foreground"}`}>
          {isCal && <Calendar className="h-3 w-3 text-secondary-fg shrink-0" />}
          <span className="truncate">{block.title}</span>
          {!isCal && block.ai_reasoning && (
            <span className="shrink-0 text-primary/70" title="Why this slot">
              <Sparkles className="h-3 w-3" aria-hidden />
            </span>
          )}
        </div>
        <div className="text-[11px] text-secondary-fg mt-1 tabular-nums">{dur}</div>
      </div>
      {block.completed ? (
        <div data-tour={tourSpotlight ? "dayview-complete" : undefined} className="h-5 w-5 rounded-full bg-success flex items-center justify-center shrink-0">
          <Check className="h-3 w-3 text-success-foreground" strokeWidth={3} />
        </div>
      ) : (
        <div data-tour={tourSpotlight ? "dayview-complete" : undefined} className="h-5 w-5 rounded-full border-[1.5px] border-border shrink-0" />
      )}
    </div>
  );
};
