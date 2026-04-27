import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Block, fmtTime, typeColor, typeLabel } from "@/lib/daydraft";
import { Check, MapPin, Info, Trash2, GripVertical, Calendar } from "lucide-react";
import { mapsUrl } from "@/lib/maps";

export const SortableBlock = ({
  block, editing, onRemove, onInfo,
}: {
  block: Block & { ai_reasoning?: string | null; location?: string | null; location_lat?: number | null; location_lng?: number | null; is_calendar_event?: boolean };
  editing: boolean;
  onRemove: (id: string) => void;
  onInfo: (b: any) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: !editing });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const isCal = block.is_calendar_event;
  return (
    <div ref={setNodeRef} style={style} className="flex gap-3" data-tour="dayview-block">
      <div className="w-11 pt-3 text-right text-secondary-fg text-[12px] font-mono-sf tabular-nums">{fmtTime(block.start_time)}</div>
      <div className="w-[2px] rounded-full" style={{ background: isCal ? "hsl(var(--border))" : typeColor(block.type) }} />
      <div className={`flex-1 rounded-xl border p-3.5 transition-colors ${block.completed ? "opacity-55" : ""} ${isCal ? "bg-card/60 border-border/60" : "bg-card border-border shadow-card"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[14px] leading-snug flex items-center gap-1.5 min-w-0">
              {isCal && <Calendar className="h-3.5 w-3.5 text-secondary-fg shrink-0" />}
              <span className={`truncate min-w-0 ${block.completed ? "line-through text-secondary-fg" : ""}`}>{block.title}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-muted text-secondary-fg font-medium tabular-nums">{block.duration_min}m</span>
              {!isCal && (
                <span className="text-[10.5px] font-medium uppercase tracking-wide" style={{ color: typeColor(block.type) }}>{typeLabel(block.type)}</span>
              )}
              {block.location && (
                <a
                  href={mapsUrl(block.location, block.location_lat, block.location_lng)}
                  target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10.5px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/8 border border-primary/20 text-primary pressable"
                >
                  <MapPin className="h-3 w-3" /> {block.location}
                </a>
              )}
              {block.ai_reasoning && (
                <button onClick={() => onInfo(block)} className="text-[10.5px] inline-flex items-center gap-1 text-secondary-fg hover:text-primary pressable">
                  <Info className="h-3 w-3" /> Why
                </button>
              )}
            </div>
          </div>
          {editing ? (
            <div className="flex items-center gap-0.5">
              <button {...attributes} {...listeners} className="text-secondary-fg p-1 cursor-grab active:cursor-grabbing touch-none">
                <GripVertical className="h-4 w-4" />
              </button>
              {!isCal && (
                <button onClick={() => onRemove(block.id)} className="text-destructive p-1 pressable">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : block.completed ? (
            <div data-tour="dayview-complete" className="h-5 w-5 rounded-full bg-success flex items-center justify-center shrink-0">
              <Check className="h-3 w-3 text-success-foreground" strokeWidth={3} />
            </div>
          ) : (
            <div data-tour="dayview-complete" className="h-5 w-5 rounded-full border border-border shrink-0" />
          )}
        </div>
      </div>
    </div>
  );
};