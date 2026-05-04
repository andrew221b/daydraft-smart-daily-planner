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
      className={`group cursor-pointer pressable transition-all duration-200 app-card p-3 ${
        block.completed ? "opacity-65" : ""
      } ${isCal ? "border-soft" : "hover:border-primary/30 hover:-translate-y-[1px]"}`}
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0 min-w-[56px] h-10 rounded-xl border border-strong bg-background/45 backdrop-blur-sm px-2 inline-flex items-center justify-center text-secondary-fg text-[11.5px] font-mono-sf tabular-nums">
          {fmtTime(block.start_time)}
        </div>
        <div className="w-[4px] h-9 rounded-full shrink-0" style={{ background: isCal ? "hsl(var(--border))" : typeColor(block.type) }} />
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
          <div data-tour={tourSpotlight ? "dayview-complete" : undefined} className="h-6 w-6 rounded-full bg-success flex items-center justify-center shrink-0">
            <Check className="h-3 w-3 text-success-foreground" strokeWidth={3} />
          </div>
        ) : (
          <div data-tour={tourSpotlight ? "dayview-complete" : undefined} className="h-6 w-6 rounded-full border-[1.5px] border-soft shrink-0" />
        )}
      </div>
    </div>
  );
};
