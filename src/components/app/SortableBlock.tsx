import type React from "react";
import { useState, memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "framer-motion";
import { Block, fmtTime, inferScheduleBlockType, isOpenUserTask, isUserTaskDone } from "@/lib/daydraft";
import {
  Check, Calendar, GripVertical, Sparkles, Play, Square, Timer,
  ChevronDown, Clock, Bell, Bookmark, Trash2, RotateCcw, SkipForward, Pencil, X as XIcon, Flag, Navigation,
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

export const SortableBlock = memo(({
  block,
  editing: _editing,
  onTapTime,
  onToggleComplete,
  onStartTrack,
  onStopTrack,
  trackingActive,
  assignedCategory,
  tourSpotlight,
  hintAnchor,
  onCarryForward,
  onEditDuration,
  onEditReminders,
  onAskAi,
  onSaveTemplate,
  onSkip,
  onDeleteBlock,
  onRename,
  onTogglePriority,
  isOverlay,
  isFuturePlan = false,
  readOnly = false,
  lateMin,
}: {
  block: BlockExt;
  editing: boolean;
  onTapTime?: (b: Block, newTime?: string) => void;
  /** Earliest selectable time (HH:MM). Passed to the inline time input's min attribute. */

  onToggleComplete?: (b: Block) => void;
  onStartTrack?: (b: Block) => void;
  onStopTrack?: (b: Block) => void;
  trackingActive?: boolean;
  assignedCategory?: { id: string; name: string; color: string } | null;
  tourSpotlight?: boolean;
  /** Marks this card as the anchor target for the in-context timeline hint. */
  hintAnchor?: boolean;
  onCarryForward?: (b: Block) => void;
  onEditDuration?: (b: Block) => void;
  onEditReminders?: (b: Block) => void;
  onAskAi?: (b: Block) => void;
  onSaveTemplate?: (b: Block) => void;
  /** Skip an open task (no duration / not yet due). Marks it skipped without deleting. */
  onSkip?: (b: Block) => void;
  onDeleteBlock?: (b: Block) => void;
  onRename?: (b: Block, newTitle: string) => void;
  /** Toggle the "important" priority flag (amber highlight). */
  onTogglePriority?: (b: Block) => void;
  /** True when the plan date is in the future — completion is locked. */
  isFuturePlan?: boolean;
  /** True when the plan date is in the past — the whole row is a frozen,
   *  read-only snapshot: no toggling, tracking, editing, deleting or dragging.
   *  Only "Move to another day" stays available (for missed/skipped tasks). */
  readOnly?: boolean;
  isOverlay?: boolean;
  /** Minutes past the scheduled start for the single next-overdue open task.
   *  Shown as amber "~Xm late" below the time pill. Only passed for that one block. */
  lateMin?: number;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStopTrack, setConfirmStopTrack] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  const sortableDisabled =
    readOnly || !!block.is_calendar_event || (block.kind === "task" && !isOpenUserTask(block));

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
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
    // No "is-over" highlight on resolved or locked blocks — they're not valid drop targets.
    ...(isOver && !isDragging && !sortableDisabled
      ? { boxShadow: "0 0 0 2px hsl(var(--primary) / 0.8)", transform: "scale(1.01)", transition: "all 150ms ease" }
      : {}),
  };

  const isCal = block.is_calendar_event;
  const rhythmType = inferScheduleBlockType(block);
  const blockSubtype = block.type as "deep_work" | "communication" | "routine" | undefined;

  // User-set "important" flag — amber accent across stripe, title flag, and a
  // soft outline so it stands out from the rest of the plan. Only meaningful on
  // real tasks (never calendar events).
  const isPriority = !isCal && Boolean(block.priority);

  const stripeColor = isCal
    ? "hsl(var(--border))"
    : isPriority
      ? "hsl(38 92% 52%)"
      : "hsl(var(--primary) / 0.6)";

  // Frameless task (duration_min <= 0) = a point in the day, no timer span:
  // show no duration pill at all.
  const durMin = Number(block.duration_min) || 0;
  const dur = durMin <= 0
    ? ""
    : durMin < 60
      ? `${durMin}m`
      : `${Math.floor(durMin / 60)}h${durMin % 60 ? ` ${durMin % 60}m` : ""}`;

  // Split the formatted start time into a big numeric part + a small am/pm
  // suffix so the enlarged time reads cleanly and still fits the tight left
  // rail on both 12h ("9:30am") and 24h ("09:30") locales.
  const rawStartTime = fmtTime(block.start_time);
  // fmtTime now separates the marker with a space ("9:30 pm"); swallow that
  // space too so the enlarged number and the tiny suffix keep their own
  // gap-px spacing below instead of inheriting a literal space.
  const startAmPmMatch = rawStartTime.match(/\s*(am|pm)$/i);
  const startAmPm = startAmPmMatch?.[1] ?? "";
  const startTimeMain = startAmPmMatch
    ? rawStartTime.slice(0, startAmPmMatch.index).trimEnd()
    : rawStartTime;

  const fmtMin = (mins: number) =>
    mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;

  const fmtLate = (mins: number) =>
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

  const isTask = block.kind === "task" && !isCal;
  const isDone = isUserTaskDone(block);
  const isFinished = !!block.completed || block.resolution === "missed" || block.resolution === "skipped";
  const isTerminal = isTask && (isDone || block.resolution === "skipped" || block.resolution === "missed");
  // Resolved tasks (done/skipped/missed) can now expand too — to show the Rename button.
  const canExpand = isTask && !isOverlay && !readOnly;

  // Always top-align so grip/circle pin to the first text line regardless
  // of whether the title wraps to 2 lines (collapsed) or is fully expanded.
  const rowAlign = "items-start";

  const inlineActions = [
    { id: "duration",  icon: <Clock       className="h-3.5 w-3.5" />, label: "Duration",  cb: onEditDuration,  color: "text-sky-400/75"       },
    { id: "skip",      icon: <SkipForward className="h-3.5 w-3.5" />, label: "Skip",      cb: onSkip,          color: "text-amber-400/80"     },
    { id: "reminders", icon: <Bell        className="h-3.5 w-3.5" />, label: "Remind",    cb: onEditReminders, color: "text-violet-400/75"     },
    { id: "ai",        icon: <Sparkles    className="h-3.5 w-3.5" />, label: "Coach",     cb: onAskAi,         color: "text-primary/75"        },
    { id: "template",  icon: <Bookmark    className="h-3.5 w-3.5" />, label: "Template",  cb: onSaveTemplate,  color: "text-amber-400/75"      },
    { id: "delete",    icon: <Trash2      className="h-3.5 w-3.5" />, label: "Delete",    cb: onDeleteBlock,   color: "text-destructive/50", destructive: true },
  ] as const;

  if (block.kind === "break") {
    const h = Math.floor(block.duration_min / 60);
    const m = block.duration_min % 60;
    const durStr = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;

    // addBuffers() only ever emits these generic titles for anonymous
    // decompression padding with no real destination/purpose — since
    // 2026-07-02 localized (Буфер/Передышка) when the plan's input was
    // Russian. Anything else reaching kind="break" (AI-written travel/prep/
    // meeting-buffer blocks) always carries a real, specific title — show it
    // instead of treating accounted-for time as an empty "gap".
    const GENERIC_BUFFER_TITLES = new Set(["Buffer", "Transition", "Буфер", "Передышка"]);
    const isGenericBuffer = !block.title || GENERIC_BUFFER_TITLES.has(block.title);

    if (!isGenericBuffer) {
      return (
        <div
          ref={setNodeRef}
          style={style}
          {...(sortableDisabled ? {} : attributes)}
          {...(sortableDisabled ? {} : listeners)}
          className={[
            "group relative flex items-center gap-2 py-2 px-3.5 cursor-pointer outline-none rounded-2xl border border-dashed border-border/70 bg-background",
            isDragging ? "is-dragging opacity-60" : "opacity-80 hover:opacity-100 transition-opacity",
          ].filter(Boolean).join(" ")}
        >
          <Navigation className="h-3.5 w-3.5 text-secondary-fg shrink-0" />
          <span className="flex-1 text-[12.5px] font-medium text-secondary-fg truncate">{block.title}</span>
          <span className="text-[11px] text-secondary-fg shrink-0 tabular-nums">{durStr}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteBlock(block);
            }}
            className="p-1 -mr-1 hover:bg-destructive/10 hover:text-destructive rounded-full transition-colors pressable shrink-0"
            aria-label={`Remove ${block.title}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      );
    }

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...(sortableDisabled ? {} : attributes)}
        {...(sortableDisabled ? {} : listeners)}
        className={[
          "group relative flex items-center justify-center py-2 px-4 cursor-pointer outline-none",
          isDragging ? "is-dragging opacity-50" : "opacity-60 hover:opacity-100 transition-opacity",
        ].filter(Boolean).join(" ")}
      >
        <div className="absolute inset-x-0 h-px border-t border-dashed border-border/70" />
        <div className="relative z-10 flex items-center gap-2 px-3 py-1 bg-background rounded-full border border-border/70 text-[11px] font-medium text-secondary-fg">
          <span>{durStr} free time</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteBlock(block);
            }}
            className="p-1 -mr-1 hover:bg-destructive/10 hover:text-destructive rounded-full transition-colors pressable"
            aria-label="Remove gap"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={
        isPriority
          ? { ...style, outline: "1.5px solid hsl(38 92% 52% / 0.6)", outlineOffset: "-1.5px" }
          : style
      }
      data-tour={tourSpotlight ? "dayview-block" : undefined}
      data-hint={hintAnchor ? "timeline-task" : undefined}
      {...(sortableDisabled ? {} : attributes)}
      {...(sortableDisabled ? {} : listeners)}
      className={[
        "group relative cursor-pointer tappable app-card rounded-[18px] px-3.5 py-3.5",
        // Onboarding-showcase card shadow: a soft drop + an inner top highlight
        // for a glassy lift. Tracking adds the primary glow on top of that base.
        isDragging ? "is-dragging" : "",
        trackingActive
          ? "ring-[1.5px] ring-primary/40 bg-primary/[0.04] shadow-[0_12px_40px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.2),0_0_32px_hsl(var(--primary)/0.12)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.05),0_0_32px_hsl(var(--primary)/0.12)]"
          : "shadow-[0_12px_40px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.2)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.05)]",
        isDone && block.kind === "task" ? "opacity-80" : "",
        "border-[1.5px]",
        isCal
          ? "!border-border/65"
          : rhythmType === "rest"
            ? "bg-muted/25 !border-border/65 hover:border-border/80"
            : rhythmType === "personal"
              ? "bg-[linear-gradient(165deg,hsl(278_72%_62%/.08)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] !border-[hsl(270_70%_66%/.55)] hover:!border-[hsl(270_72%_70%/.70)]"
              : blockSubtype === "communication"
                ? "bg-[linear-gradient(165deg,hsl(26_92%_67%/.06)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] !border-[hsl(26_92%_67%/.45)] hover:!border-[hsl(26_92%_67%/.60)]"
                : blockSubtype === "routine"
                  ? "bg-[linear-gradient(165deg,hsl(262_46%_68%/.06)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] !border-[hsl(262_46%_68%/.45)] hover:!border-[hsl(262_46%_68%/.60)]"
                  : "bg-[linear-gradient(165deg,hsl(200_89%_68%/.06)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] !border-[hsl(200_89%_68%/.45)] hover:!border-[hsl(200_89%_68%/.60)]",
      ].filter(Boolean).join(" ")}
      onClick={() => {
        if (renaming) return;
        if (canExpand) { haptics.selection(); setExpanded((v) => !v); }
      }}
    >
      {/* Glassy diagonal sheen — matches the onboarding showcase cards. Sits
          below the content (z-0) and is clipped to the card's rounded corners. */}
      <div
        className="pointer-events-none absolute inset-0 rounded-[18px] bg-gradient-to-br from-white/10 to-transparent"
        aria-hidden
      />
      {/* ── Main content row ── */}
      <div className={`relative z-10 flex ${rowAlign} gap-1.5`}>

        {/* Drag handle — thin & decorative; the whole card is the drag target */}
        {!sortableDisabled ? (
          <div
            className={`shrink-0 flex h-9 w-4 items-center justify-center rounded-md pointer-events-none transition-colors ${
              isDragging ? "text-primary" : "text-secondary-fg/40"
            }`}
            aria-hidden
          >
            <GripVertical className="h-3.5 w-3.5" />
          </div>
        ) : (
          <div className={`${isTerminal ? "w-1" : "w-4"} shrink-0`} aria-hidden />
        )}

        {/* Inner flex: time-rail · stripe · content · right-side */}
        <div className={`flex min-w-0 flex-1 ${rowAlign} gap-2`}>

          {/* ── Left time rail: large start time, or the full status when resolved ── */}
          {(() => {
            const isTerminal = isTask && (isDone || block.resolution === "skipped" || block.resolution === "missed");
            if (isTerminal) {
              const fmtResTime = (iso: string | null | undefined) =>
                iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "") : null;

              let label = "";
              let timeStr: string | null = null;
              let colorClass = "";

              if (isDone) {
                label = "Done";
                timeStr = fmtResTime(block.completed_at);
                colorClass = "text-emerald-500 dark:text-emerald-400";
              } else if (block.resolution === "skipped" && block.moved_to_date) {
                label = "Moved";
                timeStr = MOVED_DATE_FMT.format(new Date(block.moved_to_date + "T12:00:00"));
                colorClass = "text-sky-500 dark:text-sky-400";
              } else if (block.resolution === "skipped") {
                label = "Skipped";
                timeStr = fmtResTime(block.resolved_at);
                colorClass = "text-amber-500 dark:text-amber-400";
              } else if (block.resolution === "missed") {
                label = "Missed";
                timeStr = fmtResTime(block.resolved_at);
                colorClass = "text-destructive/85";
              }

              return (
                <div className="shrink-0 h-9 justify-center w-[62px] flex flex-col items-start gap-0.5 pl-0.5">
                  <span className={`text-[13.5px] font-bold leading-none tracking-[0.02em] uppercase whitespace-nowrap ${colorClass}`}>
                    {label}
                  </span>
                  {timeStr && (
                    <span className="text-[12px] font-mono-sf tabular-nums text-secondary-fg/60 leading-none whitespace-nowrap">
                      {timeStr}
                    </span>
                  )}
                </div>
              );
            }
            const lateIndicator = (lateMin ?? 0) >= 2 ? (
              <div className="text-[9px] font-semibold text-amber-500 dark:text-amber-400 tabular-nums leading-none mt-1 text-center whitespace-nowrap">
                ~{fmtLate(lateMin ?? 0)} late
              </div>
            ) : null;
            const timeDisplay = (
              <div className="flex items-baseline justify-center gap-px leading-none">
                <span className="text-[15px] font-semibold tabular-nums leading-none">{startTimeMain}</span>
                {startAmPm && <span className="text-[9px] font-semibold lowercase leading-none">{startAmPm}</span>}
              </div>
            );
            if (onTapTime && !block.is_calendar_event && !readOnly) {
              return (
                <div
                  className="relative shrink-0 w-[56px] flex flex-col items-center"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    className="relative px-1 w-full h-9 flex items-center justify-center text-secondary-fg/90 pressable hover:text-foreground transition-colors rounded-md cursor-pointer select-none"
                    aria-label="Change start time"
                  >
                    <span className="pointer-events-none">{timeDisplay}</span>
                    {/* Native time picker — overlays only the time row, not the late hint */}
                    <input
                      type="time"
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                      value={block.start_time || ""}
                      min={undefined}
                      tabIndex={-1}
                      style={{ fontSize: 16 }}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) onTapTime(block, val);
                      }}
                    />
                  </div>
                  {lateIndicator}
                </div>
              );
            }
            return (
              <div className="shrink-0 w-[56px] flex flex-col items-center text-secondary-fg/75">
                <div className="h-9 flex items-center justify-center">{timeDisplay}</div>
                {lateIndicator}
              </div>
            );
          })()}

          {/* Accent stripe */}
          <div className="w-[4px] h-9 rounded-full shrink-0" style={{ background: stripeColor }} />

          {/* Title + subtitle stack */}
          <div className="flex-1 min-w-0">
            <div className={[
              "flex items-center gap-1.5 min-w-0 leading-tight",
              rhythmType === "rest" ? "text-[13px]" : "text-[14px] font-medium",
              isDone && block.kind === "task" ? "text-foreground/65" : "text-foreground",
            ].join(" ")}>
              {isCal && <Calendar className="h-3 w-3 text-secondary-fg shrink-0" />}
              {!isCal && rhythmType === "rest" && <span className="shrink-0 text-[12px] leading-none" aria-hidden>☕</span>}
              {isPriority && <Flag className="h-3 w-3 text-amber-500 dark:text-amber-400 shrink-0" fill="currentColor" aria-label="Priority" />}
              <span className={[
                "flex-1 min-w-0",
                expanded ? "break-words whitespace-normal" : "line-clamp-2",
                isDone && block.kind === "task" ? "line-through" : "",
              ].join(" ")}>
                {block.title}
              </span>
            </div>

            {/* Meta line — done: actual/planned; active: duration + inline category chip */}
            {isDone ? (
              <div className={`${rhythmType === "rest" ? "text-[10px]" : "text-[11px]"} text-secondary-fg mt-[3px] tabular-nums leading-none`}>
                {actualMin != null ? (
                  <>
                    <span className="font-medium text-foreground">{fmtMin(actualMin)}</span>
                    <span className="text-faint"> actual</span>
                    {estimatedMin !== actualMin && (
                      <span className="text-faint"> · {fmtMin(estimatedMin)} est</span>
                    )}
                  </>
                ) : estimatedMin > 0 ? (
                  <span className="text-faint">{fmtMin(estimatedMin)} planned</span>
                ) : null}
              </div>
            ) : (dur || (assignedCategory && !trackingActive)) ? (
              <div className="mt-[3px] flex items-center gap-1.5 min-w-0 leading-none text-[11px]">
                {dur && <span className="text-faint tabular-nums shrink-0">{dur}</span>}
                {dur && assignedCategory && !trackingActive && (
                  <span className="text-secondary-fg/30 shrink-0">·</span>
                )}
                {assignedCategory && !trackingActive && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: assignedCategory.color }} aria-hidden />
                    <span className="truncate font-medium text-foreground/70">{assignedCategory.name}</span>
                  </span>
                )}
              </div>
            ) : null}

            {isDone && actualMin != null && estimatedMin > 0 && actualMin >= 2 && (
              <div className={`mt-0.5 text-[10px] tabular-nums ${actualToneClass}`}>
                {actualDeltaRatio > 0.15
                  ? `${Math.round(actualDeltaRatio * 100)}% longer than planned`
                  : actualDeltaRatio < -0.15
                    ? `${Math.round(-actualDeltaRatio * 100)}% under plan`
                    : "On track vs plan"}
              </div>
            )}

            {/* Live tracking pill — only while a Focus session runs for this block */}
            {trackingActive && (
              <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-success/15 text-success border border-success/25 px-2 py-0.5 text-[11px] font-medium leading-none">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Tracking now
              </div>
            )}
          </div>

          {/* Right side: live Stop (Focus session) · Move · status · chevron.
              The category-assign Track/Change button now lives in the accordion. */}
          <div className="h-9 flex items-center gap-1.5 shrink-0">
            {trackingActive && onStopTrack && !isCal && block.kind === "task" && !readOnly && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setConfirmStopTrack(true); }}
                className="shrink-0 h-8 rounded-full bg-success/15 text-success border border-success/30 inline-flex items-center justify-center gap-1 px-2.5 text-[11px] font-medium pressable hover:bg-success/22 transition-colors"
                aria-label="Stop tracking"
              >
                <Square className="h-3 w-3" fill="currentColor" /> Stop
              </button>
            )}

            {/* Status / complete circle — skipped & missed stay tappable so the
                user can still mark the task done after the fact (opens the
                late-complete sheet via onToggleComplete). On a read-only (past)
                row every status is frozen and non-interactive. */}
            {readOnly && isTask ? (
              <ReadOnlyStatusCircle
                variant={
                  isDone ? "done"
                    : block.resolution === "skipped" ? "skipped"
                    : block.resolution === "missed" ? "missed"
                    : "open"
                }
              />
            ) : readOnly ? null : isTask && block.resolution === "skipped" ? (
              <StatusCompleteCircle tone="amber" label="Skipped — tap to mark done" onToggle={() => onToggleComplete?.(block)} />
            ) : isTask && block.resolution === "missed" ? (
              <StatusCompleteCircle tone="red" label="Missed — tap to mark done" onToggle={() => onToggleComplete?.(block)} />
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
          className="w-[calc(100vw-48px)] max-w-[340px] rounded-3xl border-border/70 bg-surface/95 p-0 backdrop-blur-2xl"
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
            <AlertDialogCancel className="h-11 w-full rounded-2xl border-border/65 bg-foreground/[0.05] text-foreground font-semibold text-[15px] hover:bg-foreground/[0.09] mt-0 pressable">
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Stop tracking confirmation ── */}
      <AlertDialog open={confirmStopTrack} onOpenChange={setConfirmStopTrack}>
        <AlertDialogContent
          className="w-[calc(100vw-48px)] max-w-[340px] rounded-3xl border-border/70 bg-surface/95 p-0 backdrop-blur-2xl"
        >
          <AlertDialogHeader className="px-6 pt-6 pb-0 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/12 border border-primary/20">
              <Timer className="h-5 w-5 text-primary" />
            </div>
            <AlertDialogTitle className="text-[17px] font-semibold">
              Stop the timer?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-secondary-fg/80 mt-1">
              Your tracked time will be saved. Are you sure you want to stop?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col gap-2 px-6 py-5 sm:flex-col sm:space-x-0">
            <AlertDialogAction
              onClick={() => { setConfirmStopTrack(false); onStopTrack?.(block); }}
              className="h-11 w-full rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold text-[15px] border-0 pressable"
            >
              Stop timer
            </AlertDialogAction>
            <AlertDialogCancel className="h-11 w-full rounded-2xl border-border/65 bg-foreground/[0.05] text-foreground font-semibold text-[15px] hover:bg-foreground/[0.09] mt-0 pressable">
              Continue
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Expandable panel ── */}
      <AnimatePresence initial={false}>
        {expanded && canExpand && (
          <motion.div
            key="expand"
            className="relative z-10"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "tween", duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="mt-3 pt-3 border-t border-border/[0.15] space-y-2">

              {/* The AI's one-line placement reasoning used to show here as a grey
                  strip; it now feeds the per-task Coach popup instead (the Coach
                  tile below), so the expanded panel stays clean. */}

              {/* ── Rename: full-width strip at rest; inline input when active.
                   Both states share a propagation-stopping wrapper so neither
                   triggers the card's collapse handler. ── */}
              <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                <AnimatePresence initial={false}>
                  {renaming ? (
                    <motion.div
                      key="rename-field"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.13 }}
                    >
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const t = renameDraft.trim();
                              if (t && t !== block.title) onRename?.(block, t);
                              setRenaming(false);
                              setExpanded(false);
                            }
                            if (e.key === "Escape") {
                              setRenaming(false);
                            }
                          }}
                          onBlur={() => {
                            const t = renameDraft.trim();
                            if (t && t !== block.title) onRename?.(block, t);
                            setRenaming(false);
                          }}
                          className="flex-1 min-w-0 h-9 rounded-xl border border-primary/40 bg-card/60 px-3 text-[13.5px] font-medium outline-none focus:border-primary/70 transition-colors"
                          style={{ fontSize: 16 }}
                          aria-label="Task name"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const t = renameDraft.trim();
                            if (t && t !== block.title) onRename?.(block, t);
                            setRenaming(false);
                            setExpanded(false);
                          }}
                          className="h-9 w-9 rounded-xl bg-primary/90 flex items-center justify-center text-primary-foreground pressable shrink-0"
                          aria-label="Save rename"
                        >
                          <Check className="h-4 w-4" strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenaming(false)}
                          className="h-9 w-9 rounded-xl border border-border/70 bg-card/40 flex items-center justify-center text-secondary-fg pressable shrink-0"
                          aria-label="Cancel rename"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.button
                      key="rename-strip"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.13 }}
                      type="button"
                      onClick={() => { setRenameDraft(block.title); setRenaming(true); }}
                      aria-label="Rename task"
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-black/[0.08] bg-black/[0.05] dark:border-white/[0.09] dark:bg-white/[0.04] hover:bg-black/[0.08] dark:hover:bg-white/[0.08] hover:border-black/[0.14] dark:hover:border-white/[0.14] shadow-sm pressable transition-[border-color,background-color] duration-200"
                    >
                      <Pencil className="h-3.5 w-3.5 shrink-0 text-secondary-fg/55" />
                      <span className="flex-1 min-w-0 text-left text-[12.5px] font-medium text-foreground/70 truncate">{block.title}</span>
                      <span className="text-[9.5px] font-semibold text-secondary-fg/40 shrink-0 uppercase tracking-[0.12em]">Rename</span>
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Compact action grid ──
                   Every action is a uniform icon+label tile (4 per row) so the
                   panel stays short no matter how many functions a task exposes.
                   Identity actions (Rename / Track / Flag / Move) share the row
                   with the operational ones (Duration / Remind / Skip / AI /
                   Template / Delete). Built only while expanded. */}
              {(() => {
                type Tile = {
                  id: string;
                  icon: React.ReactNode;
                  label: string;
                  onClick: () => void;
                  iconColor?: string;
                  active?: boolean;
                  destructive?: boolean;
                  ariaLabel?: string;
                };
                const tiles: Tile[] = [];

                // Track / category — opens the category picker.
                if (!isFinished && onStartTrack && !isCal && block.kind === "task") {
                  tiles.push({
                    id: "track",
                    icon: assignedCategory ? (
                      <span className="h-3.5 w-3.5 rounded-full ring-1 ring-white/25" style={{ background: assignedCategory.color }} aria-hidden />
                    ) : (
                      <Play className="h-3.5 w-3.5" fill="currentColor" />
                    ),
                    label: assignedCategory ? "Category" : "Track",
                    iconColor: "text-primary/85",
                    ariaLabel: assignedCategory ? `Change tracking category (${assignedCategory.name})` : "Set tracking category",
                    onClick: () => { haptics.tap(); onStartTrack?.(block); },
                  });
                }

                // Priority flag — only on active tasks; resolved tasks show Rename only.
                if (!isFinished && !readOnly && onTogglePriority && !isCal && block.kind === "task") {
                  tiles.push({
                    id: "priority",
                    icon: <Flag className="h-3.5 w-3.5" fill={isPriority ? "currentColor" : "none"} />,
                    label: isPriority ? "Priority" : "Flag",
                    iconColor: isPriority ? "text-amber-500 dark:text-amber-400" : "text-secondary-fg/65",
                    active: isPriority,
                    ariaLabel: isPriority ? "Remove priority" : "Mark as priority",
                    onClick: () => { haptics.tap(); setExpanded(false); onTogglePriority?.(block); },
                  });
                }

                // Move to another day (resolved missed/skipped, or future open).
                if (!readOnly && onCarryForward && !isCal && block.kind === "task" &&
                  ((isFinished && (block.resolution === "missed" || block.resolution === "skipped")) ||
                    (isFuturePlan && !isFinished))) {
                  tiles.push({
                    id: "move",
                    icon: <Calendar className="h-3.5 w-3.5" />,
                    label: "Move",
                    iconColor: "text-primary/85",
                    ariaLabel: "Move to another day",
                    onClick: () => { haptics.impact("light"); setExpanded(false); onCarryForward?.(block); },
                  });
                }

                // Operational actions — active (non-resolved) tasks only.
                if (!isFinished) {
                  for (const a of inlineActions) {
                    const destructive = "destructive" in a ? Boolean((a as { destructive?: boolean }).destructive) : false;
                    tiles.push({
                      id: a.id,
                      icon: a.icon,
                      label: a.label,
                      iconColor: a.color,
                      destructive,
                      ariaLabel: a.label,
                      onClick: () => {
                        haptics.tap();
                        if (destructive) { setConfirmDelete(true); return; }
                        if (a.id === "skip") setExpanded(false);
                        a.cb?.(block);
                      },
                    });
                  }
                }

                const toneClass = (t: Tile) =>
                  t.destructive
                    ? "border-destructive/15 bg-destructive/[0.06] hover:bg-destructive/[0.11] hover:border-destructive/25"
                    : t.active
                      ? "border-amber-400/45 bg-amber-400/[0.1] hover:bg-amber-400/[0.16]"
                      : "border-black/[0.08] bg-black/[0.05] dark:border-white/[0.09] dark:bg-white/[0.04] hover:bg-black/[0.08] hover:border-black/[0.14] dark:hover:bg-white/[0.08] dark:hover:border-white/[0.14]";

                return (
                  <div
                    className="grid grid-cols-4 gap-1.5"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {tiles.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={t.onClick}
                        aria-label={t.ariaLabel || t.label}
                        aria-pressed={t.active}
                        className={[
                          `block-action-${t.id}-btn`,
                          "flex flex-col items-center justify-center gap-1 rounded-xl py-2.5 px-1 border shadow-sm pressable transition-[border-color,background-color] duration-200",
                          toneClass(t),
                        ].join(" ")}
                      >
                        <span className={`flex h-[15px] items-center justify-center ${t.iconColor ?? ""}`}>{t.icon}</span>
                        <span className="text-[9px] font-medium text-secondary-fg/60 leading-none tracking-wide">{t.label}</span>
                      </button>
                    ))}
                  </div>
                );
              })()}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

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

/** Frozen status indicator for read-only (past) rows. Shows the status the task
 *  ended in — done / skipped / missed — or a locked outline for an unresolved
 *  past task. Purely visual: past days don't accept taps. */
function ReadOnlyStatusCircle({ variant }: { variant: "done" | "skipped" | "missed" | "open" }) {
  if (variant === "done") {
    return (
      <div
        className="relative h-8 w-8 rounded-full bg-success flex items-center justify-center shrink-0 ring-1 ring-white/20 opacity-90"
        aria-label="Completed"
      >
        <Check className="h-4 w-4 text-success-foreground" strokeWidth={3} />
      </div>
    );
  }
  if (variant === "open") {
    // No resolution was ever recorded — show the same dashed outline used for
    // not-yet-actionable rows, but greyed to read as "frozen".
    return <CompleteCircleLocked />;
  }
  const toneClass =
    variant === "skipped"
      ? "border-amber-500/40 bg-amber-500/10"
      : "border-destructive/35 bg-destructive/10";
  return (
    <div
      className={`h-7 w-7 rounded-full border shrink-0 ${toneClass}`}
      aria-label={variant === "skipped" ? "Skipped" : "Missed"}
    />
  );
}

/** Skipped / missed status circle — colored but still tappable, so the user can
 *  reopen and mark the task done after the fact. */
function StatusCompleteCircle({
  tone,
  label,
  onToggle,
}: {
  tone: "amber" | "red";
  label: string;
  onToggle: () => void;
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20"
      : "border-destructive/35 bg-destructive/10 hover:bg-destructive/20";
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        haptics.tap();
        onToggle();
      }}
      className={`relative group flex items-center justify-center h-7 w-7 rounded-full border shrink-0 pressable transition-colors ${toneClass}`}
      aria-label={label}
      title={label}
    >
      <RotateCcw className={`h-3.5 w-3.5 opacity-60 transition-transform duration-300 group-active:-rotate-45 ${tone === "amber" ? "text-amber-600" : "text-destructive"}`} strokeWidth={2.5} />
    </button>
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
      className="relative h-8 w-8 rounded-full border-[1.5px] border-border/90 shrink-0 pressable hover:border-primary/60 hover:bg-primary/10 shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)] transition-[border-color,background-color,box-shadow,transform]"
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
      className="relative flex items-center justify-center h-8 w-8 rounded-full bg-success shrink-0 pressable shadow-[0_4px_14px_-2px_hsl(var(--success)/0.55)] ring-1 ring-white/20 transition-transform active:scale-95"
      aria-label="Mark as not done"
    >
      <Check className="h-4 w-4 text-success-foreground row-check-pop" strokeWidth={3} />
    </button>
  );
}
