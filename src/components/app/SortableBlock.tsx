import type React from "react";
import { memo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Block, fmtTime, inferScheduleBlockType, isOpenUserTask, isUserTaskDone } from "@/lib/daydraft";
import { Check, Calendar, Layers, GripVertical, Sparkles, Play, Square } from "lucide-react";

const SortableBlockInner = ({
  block, editing, onTap, onTapTime, onToggleComplete, onStartTrack, onStopTrack, trackingActive, assignedCategory, tourSpotlight,
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
  onStartTrack?: (b: any) => void;
  onStopTrack?: (b: any) => void;
  /** True if the live timer is currently running on this block. */
  trackingActive?: boolean;
  /** Category the user has earmarked for this block (not yet ticking). */
  assignedCategory?: { id: string; name: string; color: string } | null;
  /** First visible row — tour hotspot only on one element. */
  tourSpotlight?: boolean;
}) => {
  const sortableDisabled =
    !!block.is_calendar_event || (block.kind === "task" && !isOpenUserTask(block));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    disabled: sortableDisabled,
  });
  // Compose the dnd-kit transform with our own scale/lift while dragging.
  // The iOS-style cue: the card grows slightly, lifts on a real shadow,
  // and floats above its neighbours (z-index). Non-dragging rows keep
  // dnd-kit's own transition so they rearrange smoothly underneath.
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
      // dnd-kit attributes + listeners are spread on the whole card so a
      // long-press anywhere on the row lifts it (matching iOS "edit mode"
      // home-screen behavior). The activation delay (220ms) means quick
      // taps still pass through to onClick handlers below.
      {...(sortableDisabled ? {} : attributes)}
      {...(sortableDisabled ? {} : listeners)}
      className={`group cursor-pointer tappable app-card rounded-[20px] px-3.5 py-3.5 shadow-sm list-row-contain ${
        isDragging ? "is-dragging" : ""
      } ${
        trackingActive ? "ring-[1.5px] ring-primary/40 bg-primary/[0.04] shadow-[0_0_32px_hsl(var(--primary)/0.12)]" : ""
      } ${
        isUserTaskDone(block) && block.kind === "task" ? "opacity-80" : ""
      } ${
        !isCal && block.overlap_ok ? "border-l-[3px] border-l-primary/45" : ""
      } ${
        isCal
          ? "!border-border/35"
          : rhythmType === "rest"
            ? "bg-muted/25 !border-border/35 hover:border-border/50"
            : rhythmType === "personal"
              ? "bg-[linear-gradient(165deg,hsl(278_72%_62%/.08)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] border-[hsl(270_70%_66%/.28)] hover:border-[hsl(270_72%_70%/.44)]"
              : "!border-border/40 hover:border-border/55 hover:!border-primary/30"
      }`}
    >
      <div className="flex items-center gap-2">
        {!sortableDisabled ? (
          // Decorative-only handle — the press target is the whole row.
          // The icon brightens during drag so the user gets visual
          // confirmation they're moving it.
          <div
            className={`shrink-0 flex h-9 w-8 items-center justify-center rounded-lg pointer-events-none transition-colors ${
              isDragging ? "text-primary" : "text-secondary-fg/55"
            }`}
            aria-hidden
          >
            <GripVertical className="h-4 w-4" />
          </div>
        ) : (
          <div className="w-8 shrink-0" aria-hidden />
        )}
        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
          onClick={() => onTap?.(block)}
        >
        {/*
          Time column. Fixed-width + right-aligned so the blue stripe
          to its right stays vertically aligned across every row, no
          matter whether the slot is a round hour ("14") or a partial
          time ("14:30"). `w-[3.25rem]` fits the widest reasonable
          locale output (24h "23:45" or 12h "12:45pm") with breathing
          room either side.

          Hide the planned start time for tasks that have already
          resolved (done / missed / skipped). The status row under the
          title already carries the meaningful timestamp; we keep an
          invisible placeholder of the same width so the stripe stays
          aligned with the still-active rows above.
        */}
        {(() => {
          const isTerminal =
            block.kind === "task" && !isCal && (
              isUserTaskDone(block) ||
              block.resolution === "skipped" ||
              block.resolution === "missed"
            );
          if (isTerminal) {
            return <div className="shrink-0 h-6 w-[3.25rem]" aria-hidden />;
          }
          if (onTapTime && !block.is_calendar_event) {
            return (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onTapTime?.(block); }}
                className="shrink-0 h-6 w-[3.25rem] pr-1.5 inline-flex items-center justify-end text-secondary-fg/85 text-[10.5px] font-mono-sf tabular-nums pressable hover:text-foreground transition-colors rounded-md"
                aria-label="Change start time"
                title="Change start time"
              >
                {fmtTime(block.start_time)}
              </button>
            );
          }
          return (
            <div className="shrink-0 h-6 w-[3.25rem] pr-1.5 inline-flex items-center justify-end text-secondary-fg/70 text-[10.5px] font-mono-sf tabular-nums">
              {fmtTime(block.start_time)}
            </div>
          );
        })()}
        <div className="w-[4px] h-8 rounded-full shrink-0" style={{ background: stripeColor }} />
        <div className="flex-1 min-w-0">
          <div className={`leading-tight flex items-center gap-1.5 min-w-0 ${rhythmType === "rest" ? "text-[12.5px]" : "text-[14px] font-medium"} ${isUserTaskDone(block) && block.kind === "task" ? "text-foreground/65" : "text-foreground"}`}>
          {isCal && <Calendar className="h-3 w-3 text-secondary-fg shrink-0" />}
          {!isCal && rhythmType === "rest" && <span className="shrink-0 text-[12px] leading-none" aria-hidden>☕</span>}
          <span className={`truncate ${isUserTaskDone(block) && block.kind === "task" ? "line-through" : ""}`}>{block.title}</span>
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
            ) : isUserTaskDone(block) ? (
              <span className="text-faint">{fmtMin(estimatedMin)} planned</span>
            ) : (
              <span className="text-faint">{dur}</span>
            )}
          </div>
          {isUserTaskDone(block) && actualMin != null && estimatedMin > 0 && actualMin >= 2 && (
            <div className={`mt-0.5 text-[10px] tabular-nums ${actualToneClass}`}>
              {actualDeltaRatio > 0.15
                ? `${Math.round(actualDeltaRatio * 100)}% longer than planned`
                : actualDeltaRatio < -0.15
                  ? `${Math.round(-actualDeltaRatio * 100)}% under plan`
                  : "On track vs plan"}
            </div>
          )}
          {trackingActive ? (
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-success/15 text-success border border-success/25 px-2 py-0.5 text-[10.5px] font-medium leading-none">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Tracking now
            </div>
          ) : assignedCategory ? (
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border/45 bg-card/60 px-2 py-0.5 text-[10.5px] font-medium leading-none text-foreground/80">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: assignedCategory.color }} aria-hidden />
              {assignedCategory.name}
            </div>
          ) : null}
        </div>
        {onStartTrack && !isCal && block.kind === "task" && isOpenUserTask(block) && (
          trackingActive ? (
            // Live timer running on this block — keep the stop affordance.
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onStopTrack?.(block); }}
              className="shrink-0 h-8 rounded-full bg-success/15 text-success border border-success/30 inline-flex items-center justify-center gap-1 px-2.5 text-[11px] font-medium pressable hover:bg-success/22 transition-colors"
              aria-label="Stop tracking"
              title="Stop tracking"
            >
              <Square className="h-3 w-3" fill="currentColor" /> Stop
            </button>
          ) : assignedCategory ? (
            // Category earmarked — tap to change/clear; tracker starts when the
            // user enters Focus on this block, not here.
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onStartTrack?.(block); }}
              className="shrink-0 h-8 rounded-full border border-soft bg-card/70 inline-flex items-center justify-center gap-1.5 px-2.5 text-[11px] font-medium text-foreground/85 pressable hover:border-primary/35 transition-colors"
              aria-label="Change tracker category"
              title="Change tracker category"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: assignedCategory.color }} aria-hidden />
              Change
            </button>
          ) : (
            // No category yet — tapping just earmarks one (no timer starts).
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onStartTrack?.(block); }}
              className="shrink-0 h-8 rounded-full border border-primary/35 bg-primary/10 text-primary inline-flex items-center justify-center gap-1 px-2.5 text-[11px] font-medium pressable hover:bg-primary/15 hover:border-primary/55 transition-colors"
              aria-label="Assign a tracker category to this task"
              title="Pick a tracker category for this task"
            >
              <Play className="h-3 w-3" fill="currentColor" /> Track
            </button>
          )
        )}
        {block.kind === "task" && !isCal && block.resolution === "skipped" ? (
          <div className="h-6 w-6 rounded-full border border-amber-500/40 bg-amber-500/10 shrink-0" title="Skipped" aria-hidden />
        ) : block.kind === "task" && !isCal && block.resolution === "missed" ? (
          <div className="h-6 w-6 rounded-full border border-destructive/35 bg-destructive/10 shrink-0" title="Missed" aria-hidden />
        ) : isUserTaskDone(block) || (block.completed && block.kind !== "task") ? (
          <CompleteCircleDone
            tourSpotlight={tourSpotlight}
            onToggle={() => onToggleComplete?.(block)}
          />
        ) : (
          <CompleteCircleEmpty
            tourSpotlight={tourSpotlight}
            onToggle={() => onToggleComplete?.(block)}
          />
        )}
        </div>
      </div>
    </div>
  );
};

/**
 * Memoized so a render of the parent DayView (very common — any state
 * change up there) doesn't cascade into a re-render of every block row.
 * The block list is one of the largest trees in the app; this is the
 * single most impactful memo on the screen.
 */
export const SortableBlock = memo(SortableBlockInner);

/**
 * Empty completion circle. On tap, fires a quick radial ripple from the
 * circle's own footprint before handing off to the parent — the ripple
 * is what makes the "I tapped done" moment feel reactive even before the
 * server roundtrip lands and flips the row to its done state.
 */
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
        setRippling(false);
        // Force-restart the keyframe by toggling off-then-on in the next frame.
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

/**
 * Filled "done" circle. Springs the check icon in on mount so the
 * transition from empty → done feels like a real iOS gesture (the icon
 * pops, the circle settles).
 */
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
        onToggle();
      }}
      className="relative h-8 w-8 rounded-full bg-success flex items-center justify-center shrink-0 pressable shadow-[0_4px_14px_-2px_hsl(var(--success)/0.55)] ring-1 ring-white/20"
      aria-label="Mark as not done"
    >
      <Check className="h-4 w-4 text-success-foreground row-check-pop" strokeWidth={3} />
    </button>
  );
}
