import type React from "react";
import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "framer-motion";
import { Block, fmtTime, inferScheduleBlockType, isOpenUserTask, isUserTaskDone } from "@/lib/daydraft";
import {
  Check, Calendar, Layers, GripVertical, Sparkles, Play, Square,
  ChevronDown, Clock, Bell, Bookmark, Trash2,
} from "lucide-react";
import { haptics } from "@/lib/haptics";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

const MOVED_DATE_FMT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

type BlockExt = Block & {
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
  moved_to_date?: string | null;
};

export const SortableBlock = ({
  block,
  editing,
  onTap,
  onTapTime,
  onToggleComplete,
  onStartTrack,
  onStopTrack,
  trackingActive,
  assignedCategory,
  tourSpotlight,
  onCarryForward,
  onEditDuration,
  onEditReminders,
  onAskAi,
  onSaveTemplate,
  onDeleteBlock,
  isOverlay,
  isFuturePlan = false,
}: {
  block: BlockExt;
  editing: boolean;
  onTap?: (b: any) => void;
  onTapTime?: (b: any) => void;
  onToggleComplete?: (b: any) => void;
  onStartTrack?: (b: any) => void;
  onStopTrack?: (b: any) => void;
  trackingActive?: boolean;
  assignedCategory?: { id: string; name: string; color: string } | null;
  tourSpotlight?: boolean;
  onCarryForward?: (b: any) => void;
  onEditDuration?: (b: any) => void;
  onEditReminders?: (b: any) => void;
  onAskAi?: (b: any) => void;
  onSaveTemplate?: (b: any) => void;
  onDeleteBlock?: (b: any) => void;
  /** True when the plan date is in the future — completion is locked. */
  isFuturePlan?: boolean;
  isOverlay?: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sortableDisabled =
    !!block.is_calendar_event || (block.kind === "task" && !isOpenUserTask(block));

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    disabled: sortableDisabled,
  });

  const baseTransform = CSS.Transform.toString(transform) || "";
  const style: React.CSSProperties = {
    transform: isDragging ? `${baseTransform} scale(1.025)` : baseTransform,
    transition: isDragging
      ? "transform 160ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 200ms ease"
      : transition,
    boxShadow: isDragging
      ? "0 24px 56px -16px hsl(0 0% 0% / 0.55), 0 0 0 1px hsl(var(--primary) / 0.35)"
      : undefined,
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.98 : 1,
    touchAction: sortableDisabled ? undefined : "manipulation",
  };

  const isCal = block.is_calendar_event;
  const rhythmType = inferScheduleBlockType(block);
  const blockSubtype = (block as any).type as "deep_work" | "communication" | "routine" | undefined;

  const stripeColor = isCal
    ? "hsl(var(--border))"
    : rhythmType === "personal"
      ? "hsl(270 78% 66%)"
      : rhythmType === "rest"
        ? "hsl(var(--muted-foreground) / 0.7)"
        : blockSubtype === "communication"
          ? "hsl(var(--type-comm))"
          : blockSubtype === "routine"
            ? "hsl(var(--type-routine))"
            : "hsl(var(--type-deep))";

  const dur = block.duration_min < 60
    ? `${block.duration_min}m`
    : `${Math.floor(block.duration_min / 60)}h${block.duration_min % 60 ? ` ${block.duration_min % 60}m` : ""}`;

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

  const movedDateLabel = block.moved_to_date
    ? MOVED_DATE_FMT.format(new Date(block.moved_to_date + "T12:00:00"))
    : null;

  const isTask = block.kind === "task" && !isCal;
  const isDone = isUserTaskDone(block);
  const canExpand = isTask && !isOverlay;

  // Always top-align so grip/circle pin to the first text line regardless
  // of whether the title wraps to 2 lines (collapsed) or is fully expanded.
  const rowAlign = "items-start";

  const inlineActions = [
    { id: "duration",  icon: <Clock    className="h-3.5 w-3.5" />, label: "Duration",  cb: onEditDuration,  color: "text-sky-400/75"       },
    { id: "reminders", icon: <Bell     className="h-3.5 w-3.5" />, label: "Remind",    cb: onEditReminders, color: "text-violet-400/75"     },
    { id: "ai",        icon: <Sparkles className="h-3.5 w-3.5" />, label: "Ask AI",    cb: onAskAi,         color: "text-primary/75"        },
    { id: "template",  icon: <Bookmark className="h-3.5 w-3.5" />, label: "Template",  cb: onSaveTemplate,  color: "text-amber-400/75"      },
    { id: "delete",    icon: <Trash2   className="h-3.5 w-3.5" />, label: "Delete",    cb: onDeleteBlock,   color: "text-destructive/50", destructive: true },
  ] as const;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tour={tourSpotlight ? "dayview-block" : undefined}
      {...(sortableDisabled ? {} : attributes)}
      {...(sortableDisabled ? {} : listeners)}
      className={[
        "group cursor-pointer tappable app-card rounded-[18px] px-3.5 py-3.5 shadow-sm",
        isDragging ? "is-dragging" : "",
        trackingActive ? "ring-[1.5px] ring-primary/40 bg-primary/[0.04] shadow-[0_0_32px_hsl(var(--primary)/0.12)]" : "",
        isDone && block.kind === "task" ? "opacity-80" : "",
        !isCal && block.overlap_ok ? "border-l-[3px] border-l-primary/45" : "",
        isCal
          ? "!border-border/35"
          : rhythmType === "rest"
            ? "bg-muted/25 !border-border/35 hover:border-border/50"
            : rhythmType === "personal"
              ? "bg-[linear-gradient(165deg,hsl(278_72%_62%/.08)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] border-[hsl(270_70%_66%/.28)] hover:border-[hsl(270_72%_70%/.44)]"
              : blockSubtype === "communication"
                ? "bg-[linear-gradient(165deg,hsl(26_92%_67%/.06)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] !border-[hsl(26_92%_67%/.22)] hover:!border-[hsl(26_92%_67%/.38)]"
                : blockSubtype === "routine"
                  ? "bg-[linear-gradient(165deg,hsl(262_46%_68%/.06)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] !border-[hsl(262_46%_68%/.22)] hover:!border-[hsl(262_46%_68%/.38)]"
                  : "bg-[linear-gradient(165deg,hsl(200_89%_68%/.06)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] !border-[hsl(200_89%_68%/.22)] hover:!border-[hsl(200_89%_68%/.38)]",
      ].filter(Boolean).join(" ")}
      onClick={() => {
        if (canExpand) { haptics.selection(); setExpanded((v) => !v); }
      }}
    >
      {/* ── Main content row ── */}
      <div className={`flex ${rowAlign} gap-2`}>

        {/* Drag handle — decorative, the whole card is the drag target */}
        {!sortableDisabled ? (
          <div
            className={`shrink-0 flex h-8 w-6 items-center justify-center rounded-md pointer-events-none transition-colors ${
              isDragging ? "text-primary" : "text-secondary-fg/45"
            }`}
            aria-hidden
          >
            <GripVertical className="h-3.5 w-3.5" />
          </div>
        ) : (
          <div className="w-6 shrink-0" aria-hidden />
        )}

        {/* Inner flex: time · stripe · content · right-side */}
        <div className={`flex min-w-0 flex-1 ${rowAlign} gap-2.5`}>

          {/* Time pill / invisible placeholder when terminal */}
          {(() => {
            const isTerminal = isTask && (isDone || block.resolution === "skipped" || block.resolution === "missed");
            if (isTerminal) {
              return <div className="shrink-0 h-6 w-[38px]" aria-hidden />;
            }
            if (onTapTime && !block.is_calendar_event) {
              return (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onTapTime?.(block); }}
                  className="shrink-0 h-6 px-1.5 inline-flex items-center justify-center text-secondary-fg/85 text-[10px] font-mono-sf tabular-nums pressable hover:text-foreground transition-colors rounded-md"
                  aria-label="Change start time"
                >
                  {fmtTime(block.start_time)}
                </button>
              );
            }
            return (
              <div className="shrink-0 h-6 px-1.5 inline-flex items-center justify-center text-secondary-fg/70 text-[10px] font-mono-sf tabular-nums">
                {fmtTime(block.start_time)}
              </div>
            );
          })()}

          {/* Accent stripe */}
          <div className="w-[4px] h-8 rounded-full shrink-0" style={{ background: stripeColor }} />

          {/* Title + subtitle stack */}
          <div className="flex-1 min-w-0">
            <div className={[
              "flex items-center gap-1.5 min-w-0 leading-tight",
              rhythmType === "rest" ? "text-[13px]" : "text-[14px] font-medium",
              isDone && block.kind === "task" ? "text-foreground/65" : "text-foreground",
            ].join(" ")}>
              {isCal && <Calendar className="h-3 w-3 text-secondary-fg shrink-0" />}
              {!isCal && rhythmType === "rest" && <span className="shrink-0 text-[12px] leading-none" aria-hidden>☕</span>}
              <span className={[
                "flex-1 min-w-0",
                expanded ? "break-words whitespace-normal" : "line-clamp-2",
                isDone && block.kind === "task" ? "line-through" : "",
              ].join(" ")}>
                {block.title}
              </span>
              {!isCal && Boolean(block.overlap_ok) && (
                <Layers className="h-3 w-3 text-secondary-fg shrink-0" aria-hidden title="Runs alongside other work" />
              )}
              {!isCal && block.ai_reasoning && (
                <Sparkles className="h-3 w-3 text-primary/70 shrink-0" aria-hidden title="Why this slot" />
              )}
            </div>

            {/* Subtitle */}
            <div className={`${rhythmType === "rest" ? "text-[10px]" : "text-[11px]"} text-secondary-fg mt-[3px] tabular-nums leading-none`}>
              {isTask && movedDateLabel && block.resolution === "skipped" ? (
                <span className="text-sky-500/90 dark:text-sky-400/85">
                  Moved · {movedDateLabel}<span className="text-faint mx-1">·</span>
                </span>
              ) : isTask && block.resolution === "skipped" && block.resolved_at ? (
                <span className="text-amber-700/90 dark:text-amber-400/85">
                  Skipped · {new Date(block.resolved_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "")}
                  <span className="text-faint mx-1">·</span>
                </span>
              ) : isTask && block.resolution === "missed" && block.resolved_at ? (
                <span className="text-destructive/85">
                  Missed · {new Date(block.resolved_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "")}
                  <span className="text-faint mx-1">·</span>
                </span>
              ) : null}
              {isDone && block.completed_at && (
                <span className="text-faint">
                  Done {new Date(block.completed_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "")}
                  <span className="text-faint mx-1">·</span>
                </span>
              )}
              {isDone && actualMin != null ? (
                <>
                  <span className="font-medium text-foreground">{fmtMin(actualMin)}</span>
                  <span className="text-faint"> actual</span>
                  {estimatedMin !== actualMin && (
                    <span className="text-faint"> · {fmtMin(estimatedMin)} est</span>
                  )}
                </>
              ) : isDone ? (
                <span className="text-faint">{fmtMin(estimatedMin)} planned</span>
              ) : (
                <span className="text-faint">{dur}</span>
              )}
            </div>

            {isDone && actualMin != null && estimatedMin > 0 && actualMin >= 2 && (
              <div className={`mt-0.5 text-[10px] tabular-nums ${actualToneClass}`}>
                {actualDeltaRatio > 0.15
                  ? `${Math.round(actualDeltaRatio * 100)}% longer than planned`
                  : actualDeltaRatio < -0.15
                    ? `${Math.round(-actualDeltaRatio * 100)}% under plan`
                    : "On track vs plan"}
              </div>
            )}

            {trackingActive ? (
              <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-success/15 text-success border border-success/25 px-2 py-0.5 text-[11px] font-medium leading-none">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Tracking now
              </div>
            ) : assignedCategory ? (
              <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-border/45 bg-card/60 px-2 py-0.5 text-[11px] font-medium leading-none text-foreground/80">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: assignedCategory.color }} aria-hidden />
                {assignedCategory.name}
              </div>
            ) : null}
          </div>

          {/* Right side: optional track button · status · chevron */}
          <div className="flex items-center gap-1.5 shrink-0">
            {onStartTrack && !isCal && block.kind === "task" && isOpenUserTask(block) && (
              trackingActive ? (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onStopTrack?.(block); }}
                  className="shrink-0 h-8 rounded-full bg-success/15 text-success border border-success/30 inline-flex items-center justify-center gap-1 px-2.5 text-[11px] font-medium pressable hover:bg-success/22 transition-colors"
                  aria-label="Stop tracking"
                >
                  <Square className="h-3 w-3" fill="currentColor" /> Stop
                </button>
              ) : assignedCategory ? (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onStartTrack?.(block); }}
                  className="shrink-0 h-8 rounded-full border border-soft bg-card/70 inline-flex items-center justify-center gap-1.5 px-2.5 text-[11px] font-medium text-foreground/85 pressable hover:border-primary/35 transition-colors"
                  aria-label="Change tracker category"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: assignedCategory.color }} aria-hidden />
                  Change
                </button>
              ) : (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onStartTrack?.(block); }}
                  className="shrink-0 h-8 rounded-full border border-primary/35 bg-primary/10 text-primary inline-flex items-center justify-center gap-1 px-2.5 text-[11px] font-medium pressable hover:bg-primary/15 hover:border-primary/55 transition-colors"
                  aria-label="Assign tracker category"
                >
                  <Play className="h-3 w-3" fill="currentColor" /> Track
                </button>
              )
            )}

            {/* Status / complete circle */}
            {isTask && block.resolution === "skipped" ? (
              <div className="h-7 w-7 rounded-full border border-amber-500/40 bg-amber-500/10 shrink-0" title="Skipped" aria-hidden />
            ) : isTask && block.resolution === "missed" ? (
              <div className="h-7 w-7 rounded-full border border-destructive/35 bg-destructive/10 shrink-0" title="Missed" aria-hidden />
            ) : isDone || (block.completed && block.kind !== "task") ? (
              <CompleteCircleDone tourSpotlight={tourSpotlight} onToggle={() => onToggleComplete?.(block)} />
            ) : isFuturePlan && isTask ? (
              <CompleteCircleLocked />
            ) : (
              <CompleteCircleEmpty tourSpotlight={tourSpotlight} onToggle={() => onToggleComplete?.(block)} />
            )}

            {/* Expand chevron — only on expandable task cards */}
            {canExpand && (
              <div
                className="shrink-0 h-[18px] w-[18px] flex items-center justify-center text-secondary-fg/30 pointer-events-none"
                aria-hidden
                style={{
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 320ms cubic-bezier(0.34,1.56,0.64,1)",
                }}
              >
                <ChevronDown className="h-3 w-3" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent
          className="w-[calc(100vw-48px)] max-w-[340px] rounded-3xl border-border/40 bg-surface/95 p-0 backdrop-blur-2xl"
          style={{ WebkitBackdropFilter: "blur(32px)", backdropFilter: "blur(32px)" } as React.CSSProperties}
        >
          <AlertDialogHeader className="px-6 pt-6 pb-0 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/12 border border-destructive/20">
              <Trash2 className="h-5 w-5 text-destructive" />
            </div>
            <AlertDialogTitle className="text-[17px] font-semibold">
              Delete task?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-secondary-fg/80 mt-1">
              "{block.title}" will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col gap-2 px-6 py-5 sm:flex-col sm:space-x-0">
            <AlertDialogAction
              onClick={() => { haptics.impact("medium"); onDeleteBlock?.(block); }}
              className="h-11 w-full rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold text-[15px] border-0 pressable"
            >
              Delete
            </AlertDialogAction>
            <AlertDialogCancel className="h-11 w-full rounded-2xl border-border/35 bg-foreground/[0.05] text-foreground font-semibold text-[15px] hover:bg-foreground/[0.09] mt-0 pressable">
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Expandable panel ── */}
      <AnimatePresence initial={false}>
        {expanded && canExpand && (
          <motion.div
            key="expand"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 28, mass: 0.85 }}
            style={{ overflow: "hidden" }}
          >
            <div className="mt-3 pt-3 border-t border-border/[0.15]">

              {/* 5-action toolbar */}
              <div className="flex gap-2">
                {inlineActions.map(({ id, icon, label, cb, color, ...rest }) => {
                  const destructive = "destructive" in rest && (rest as any).destructive;
                  return (
                    <button
                      key={id}
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        haptics.tap();
                        if (destructive) { setConfirmDelete(true); return; }
                        cb?.(block);
                      }}
                      className={[
                        "flex-1 rounded-xl py-2.5 inline-flex flex-col items-center gap-1 pressable transition-[border-color,background-color] duration-200",
                        "border shadow-sm",
                        destructive
                          ? "border-destructive/15 bg-destructive/[0.06] hover:bg-destructive/[0.11] hover:border-destructive/25"
                          : "border-black/[0.08] bg-black/[0.05] dark:border-white/[0.09] dark:bg-white/[0.04] hover:bg-black/[0.08] hover:border-black/[0.14] dark:hover:bg-white/[0.08] dark:hover:border-white/[0.14]",
                      ].join(" ")}
                    >
                      <span className={color}>{icon}</span>
                      <span className="text-[9px] font-medium text-secondary-fg/55 leading-none tracking-wide">{label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Move to another day (missed / skipped only) */}
              {onCarryForward && (block.resolution === "missed" || block.resolution === "skipped") && (
                <div className="mt-2.5 flex justify-end">
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); haptics.impact("light"); onCarryForward(block); }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.07] px-3.5 py-1.5 text-[12px] font-semibold text-primary/80 hover:text-primary hover:border-primary/40 hover:bg-primary/[0.12] pressable transition-colors"
                  >
                    <Calendar className="h-3 w-3" />
                    Move
                  </button>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/** Future-plan circle — dashed SVG outline, not interactive.
 *  Communicates "planned but not yet actionable" without aggressive iconography. */
function CompleteCircleLocked() {
  return (
    <div
      className="relative h-8 w-8 shrink-0 pointer-events-none select-none"
      aria-label="Complete on the day"
    >
      <svg viewBox="0 0 32 32" className="absolute inset-0 w-full h-full opacity-35">
        <circle
          cx="16" cy="16" r="12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3.5 2.8"
          strokeLinecap="round"
          className="text-foreground"
        />
      </svg>
    </div>
  );
}

function CompleteCircleEmpty({
  tourSpotlight,
  onToggle,
}: {
  tourSpotlight?: boolean;
  onToggle: () => void;
}) {
  const [rippling, setRippling] = useState(false);
  return (
    <button
      type="button"
      data-tour={tourSpotlight ? "dayview-complete" : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        haptics.notify("success");
        setRippling(false);
        requestAnimationFrame(() => setRippling(true));
        onToggle();
      }}
      className="relative h-8 w-8 rounded-full border-[1.5px] border-border/60 shrink-0 pressable hover:border-primary/60 hover:bg-primary/10 shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)] transition-[border-color,background-color,box-shadow,transform]"
      aria-label="Mark done"
    >
      {rippling && (
        <span
          className="ripple-burst"
          onAnimationEnd={() => setRippling(false)}
          aria-hidden
        />
      )}
    </button>
  );
}

function CompleteCircleDone({
  tourSpotlight,
  onToggle,
}: {
  tourSpotlight?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-tour={tourSpotlight ? "dayview-complete" : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        haptics.tap();
        onToggle();
      }}
      className="relative h-8 w-8 rounded-full bg-success flex items-center justify-center shrink-0 pressable shadow-[0_4px_14px_-2px_hsl(var(--success)/0.55)] ring-1 ring-white/20"
      aria-label="Mark as not done"
    >
      <Check className="h-4 w-4 text-success-foreground row-check-pop" strokeWidth={3} />
    </button>
  );
}
