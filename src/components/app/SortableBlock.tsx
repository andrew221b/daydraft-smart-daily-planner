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
    <div ref={setNodeRef} style={style} className="flex gap-3">
      <div className="w-12 pt-3 text-right text-secondary-fg text-[13px] font-mono-sf">{fmtTime(block.start_time)}</div>
      <div className="w-[3px] rounded-full" style={{ background: isCal ? "hsl(var(--muted-foreground))" : typeColor(block.type) }} />
      <div className={`flex-1 rounded-2xl border shadow-card p-4 ${block.completed ? "opacity-50" : ""} ${isCal ? "bg-surface-elevated/60 border-border/60" : "bg-surface border-border"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[15px] leading-snug flex items-center gap-1.5">
              {isCal && <Calendar className="h-3.5 w-3.5 text-secondary-fg shrink-0" />}
              <span className="truncate">{block.title}</span>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-elevated text-secondary-fg">{block.duration_min} min</span>
              {!isCal && (
                <span className="text-xs font-medium" style={{ color: typeColor(block.type) }}>{typeLabel(block.type)}</span>
              )}
              {block.location && (
                <a
                  href={mapsUrl(block.location, block.location_lat, block.location_lng)}
                  target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-primary pressable"
                >
                  <MapPin className="h-3 w-3" /> {block.location}
                </a>
              )}
              {block.ai_reasoning && (
                <button onClick={() => onInfo(block)} className="text-xs inline-flex items-center gap-1 text-secondary-fg hover:text-primary pressable">
                  <Info className="h-3 w-3" /> Why?
                </button>
              )}
            </div>
          </div>
          {editing ? (
            <div className="flex items-center gap-1">
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
            <div className="h-6 w-6 rounded-full bg-success flex items-center justify-center">
              <Check className="h-3.5 w-3.5 text-success-foreground" strokeWidth={3} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};