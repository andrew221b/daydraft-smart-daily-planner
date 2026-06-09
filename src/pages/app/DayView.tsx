import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { trackAiEvent } from "@/lib/aiRuntime";
import { Capacitor } from "@capacitor/core";
import { syncBlockNotifications, getNotificationsEnabled, setNotificationsEnabled } from "@/lib/localNotifications";
import { enqueueWrite } from "@/lib/idbCache";
import { invokeAiCached } from "@/lib/aiCache";
import { useAbortOnUnmount } from "@/hooks/useAbortOnUnmount";
import {
  Block, type BlockType, type BlockKind, fmtTime, todayDateStr, parseDateStr, friendlyDateFor, isFutureDateStr, isUserTask, isOpenUserTask, isUserTaskDone, inferScheduleBlockType, packLinearSchedule,
  blockSlotEndHHMM, timeToMinutes, minutesToHHMM, planBlockInstants, wallMsOnPlanDay, shiftDate, normalizeSchedule,
} from "@/lib/daydraft";
import { ChevronLeft, ChevronRight, Play, CalendarDays, Trash2, Bell, BellOff, MoreHorizontal, Clock, Timer, Copy, Sparkles, ListPlus, Wand2, ArrowRightCircle, AlertCircle, Loader2, X, ListChecks, CheckSquare } from "lucide-react";
import { DayPickerSheet } from "@/components/app/DayPickerSheet";
import { UncompleteTaskSheet } from "@/components/app/UncompleteTaskSheet";
import { ChecklistView, type ChecklistApi } from "@/components/app/ChecklistView";
import { peekChecklistCounts } from "@/hooks/useChecklist";
import { Button } from "@/components/ui/button";
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay } from "@dnd-kit/core";
import { motion, AnimatePresence } from "framer-motion";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableBlock } from "@/components/app/SortableBlock";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useProfile } from "@/hooks/useProfile";
import { getTone, t as toneCopy } from "@/lib/tone";
import { toast } from "sonner";
import { useTour } from "@/components/app/Tour";
import { haptics } from "@/lib/haptics";
import { SkeletonBlock } from "@/components/app/SkeletonBlock";
import { scheduleBlockReminders, ensureNotificationPermission, clearScheduledReminders, getReminderConfig, setReminderConfig, ReminderConfig } from "@/lib/blockReminders";
import { DurationPicker } from "@/components/app/DurationPicker";
import { firstTaskCompleteMessage } from "@/lib/microDelights";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { formatPlanAsPlainText, copyTextToClipboard } from "@/lib/planTextExport";
import { fetchDayPlan, planDashboardQueryKey, planDayQueryKey } from "@/lib/planQueries";
import { applyAutoMissedBlocks } from "@/lib/blockResolution";
import { resolveActualMinutesOnComplete } from "@/lib/blockActualTime";
import { rollingEntriesQueryKey, type RollingEntry } from "@/lib/timeEntriesQuery";
import {
  getAssignedCategoryId,
  setAssignedCategoryId,
  clearAssignedCategoryId,
  pruneAssignedCategories,
} from "@/lib/blockCategory";

import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { LateCompleteSheet } from "@/components/app/LateCompleteSheet";
import { setDndBodyScrollLock } from "@/lib/dndScrollLock";
import { AskAiSheet } from "@/components/app/AskAiSheet";
import { Textarea } from "@/components/ui/textarea";
import { DebouncedInput } from "@/components/ui/input";
import { parseBulkTasks, extractDurationFromTitle, extractStartTimeFromTitle } from "@/lib/taskSplitter";
import { useTimeTracker } from "@/hooks/useTimeTracker";
import { useTabVisible } from "@/components/app/PersistentTabs";

/** Builds a factual, concise snapshot of a specific task + its day context for the AI. */
function buildTaskSeedContext(block: ExBlock, allBlocks: ExBlock[], activeTrackerMin?: number): string {
  const tasks = allBlocks.filter((b) => b.kind === "task" && !b.is_calendar_event);
  const doneCount = tasks.filter((b) => b.completed).length;
  const typeLabel = block.type === "deep_work" ? "deep work" : block.type === "communication" ? "communication" : "routine";
  const blockMins = timeToMinutes(block.start_time);
  const before = tasks
    .filter((b) => timeToMinutes(b.start_time) < blockMins && b.completed)
    .slice(-2).map((b) => `"${b.title}"`).join(", ");
  const after = tasks
    .filter((b) => timeToMinutes(b.start_time) > blockMins)
    .slice(0, 2).map((b) => `"${b.title}" at ${b.start_time}`).join(", ");
  return [
    `Task: "${block.title}" · ${typeLabel} · ${block.duration_min} min · starts ${block.start_time}`,
    activeTrackerMin !== undefined ? `Task Progress: Currently working on this right now. ${activeTrackerMin} minutes elapsed out of ${block.duration_min}m.` : null,
    `Day: ${doneCount}/${tasks.length} tasks done`,
    before && `Done before this: ${before}`,
    after && `Coming up: ${after}`,
  ].filter(Boolean).join("\n");
}

/** Builds a factual day-level snapshot for the day-level "Ask AI" button. */
function buildDaySeedContext(allBlocks: ExBlock[]): string {
  const tasks = allBlocks.filter((b) => b.kind === "task" && !b.is_calendar_event);
  if (!tasks.length) return "__empty_day__";
  const doneCount = tasks.filter((b) => b.completed).length;
  const list = tasks.map((b) => `• ${b.start_time} "${b.title}" (${b.duration_min}m)${b.completed ? " ✓" : ""}`).join("\n");
  return `Today's schedule:\n${list}\n${doneCount}/${tasks.length} done`;
}

type ExBlock = Block & {
  ai_reasoning?: string | null;
  block_type?: "work" | "rest" | "personal";
  location?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  is_calendar_event?: boolean;
  completed_at?: string | null;
  overlap_ok?: boolean | null;
  parallel_group_id?: string | null;
  slot_end_time?: string | null;
  resolution?: string | null;
  resolved_at?: string | null;
  moved_to_date?: string | null;
  // Set when the block was created as a "move copy" from another block.
  // Presence means "this is a carry copy — delete it on next move instead of
  // leaving a moved stub".
  source_block_id?: string | null;
};

type BulkTemplate = { id: string; name: string; raw_input: string };

/** One block in an AI planning response (loose: it's external JSON). */
type AiPlanBlock = {
  title?: string;
  kind?: string;
  type?: string;
  duration_min?: number;
  start_time?: string;
  reasoning?: string;
  ai_reasoning?: string;
  overlap_ok?: boolean;
  parallel_group_id?: string | null;
  estimated_minutes?: number;
  actual_minutes?: number | null;
  location?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  slot_end_time?: string | null;
};

/** Shape returned by the generate-plan / reschedule AI edge functions. */
type AiPlanResponse = {
  blocks?: AiPlanBlock[];
  questions?: Array<{ id: string; text: string; options: string[] }>;
  error?: string;
  code?: string;
};

/** A composer/brain-dump row before it becomes a Block. The AI-enrichment fields
 *  (kind/type/reasoning/overlap) are optional — only the planner path fills them. */
type BulkRow = {
  title: string;
  duration: number | null;
  start_time?: string;
  type?: string;
  kind?: string;
  ai_reasoning?: string;
  overlap_ok?: boolean;
  parallel_group_id?: string | null;
};

const EMPTY_BLOCKS: ExBlock[] = [];

// Active tasks (still open) — plus fixed calendar events — stay at the TOP of the
// list, sorted chronologically. Resolved tasks (done, skipped, missed) drop to the
// BOTTOM, also chronological. This way the live part of the day is always on top and
// the settled tasks pile up beneath it, regardless of when their times were edited.
// Calendar events are anchors, not "resolved", so they stay in the active tier.
// Returns tasks only: gaps are a derived render-time concept, never stored as "break".
function activeFirstOrder(packed: ExBlock[]): ExBlock[] {
  const isResolvedB = (b: ExBlock) =>
    b.kind === "task" && !b.is_calendar_event && !isOpenUserTask(b as Block);
  const nonBreak = packed.filter(b => b.kind !== "break");
  const byTime = (a: ExBlock, b: ExBlock) =>
    timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
  return [
    ...nonBreak.filter(b => !isResolvedB(b)).sort(byTime),
    ...nonBreak.filter(isResolvedB).sort(byTime),
  ];
}

/**
 * Isolated, memoised "brain-dump" composer step. The draft text lives in LOCAL
 * state here — typing never re-renders the ~1900-line DayView tree (which used
 * to recreate every SortableBlock callback on each keystroke → visible keyboard
 * lag). Mirrors the proven ChatInput pattern in AskAiSheet. Commits the text up
 * to the parent only on "Continue". Seeds from `initialValue` so the review
 * step's "Back" button restores what was typed.
 */
const BulkInputStep = memo(function BulkInputStep({
  initialValue,
  templates,
  onDeleteTemplate,
  onContinue,
  disabled,
  loading,
}: {
  initialValue: string;
  templates: BulkTemplate[];
  onDeleteTemplate: (id: string) => void;
  onContinue: (text: string) => void;
  disabled: boolean;
  loading?: boolean;
}) {
  const [val, setVal] = useState(initialValue);
  return (
    <div className="space-y-3 pb-4">
      <p className="text-[12px] leading-relaxed text-secondary-fg">
        Type or paste your tasks — one per line, bullets, commas, anything. We'll split them into blocks.
      </p>
      {templates.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/55 mb-2">Templates</p>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1 px-1 scrollbar-none">
            {templates.map((t) => (
              <div key={t.id} className="shrink-0 flex items-center gap-0.5 rounded-full border border-border/40 bg-card/50 pl-3 pr-1 py-1">
                <button
                  type="button"
                  onClick={() => setVal((v) => v ? `${v}\n${t.raw_input}` : t.raw_input)}
                  className="text-[12px] font-medium text-foreground/85 max-w-[11rem] truncate pressable"
                >
                  {t.name}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteTemplate(t.id)}
                  className="h-5 w-5 flex items-center justify-center rounded-full text-secondary-fg/45 hover:text-destructive hover:bg-destructive/10 pressable transition-colors ml-0.5"
                  aria-label="Remove template"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* fontSize:16 prevents iOS from auto-zooming the viewport when focusing */}
      <Textarea
        autoFocus={false}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={"Fix mobile layout, download PDF, send to client\nCall Alex, invoice client"}
        className="min-h-[150px] rounded-2xl border-soft bg-card text-[14px]"
        style={{ fontSize: 16 }}
      />
      <Button
        onClick={() => onContinue(val)}
        disabled={disabled || loading}
        className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/92 text-white font-semibold pressable"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading your tasks…
          </span>
        ) : "Continue"}
      </Button>
    </div>
  );
});

export default function DayView() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const nav = useNavigate();
  const tour = useTour();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const rawDate = searchParams.get("date");
  // Anchor the no-URL "today" once per session and only refresh it when the tab
  // regains visibility — otherwise the 60s `now` tick would recompute today at
  // midnight and yank a night-owl off their in-progress plan onto an empty day.
  const [anchorDate, setAnchorDate] = useState(() => todayDateStr());
  const viewDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : anchorDate;
  const isFuture = isFutureDateStr(viewDate);
  const [blocks, setBlocks] = useState<ExBlock[]>([]);
  // The viewDate that the current `blocks` state was actually loaded for. While
  // switching days, `viewDate` updates a render before the data effect refills
  // `blocks`, so for one paint `blocks` still holds the PREVIOUS day's rows.
  // Reading them then makes yesterday flash "Today" + the red unfinished banner.
  // Gate day-derived UI on `loadedBlocksDate === viewDate` so stale rows never show.
  const [loadedBlocksDate, setLoadedBlocksDate] = useState<string | null>(null);
  const checklistRef = useRef<ChecklistApi>(null);
  const [now, setNow] = useState(new Date());
  const [tourFired, setTourFired] = useState(false);
  // A plan dated yesterday whose last slot still ends in the future is an
  // in-progress overnight session — treat it as "today" so the composer,
  // completion, and auto-missed keep working past midnight. Once its last block
  // end passes, it naturally reverts to a read-only past plan.
  const isActiveNightPlan = useMemo(() => {
    // Only trust `blocks` once they belong to the day we're actually viewing —
    // otherwise a day-switch transition reads yesterday with today's still-future
    // rows and briefly reports "Today".
    if (loadedBlocksDate !== viewDate) return false;
    if (blocks.length === 0 || viewDate !== shiftDate(todayDateStr(), -1)) return false;
    let lastEnd = 0;
    for (const v of planBlockInstants(viewDate, blocks).values()) lastEnd = Math.max(lastEnd, v.endMs);
    return lastEnd > now.getTime();
  }, [viewDate, blocks, now, loadedBlocksDate]);
  const isToday = viewDate === todayDateStr() || isActiveNightPlan;
  // A past day is a frozen, read-only snapshot: no completing/unchecking,
  // deleting, tracking, editing times/durations or reordering — every block
  // stays in whatever status it ended in. The only allowed mutation is moving
  // still-unfinished (missed/skipped) tasks forward to another day.
  const isPast = !isToday && !isFuture;
  // True once `blocks` state matches the day on screen (see loadedBlocksDate).
  const blocksMatchView = loadedBlocksDate === viewDate;
  // If we're transitioning between days and the new data hasn't synced into state yet,
  // we must NOT render the old day's blocks. This prevents visual tearing/jumping.
  const displayBlocks = blocksMatchView ? blocks : EMPTY_BLOCKS;
  // Plan view mode — Timeline (the timed plan) vs Checklist (untimed, parallel,
  // fully isolated). Always defaults to Timeline on mount so the app never
  // opens into the checklist and leaves the user wondering where their plan is.
  const [planViewMode, setPlanViewMode] = useState<"timeline" | "checklist">("timeline");
  // Entrance stagger should play ONCE (first time the plan paints with blocks),
  // not on every date switch. Re-keyed rows on a day change would otherwise
  // replay the fade-up — read as a "jerk" where the previous day's rows visibly
  // re-animate. After the first paint we drop the class so day switches are
  // instant/smooth. Reset only when the tab is left and re-entered cold.
  const [introPlayed, setIntroPlayed] = useState(false);
  // Bumped by ChecklistView after any change so dependent reads re-fire.
  // Stable identity (useCallback) is essential — an inline arrow would change
  // every render and, sitting in ChecklistView's effect deps, spin a loop.
  const [checklistTick, setChecklistTick] = useState(0);
  const handleChecklistChange = useCallback(() => setChecklistTick((t) => t + 1), []);
  // Read directly on every render — peekChecklistCounts is a cheap synchronous
  // localStorage read; useMemo was stale-caching it and missing updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checklistCounts = peekChecklistCounts(user?.id, viewDate);
  // Force re-read when checklistTick or planViewMode change (React re-renders,
  // the line above re-executes).
  void checklistTick; void planViewMode;
  const [replanning, setReplanning] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState("");
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [durationWarnKind, setDurationWarnKind] = useState<"some" | "all" | null>(null);
  const [highlightMissingDuration, setHighlightMissingDuration] = useState(false);
  const [highlightMissingStartTime, setHighlightMissingStartTime] = useState(false);
  const pendingBulkActionRef = useRef<(() => void) | null>(null);
  const [bulkStep, setBulkStep] = useState<"input" | "clarify" | "review">("input");
  const [clarificationQuestions, setClarificationQuestions] = useState<{ id: string; text: string; options: string[] }[]>([]);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  // Pre-fetched by parse-tasks (combined call). null = not yet fetched, [] = no questions.
  const [preFetchedQuestions, setPreFetchedQuestions] = useState<{ id: string; text: string; options: string[] }[] | null>(null);
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkDurationEditIndex, setBulkDurationEditIndex] = useState<number | null>(null);
  const [bulkStartTimeEditIndex, setBulkStartTimeEditIndex] = useState<number | null>(null);
  const [bulkStartTimeDraft, setBulkStartTimeDraft] = useState<string>("09:00");
  const [bulkAiLoading, setBulkAiLoading] = useState(false);
  // Shown inside the spinner button so the user knows what step the AI is on.
  const [bulkAiStep, setBulkAiStep] = useState<"clarifying" | "planning" | null>(null);
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reminderBlockId, setReminderBlockId] = useState<string | null>(null);
  const [reminderAdvancedOpen, setReminderAdvancedOpen] = useState(false);
  const [reminderCfg, setReminderCfg] = useState<ReminderConfig>({
    enabled: true,
    leadsMin: [5],
    repeats: 0,
    endLeadsMin: [],
    endAlertLeadMin: 0,
    endAlertRepeat: 0,
    endFollowUp: false,
  });
  const [durationEditId, setDurationEditId] = useState<string | null>(null);
  // Start-time editing uses the native picker directly (no wrapping sheet).
  const startTimeInputRef = useRef<HTMLInputElement>(null);
  const startTimeTargetRef = useRef<string | null>(null);
  // Synchronous re-entrancy guard for commitStartTime — `planMutating` is React
  // state and lags a render, so two fast time-edits could both pass that check.
  const startTimeBusyRef = useRef(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [lateCompleteBlock, setLateCompleteBlock] = useState<ExBlock | null>(null);
  const [notifsEnabled, setNotifsEnabled] = useState<boolean>(() => getNotificationsEnabled());
  const [planMutating, setPlanMutating] = useState(false);
  const [askAiOpen, setAskAiOpen] = useState(false);
  const [askAiContext, setAskAiContext] = useState<string | null>(null);
  const [askAiTaskTitle, setAskAiTaskTitle] = useState<string | null>(null);
  // Cancels in-flight `generate-plan` calls when DayView unmounts so we
  // don't try to mutate state for a page the user already left.
  const getAiAbortSignal = useAbortOnUnmount();
  const blockOpLocksRef = useRef(new Set<string>());

  const { isPro, overQuota, planQuotaLimit, refresh: refreshEntitlement } = useEntitlement();
  const tracker = useTimeTracker();
  // Bumped whenever we touch the per-block category assignment in localStorage
  // so the category pill on the Plan row re-derives. localStorage doesn't fire
  // React renders on its own.
  const [, setAssignedCatTick] = useState(0);
  const [trackPickerBlock, setTrackPickerBlock] = useState<ExBlock | null>(null);
  const [newCatName, setNewCatName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);

  // Day picker — opens with one of three intents (jump / carry / move-task).
  type DayPickerIntent =
    | { kind: "navigate" }
    | { kind: "carry-missed" }
    | { kind: "checklist-carry-ungrouped" }
    | { kind: "move-task"; blockId: string };
  const [dayPickerIntent, setDayPickerIntent] = useState<DayPickerIntent | null>(null);

  // After the user picks a target date for move/carry, we don't execute
  // immediately — we open the composer in "review" mode so they can adjust
  // times and durations. pendingMoveState bridges the day-picker → composer.
  const [pendingMoveState, setPendingMoveState] = useState<{
    sourceBlocks: ExBlock[];
    targetDate: string;
  } | null>(null);

  // The date the composer was opened on — frozen at open so async task creation
  // always lands on the day the user was actually looking at, even if `viewDate`
  // drifts mid-session (midnight rollover, route/anchor refresh, resume). Without
  // this, a plan built for "tomorrow" could silently be written to "today" and
  // every free-floating task would anchor to the current (late-night) hour and be
  // auto-missed by morning. See addBulkRows / autoScheduleBulkRows.
  const composerTargetDateRef = useRef<string>(viewDate);
  const prevComposerOpenRef = useRef(false);
  useEffect(() => {
    if (composerOpen && !prevComposerOpenRef.current) {
      composerTargetDateRef.current = viewDate; // snapshot only on closed→open
    }
    prevComposerOpenRef.current = composerOpen;
  }, [composerOpen, viewDate]);

  useEffect(() => {
    if (searchParams.get("composer") === "1") setComposerOpen(true);
    const mode = searchParams.get("mode");
    if (mode === "checklist") setPlanViewMode("checklist");
    else if (mode === "timeline") setPlanViewMode("timeline");
  }, [searchParams]);

  const tomorrowDate = shiftDate(viewDate, 1);
  const yesterdayDate = shiftDate(viewDate, -1);
  const navigateToDay = (ymd: string) => {
    if (ymd === todayDateStr()) nav("/today");
    else nav(`/today?date=${ymd}`);
  };

  const dayTabVisible = useTabVisible();

  const { data: dayData, isLoading: loading, refetch, isPlaceholderData } = useQuery({
    queryKey: planDayQueryKey(user?.id ?? "", viewDate),
    queryFn: () => fetchDayPlan(user!.id, viewDate),
    enabled: !!user?.id && dayTabVisible,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const plan = dayData?.plan ?? null;
  const planMissing = !loading && !plan;

  useEffect(() => {
    // While switching days, keepPreviousData hands back the PREVIOUS day's rows
    // (isPlaceholderData=true). Don't commit those — only paint data that's
    // actually for the current viewDate, so a late old-query can't clobber.
    if (isPlaceholderData) return;
    const raw = (dayData?.blocks || []) as ExBlock[];
    // Gaps are derived now — never carry "break" rows into the working set. The
    // rest of the component then never has to think about them.
    const taskRows = raw.filter((b) => b.kind !== "break");
    setBlocks(taskRows);
    setLoadedBlocksDate(viewDate);

    // One-time cleanup: AI plans (and legacy data) may still contain invisible
    // "break" rows. Drop them so they don't linger — scoped to this plan's
    // break rows only, fire-and-forget, never on a frozen past day.
    const hadBreaks = raw.some((b) => b.kind === "break");
    if (hadBreaks && plan?.id && !isPast && navigator.onLine) {
      void supabase.from("blocks").delete().eq("plan_id", plan.id).eq("kind", "break");
    }

    // Only schedule local notifications for today's plan
    if (viewDate === todayDateStr()) {
      syncBlockNotifications(viewDate, taskRows);
    }
    // `plan?.id`/`isPast` are derived from the deps already listed; the cleanup
    // is fire-and-forget + idempotent, so re-running only on these is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate, isPlaceholderData, dayData?.plan?.id, dayData?.blocks]);

  // Play the entrance stagger only on the FIRST paint that has rows, then turn
  // it off so day switches don't replay it (the source of the date-change jerk).
  useEffect(() => {
    if (introPlayed || blocks.length === 0) return;
    const t = setTimeout(() => setIntroPlayed(true), 520); // after the stagger finishes
    return () => clearTimeout(t);
  }, [introPlayed, blocks.length]);

  const openReminders = (id: string) => {
    setReminderCfg(getReminderConfig(id));
    setReminderBlockId(id);
  };

  /**
   * "Track" on a Plan row now *earmarks* the category for the block — no
   * timer starts. The tracker only begins ticking once the user opens
   * Focus on that block, matching the user's mental model (assign here,
   * track when actually working).
   */
  const assignCategoryToBlock = (categoryId: string, block: ExBlock) => {
    setAssignedCategoryId(block.id, categoryId);
    // Bump local re-render of category pills.
    setAssignedCatTick((n) => n + 1);
    haptics.selection();
    setTrackPickerBlock(null);
    const cat = tracker.categories.find((c) => c.id === categoryId);
    toast.success(`Category set: ${cat?.name || "Tracked"}`, {
      description: "Timer starts when you open Focus on this task.",
      action: { label: "Open Focus", onClick: () => nav(`/focus/${block.id}`) },
    });
  };

  const uncompleteTaskAction = async (b: Block, action: "revert" | "v2", newStart: string, newDur: number) => {
    try {
      if (action === "revert") {
        const { error } = await supabase.from("blocks").update({
          completed: false,
          resolution: null,
          resolved_at: null,
          start_time: newStart,
          duration_min: newDur,
          // Keep the denormalized end in lock-step with the new start/duration so
          // reminders + auto-missed read the right window.
          slot_end_time: blockSlotEndHHMM({ start_time: newStart, duration_min: newDur } as Block),
        }).eq("id", b.id);
        if (error) throw error;
      } else {
        // Continuation copy. Tag it "(Part 2)" (don't double-tag) and insert the
        // SAME full field set a normal task gets — earlier it was a bare row with
        // no slot_end_time/block_type, so its reminder + end pings never scheduled
        // ("the program doesn't see it").
        const cloneTitle = b.title.trim().endsWith("(Part 2)") ? b.title : `${b.title} (Part 2)`;
        const { error } = await supabase.from("blocks").insert({
          plan_id: b.plan_id,
          user_id: user?.id,
          title: cloneTitle,
          duration_min: newDur,
          start_time: newStart,
          position: b.position + 1,
          type: b.type,
          kind: "task",
          block_type: inferScheduleBlockType(b),
          estimated_minutes: newDur,
          slot_end_time: blockSlotEndHHMM({ start_time: newStart, duration_min: newDur } as Block),
          completed: false,
        });
        if (error) throw error;
      }
      // Refetch the plan, then (re)schedule reminders off the fresh blocks so the
      // restored/cloned task gets its pings (e.g. the default 5-min-before nudge)
      // just like every other task — the load effect can miss a brand-new row.
      const { data: fresh } = await refetch();
      await queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user?.id ?? "", viewDate) });
      if (isToday && fresh?.blocks) void syncBlockNotifications(viewDate, fresh.blocks as Block[]);
    } catch (e) {
      toast.error(e?.message || "Failed to update task");
    }
  };

  const stopTrackingForBlock = async (block: ExBlock) => {
    if (!tracker.active || tracker.active.block_id !== block.id) return;
    await tracker.stop();
    haptics.notify("success");
  };

  const handleAddCategoryAndAssign = async () => {
    const name = newCatName.trim();
    if (!name || !trackPickerBlock || addingCategory) return;
    setAddingCategory(true);
    try {
      const cat = await tracker.addCategory(name);
      if (cat) {
        setNewCatName("");
        assignCategoryToBlock(cat.id, trackPickerBlock);
      }
    } finally {
      setAddingCategory(false);
    }
  };
  const saveReminders = (cfg: ReminderConfig) => {
    if (!reminderBlockId) return;
    setReminderConfig(reminderBlockId, cfg);
    setReminderCfg(cfg);
    if (isToday) {
      if (Capacitor.isNativePlatform()) {
        // Native: re-sync the real scheduled notifications with the new config.
        void syncBlockNotifications(viewDate, blocks);
      } else {
        // Web: foreground-only Notification API fallback.
        ensureNotificationPermission().then((ok) => {
          if (ok) scheduleBlockReminders(blocks, { planDate: viewDate });
        });
      }
    }
  };

  const toggleAllNotifications = (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    setNotifsEnabled(enabled);
    haptics.selection();
    if (Capacitor.isNativePlatform()) {
      // syncBlockNotifications cancels everything when the master switch is off,
      // and reschedules the day's pings when it's back on.
      void syncBlockNotifications(viewDate, blocks);
    }
    toast(enabled ? "Notifications on" : "All notifications muted");
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // tolerance: 12 (was 8) — gives finger micro-jitter during the 250ms
    // long-press window more headroom, so a steady press doesn't get
    // cancelled by sub-pixel drift before it activates.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 12 } })
  );

  // Per-page tutorial — fires only when Plan is the *active* tab (PersistentTabs
  // removed TOUR_DAYVIEW auto-start

  // `now` only drives the "is this block currently running?" highlight on
  // the timeline — there's no point ticking it while DayView's tab isn't
  // visible. PersistentTabs keeps the tree alive, but the interval can
  // sleep until the user comes back.
  useEffect(() => {
    if (!dayTabVisible) return;
    
    const syncTime = () => {
      setNow(new Date()); // re-sync so the highlight is fresh
      setAnchorDate(todayDateStr()); // pick up a real day change on resume
    };
    
    syncTime();
    const t = setInterval(() => setNow(new Date()), 60000);
    
    // Catch when user returns from the background or unlocks their phone.
    // If the date rolled over during sleep, anchorDate updates immediately
    // so the new day renders instantly instead of lingering on stale data.
    const handleVis = () => {
      if (document.visibilityState === "visible") syncTime();
    };
    document.addEventListener("visibilitychange", handleVis);
    
    let nativeListener: Promise<{ remove: () => void }> | null = null;
    if (Capacitor.isNativePlatform()) {
      import("@capacitor/app").then(({ App }) => {
        nativeListener = App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) syncTime();
        });
      });
    }

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", handleVis);
      if (nativeListener) {
        void nativeListener.then((l) => l.remove());
      }
    };
  }, [dayTabVisible]);

  const [showAllDone, setShowAllDone] = useState(false);
  const [uncompleteTarget, setUncompleteTarget] = useState<Block | null>(null);
  const prevIsAllDoneRef = useRef<boolean | null>(null);
  
  useEffect(() => {
    const userTasks = displayBlocks.filter((b) => isUserTask(b) && !b.is_calendar_event);
    const totalTasks = userTasks.length;
    const doneTasksCount = userTasks.filter((b) => isUserTaskDone(b)).length;
    
    // Only "All done" if every timeline task is explicitly completed (green status).
    // Missed or skipped tasks do not trigger the success banner.
    const isAllDone = !planMissing && !isFuture && totalTasks > 0 && doneTasksCount === totalTasks;
    
    // Only trigger the animation if we transition from NOT all done to ALL done.
    if (prevIsAllDoneRef.current === false && isAllDone && dayTabVisible && planViewMode === "timeline") {
      setShowAllDone(true);
      setTimeout(() => {
        setShowAllDone(false);
      }, 3500);
    }
    
    // If it's no longer all done, hide it immediately
    if (!isAllDone && showAllDone) {
      setShowAllDone(false);
    }

    prevIsAllDoneRef.current = isAllDone;
  }, [dayTabVisible, displayBlocks, planMissing, isFuture, showAllDone, planViewMode]);

  // Drop localStorage tracker-category records for blocks that no longer
  // exist (deleted from a different device, plan reset, etc).
  useEffect(() => {
    if (!blocks.length) return;
    pruneAssignedCategories(blocks.map((b) => b.id));
  }, [blocks.length]);

  const copyDayOutline = async () => {
    if (!blocks.length) return;
    const headline = plan?.ai_summary || `Plan · ${friendlyDateFor(parseDateStr(viewDate))}`;
    const text = formatPlanAsPlainText({ headline, blocks: blocks });
    const ok = await copyTextToClipboard(text);
    if (ok) toast.success("Copied outline");
    else toast.error("Could not copy");
  };

  useEffect(() => {
    // Native scheduling is handled by syncBlockNotifications (real OS
    // notifications). This web-Notification path is a foreground-only
    // fallback for the browser build, so skip it entirely on native.
    if (Capacitor.isNativePlatform()) return;
    if (!isToday || blocks.length === 0) return;
    let cancelled = false;
    (async () => {
      const ok = await ensureNotificationPermission();
      if (cancelled || !ok) return;
      scheduleBlockReminders(blocks, { planDate: viewDate });
    })();
    return () => { cancelled = true; clearScheduledReminders(); };
  }, [blocks, isToday, viewDate]);

  const invalidatePlanCaches = async () => {
    if (!user) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: planDayQueryKey(user.id, viewDate) }),
      queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, viewDate) }),
    ]);
  };

  const { data: templates = [] } = useQuery({
    queryKey: ["block-templates", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("block_templates")
        .select("id, name, raw_input")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; raw_input: string }[];
    },
    enabled: !!user?.id && dayTabVisible,
    staleTime: 60_000,
  });

  const saveAsTemplate = async (blk: ExBlock) => {
    if (!user) return;
    try {
      await supabase.from("block_templates").insert({
        user_id: user.id,
        name: blk.title,
        raw_input: blk.title,
      });
      await queryClient.invalidateQueries({ queryKey: ["block-templates", user.id] });
      haptics.notify("success");
      toast.success("Saved as template");
    } catch (e) {
      toast.error(e?.message || "Couldn't save template");
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!user) return;
    try {
      await supabase.from("block_templates").delete().eq("id", id);
      await queryClient.invalidateQueries({ queryKey: ["block-templates", user.id] });
      toast.success("Template removed");
    } catch (e) {
      toast.error(e?.message || "Couldn't remove template");
    }
  };

  useEffect(() => {
    if (!user?.id || !viewDate || blocks.length === 0 || isFuture) return;
    let cancelled = false;
    (async () => {
      const missed = await applyAutoMissedBlocks(supabase, viewDate, blocks as Block[]);
      if (cancelled || !missed.length) return;
      // Flip the status locally RIGHT NOW so the timeline shows "missed" the
      // instant a window passes (or the moment you open the plan) instead of
      // waiting on the refetch round-trip. The invalidate below reconciles.
      const byId = new Map(missed.map((m) => [m.id, m.resolved_at]));
      setBlocks((prev) =>
        activeFirstOrder(
          prev.map((b) =>
            byId.has(b.id)
              ? { ...b, resolution: "missed", resolved_at: byId.get(b.id) ?? b.resolved_at, completed: false }
              : b,
          ),
        ),
      );
      void invalidatePlanCaches();
    })();
    return () => {
      cancelled = true;
    };
    // `now` minute-tick keeps this re-evaluating while the user sits on the plan
    // and a slot passes — otherwise auto-missed only ran on blocks/date change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, viewDate, blocks, isFuture, Math.floor(now.getTime() / 60000)]);

  const removeBlock = async (id: string) => {
    if (isPast) return; // past days are frozen — deletion is locked
    if (blockOpLocksRef.current.has(`remove:${id}`)) return;
    blockOpLocksRef.current.add(`remove:${id}`);
    const snapshot = blocks;
    const removed = snapshot.find(b => b.id === id);
    if (!removed) {
      blockOpLocksRef.current.delete(`remove:${id}`);
      return;
    }
    await stopTrackingForBlock(removed);
    // Just drop the row and re-sort. Every remaining block keeps its exact
    // start_time — the hole simply becomes (invisible) free time. No gap rows.
    const next = activeFirstOrder(blocks.filter(x => x.id !== id));
    setBlocks(next);
    haptics.impact("light");
    try {
      const { error: delErr } = await supabase.from("blocks").delete().eq("id", id);
      if (delErr) {
        if (!navigator.onLine || delErr.message?.toLowerCase().includes("fetch")) {
          await enqueueWrite({ table: "blocks", op: "delete", payload: {}, filter: { id } });
        } else {
          throw delErr;
        }
      }
      clearAssignedCategoryId(id);
      if (plan && next.length === 0) {
        await supabase.from("plans").delete().eq("id", plan.id);
        setBlocks([]);
        void invalidatePlanCaches();
        return;
      }
      await persistOrder(next);
      void invalidatePlanCaches();
      if (isToday) void syncBlockNotifications(viewDate, next);
      toast("Block removed", {
        action: {
          label: "Undo",
          onClick: async () => {
            setBlocks(snapshot);
            await supabase.from("blocks").upsert({
              id: removed.id,
              plan_id: removed.plan_id,
              user_id: removed.user_id,
              start_time: removed.start_time,
              duration_min: removed.duration_min,
              title: removed.title,
              type: removed.type,
              kind: removed.kind,
              estimated_minutes: removed.estimated_minutes ?? removed.duration_min,
              actual_minutes: removed.actual_minutes ?? null,
              block_type: inferScheduleBlockType(removed),
              completed: removed.completed,
              position: removed.position,
              ai_reasoning: removed.ai_reasoning ?? null,
              location: removed.location ?? null,
              location_lat: removed.location_lat ?? null,
              location_lng: removed.location_lng ?? null,
              is_calendar_event: removed.is_calendar_event ?? null,
              overlap_ok: removed.overlap_ok ?? false,
              parallel_group_id: removed.parallel_group_id ?? null,
              slot_end_time: removed.slot_end_time ?? blockSlotEndHHMM(removed),
              resolution: removed.resolution ?? null,
              resolved_at: removed.resolved_at ?? null,
              completed_at: removed.completed_at ?? null,
            });
            await persistOrder(snapshot);
            void invalidatePlanCaches();
          },
        },
      });
    } catch (e) {
      setBlocks(snapshot);
      toast.error(e?.message || "Unable to remove block");
    } finally {
      blockOpLocksRef.current.delete(`remove:${id}`);
    }
  };

  const renameBlock = async (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, title: trimmed } : b));
    await supabase.from("blocks").update({ title: trimmed }).eq("id", id);
  };

  const completeBlock = async (id: string) => {
    if (isFuture) return; // can't complete tasks that haven't happened yet
    if (isPast) return;   // past days are frozen — no completing or unchecking
    if (blockOpLocksRef.current.has(`complete:${id}`)) return;
    blockOpLocksRef.current.add(`complete:${id}`);
    const snapshot = blocks;
    const toggled = snapshot.find(b => b.id === id);
    if (!toggled) {
      blockOpLocksRef.current.delete(`complete:${id}`);
      return;
    }
    const wasDone = isUserTask(toggled as Block)
      ? isUserTaskDone(toggled as Block)
      : !!toggled.completed;

    if (wasDone) {
      setUncompleteTarget(toggled as Block);
      blockOpLocksRef.current.delete(`complete:${id}`);
      return;
    }

    const userTasks = snapshot.filter(isUserTask);
    const doneBefore = userTasks.filter((b) => isUserTaskDone(b)).length;
    const firstUserTaskDoneToday =
      isToday && isUserTask(toggled) && !wasDone && doneBefore === 0;

    const completedAtIso = new Date().toISOString();
    const completedAtMs = Date.now();
    let resolvedActual: number | null = null;
    if (!wasDone) {
      // Stop any active tracker for this block first so its final time_entry
      // is committed before we read rolling entries to compute actual_minutes.
      await stopTrackingForBlock(toggled);
      const rolling = queryClient.getQueryData<RollingEntry[]>(rollingEntriesQueryKey(user?.id)) || [];
      resolvedActual = resolveActualMinutesOnComplete(
        rolling,
        id,
        viewDate,
        toggled.start_time,
        completedAtMs,
      );
    }

    const newBlocks = blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            completed: !wasDone,
            completed_at: !wasDone ? completedAtIso : null,
            actual_minutes: !wasDone ? resolvedActual : null,
            resolution: !wasDone ? ("done" as const) : null,
            resolved_at: !wasDone ? completedAtIso : null,
          }
        : b
    );
    
    setBlocks(newBlocks);
    // Optimistic cache update. The query key MUST match useQuery's:
    // `planDayQueryKey(userId, viewDate)` — previously this was written
    // to the wrong key `["dayData", ...]` which silently no-op'd and let
    // a stale background refetch overwrite the completed state.
    if (dayData && user?.id) {
      queryClient.setQueryData(planDayQueryKey(user.id, viewDate), {
        ...dayData,
        blocks: newBlocks,
      });
    }

    haptics.notify("success");
    try {
      const payload = {
        completed: !wasDone,
        completed_at: !wasDone ? completedAtIso : null,
        actual_minutes: !wasDone ? resolvedActual : null,
        resolution: !wasDone ? "done" : null,
        resolved_at: !wasDone ? completedAtIso : null,
      };
      
      const { error: upErr } = await supabase
        .from("blocks")
        .update(payload)
        .eq("id", id);
        
      if (upErr) {
        if (!navigator.onLine || upErr.message?.toLowerCase().includes("fetch")) {
          await enqueueWrite({ table: "blocks", op: "update", payload, filter: { id } });
          toast("Saved offline", { description: "Will sync when reconnected" });
        } else {
          throw upErr;
        }
      }
      if (!wasDone) {
        try { localStorage.setItem(`dd_last_plan_progress_${viewDate}`, new Date().toISOString()); } catch {/* ignore */}
      }
      // Silently refetch to ensure background sync without disrupting UI
      void queryClient.cancelQueries({ queryKey: planDayQueryKey(user?.id ?? "", viewDate) });
      void queryClient.invalidateQueries({
        queryKey: planDayQueryKey(user?.id ?? "", viewDate),
        refetchType: "none",
      });
      toast.success(wasDone ? "Reopened" : "Done", {
        description: firstUserTaskDoneToday ? firstTaskCompleteMessage(viewDate) : undefined,
        action: {
          label: "Undo",
          onClick: async () => {
            setBlocks(snapshot);
            const prev = snapshot.find((b) => b.id === id);
            await supabase
              .from("blocks")
              .update({
                completed: prev?.completed ?? false,
                completed_at: prev?.completed_at ?? null,
                actual_minutes: prev?.actual_minutes ?? null,
                resolution: (prev as ExBlock)?.resolution ?? null,
                resolved_at: (prev as ExBlock)?.resolved_at ?? null,
              })
              .eq("id", id);
            void invalidatePlanCaches();
          },
        },
      });
    } catch (e) {
      setBlocks(snapshot);
      toast.error(e?.message || "Unable to update task");
    } finally {
      blockOpLocksRef.current.delete(`complete:${id}`);
    }
  };

  /** Mark an open task skipped. Used for frameless (no-duration) tasks that
   *  have no slot end and so never auto-resolve — the user needs a way to
   *  dismiss them without marking them done. Optimistic + undo. */
  const skipBlock = async (id: string) => {
    if (isFuture) return;
    if (isPast) return; // past days are frozen
    if (blockOpLocksRef.current.has(`skip:${id}`)) return;
    blockOpLocksRef.current.add(`skip:${id}`);
    const snapshot = blocks;
    const target = snapshot.find((b) => b.id === id);
    if (!target) { blockOpLocksRef.current.delete(`skip:${id}`); return; }
    // Stop any running tracker first so we don't strand an open time entry.
    await stopTrackingForBlock(target);
    const iso = new Date().toISOString();
    const newBlocks = blocks.map((b) =>
      b.id === id
        ? { ...b, completed: false, completed_at: null, actual_minutes: null, resolution: ("skipped" as const), resolved_at: iso }
        : b,
    );
    setBlocks(newBlocks);
    if (dayData && user?.id) {
      queryClient.setQueryData(planDayQueryKey(user.id, viewDate), { ...dayData, blocks: newBlocks });
    }
    haptics.impact("medium");
    try {
      const payload = { completed: false, completed_at: null, actual_minutes: null, resolution: "skipped", resolved_at: iso };
      const { error: upErr } = await supabase.from("blocks").update(payload).eq("id", id);
      if (upErr) {
        if (!navigator.onLine || upErr.message?.toLowerCase().includes("fetch")) {
          await enqueueWrite({ table: "blocks", op: "update", payload, filter: { id } });
          toast("Saved offline", { description: "Will sync when reconnected" });
        } else {
          throw upErr;
        }
      }
      void queryClient.invalidateQueries({ queryKey: planDayQueryKey(user?.id ?? "", viewDate), refetchType: "none" });
      toast.success("Skipped", {
        action: {
          label: "Undo",
          onClick: async () => {
            setBlocks(snapshot);
            await supabase
              .from("blocks")
              .update({ resolution: null, resolved_at: null, completed: false })
              .eq("id", id);
            void invalidatePlanCaches();
          },
        },
      });
    } catch (e) {
      setBlocks(snapshot);
      toast.error(e?.message || "Unable to skip task");
    } finally {
      blockOpLocksRef.current.delete(`skip:${id}`);
    }
  };


  const ensurePlanId = async () => {
    if (!user) return null;
    if (plan?.id) return plan.id;
    const { data: created, error } = await supabase
      .from("plans")
      .insert({ user_id: user.id, date: viewDate, raw_input: bulkInput || "" })
      .select("id")
      .single();
      
    if (error?.code === "23505" || error?.message?.includes("duplicate")) {
      const { data: existing } = await supabase
        .from("plans")
        .select("id")
        .eq("user_id", user.id)
        .eq("date", viewDate)
        .single();
      if (existing?.id) return existing.id;
    }

    if (error || !created?.id) {
      toast.error(error?.message || "Couldn't create plan");
      return null;
    }
    return created.id as string;
  };

  const prepareBulkRows = async (text?: string) => {
    const source = text ?? bulkInput;
    if (!source.trim()) {
      toast.error("Write at least one task");
      return;
    }
    
    if (text !== undefined && text !== bulkInput) setBulkInput(text);

    setBulkParsing(true);
    setPreFetchedQuestions(null);
    let rows: BulkRow[] = [];

    if (isPro) {
      try {
        const { data, error } = await supabase.functions.invoke("parse-tasks", {
          body: { raw_input: source }
        });
        if (error) throw error;
        if (data?.tasks && Array.isArray(data.tasks) && data.tasks.length > 0) {
          rows = data.tasks.map((t: { title: string; duration_min?: number | null; start_time?: string }) => ({
            title: t.title,
            duration: t.duration_min ?? null,
            ...(t.start_time ? { start_time: t.start_time } : {}),
          }));
        }
        // Store pre-fetched clarification questions from the combined call
        setPreFetchedQuestions(Array.isArray(data?.questions) ? data.questions : []);
      } catch (e) {
        console.warn("AI parse failed, falling back to local split", e);
        setPreFetchedQuestions([]);
      }
    }

    // Fallback to local split if free tier, AI failed or returned empty
    if (rows.length === 0) {
      const titles = parseBulkTasks(source);
      if (!titles.length) {
        setBulkParsing(false);
        toast.error("Write at least one task");
        return;
      }
      rows = titles.map((rawTitle) => {
        const { title: t1, duration } = extractDurationFromTitle(rawTitle);
        const { title, start_time } = extractStartTimeFromTitle(t1 || rawTitle);
        return { title: title || rawTitle, duration: duration ?? null, ...(start_time ? { start_time } : {}) };
      });
    }

    setBulkRows(rows);
    setBulkStep("review");
    setBulkParsing(false);
  };

  // Stable callbacks for the isolated BulkInputStep — ref indirection keeps the
  // identities constant across DayView re-renders (so its `memo` holds) while
  // always invoking the latest closure.
  const prepareBulkRowsRef = useRef(prepareBulkRows);
  prepareBulkRowsRef.current = prepareBulkRows;
  const deleteTemplateRef = useRef(deleteTemplate);
  deleteTemplateRef.current = deleteTemplate;
  const handleComposerContinue = useCallback((text: string) => { void prepareBulkRowsRef.current(text); }, []);
  const handleComposerDeleteTemplate = useCallback((id: string) => { void deleteTemplateRef.current(id); }, []);

  const addBulkRows = async (rows: BulkRow[]) => {
    if (planMutating || !user) return;

    // ── MOVE MODE ────────────────────────────────────────────────────────────
    // When the composer was opened from a carry/move-task flow, pendingMoveState
    // holds the source blocks + target date. We insert the user-edited tasks on
    // the target day and mark (or delete) the source blocks — never touching the
    // current day's schedule directly.
    if (pendingMoveState) {
      const moveState = pendingMoveState;
      setPendingMoveState(null);
      setComposerOpen(false);
      setBulkRows([]);
      setBulkStep("input");
      const clean = rows.filter((r) => r.title.trim());
      if (!clean.length) return;
      setPlanMutating(true);
      try {
        const { targetDate, sourceBlocks } = moveState;
        const targetPlanId = await ensurePlanIdForDate(targetDate);
        if (!targetPlanId) return;
        const { data: existing } = await supabase
          .from("blocks")
          .select("id, position")
          .eq("plan_id", targetPlanId);
        const startPos = existing?.length ?? 0;
        const toInsert = clean.map((r, i) => {
          const st = r.start_time || "09:00";
          const dur = r.duration && r.duration > 0 ? Math.max(1, r.duration) : 30;
          // Propagate origin: a copy of a copy keeps the ultimate source so
          // subsequent moves keep seeing it as a copy and clean up properly.
          const originId = sourceBlocks[i]?.source_block_id ?? sourceBlocks[i]?.id ?? null;
          return {
            plan_id: targetPlanId,
            user_id: user!.id,
            start_time: st,
            duration_min: dur,
            title: r.title.trim(),
            type: (r.type || "deep_work") as BlockType,
            kind: "task" as const,
            block_type: inferScheduleBlockType({ kind: "task" as BlockKind, title: r.title }),
            completed: false,
            position: startPos + i,
            estimated_minutes: dur,
            actual_minutes: null,
            slot_end_time: blockSlotEndHHMM({ start_time: st, duration_min: dur } as Block),
            source_block_id: originId,
          };
        });
        const { error: insertErr } = await supabase.from("blocks").insert(toInsert);
        if (insertErr) {
          if (insertErr.message?.includes("PLAN_QUOTA_REACHED")) {
            void refreshEntitlement();
            toast(`Free trial limit reached — ${planQuotaLimit} planning days used`, {
              description: "Upgrade to keep moving tasks to new days.",
              action: { label: "Upgrade", onClick: () => setUpgradeOpen(true) },
            });
            setUpgradeOpen(true);
            return;
          }
          throw insertErr;
        }
        const movedAt = new Date().toISOString();
        const sourceIds = sourceBlocks.map((b) => b.id);
        // Copies (source_block_id set) get DELETED — they're intermediary clones
        // the user already moved on; leave no "moved to…" stub behind them.
        // Originals (no source_block_id) get marked "moved" so the original day
        // keeps the visual indicator.
        const copyIds = sourceBlocks.filter((b) => b.source_block_id).map((b) => b.id);
        const originalIds = sourceBlocks.filter((b) => !b.source_block_id).map((b) => b.id);
        if (copyIds.length) {
          await supabase.from("blocks").delete().in("id", copyIds);
        }
        if (originalIds.length) {
          await supabase.from("blocks")
            .update({ resolution: "skipped", resolved_at: movedAt, moved_to_date: targetDate })
            .in("id", originalIds);
        }
        // Update current-day local state: remove deleted copies, mark moved originals.
        setBlocks(
          activeFirstOrder(
            blocks
              .filter((b) => !copyIds.includes(b.id))
              .map((b) =>
                originalIds.includes(b.id)
                  ? { ...b, resolution: "skipped", resolved_at: movedAt, moved_to_date: targetDate }
                  : b,
              ) as ExBlock[],
          ),
        );
        void invalidatePlanCaches();
        await refetch();
        haptics.notify("success");
        toast.success(
          `Moved ${clean.length} task${clean.length === 1 ? "" : "s"} to ${friendlyDateFor(parseDateStr(targetDate))}`,
          { action: { label: "Open", onClick: () => navigateToDay(targetDate) } },
        );
      } catch (e) {
        toast.error(e?.message || "Couldn't move tasks");
      } finally {
        setPlanMutating(false);
      }
      return;
    }
    // ── END MOVE MODE ────────────────────────────────────────────────────────

    const clean = rows.filter((t) => t.title.trim());
    if (!clean.length) {
      toast.error("No tasks to add");
      return;
    }
    // Free-tier gate: only block when this would consume a *new* quota day.
    // Adding more tasks to an already-counted day stays free.
    const wouldStartNewDay = !plan || blocks.length === 0;
    if (overQuota && wouldStartNewDay) {
      setComposerOpen(false);
      setBulkStep("input");
      setBulkRows([]);
      toast(`Free trial limit reached — ${planQuotaLimit} planning days used`, {
        description: "Upgrade to start a new plan. Existing days stay editable.",
        action: { label: "Upgrade", onClick: () => setUpgradeOpen(true) },
      });
      setUpgradeOpen(true);
      return;
    }
    setPlanMutating(true);
    const snapshot = blocks;
    try {
      // Bind to the date the composer was opened on, not the live `viewDate`
      // (which can drift across midnight / resume). This guarantees tasks land
      // on the day the user actually chose, and that "today vs future" packing
      // is decided against THAT day — so a future plan never anchors free-floating
      // tasks to the current late-night hour.
      const targetDate = composerTargetDateRef.current;
      const planId = targetDate === viewDate
        ? await ensurePlanId()
        : await ensurePlanIdForDate(targetDate);
      if (!planId) return;
      const startPos = blocks.length;
      // Start packing from current time (today) or 09:00 (future days).
      const todayStr = todayDateStr();
      const startHHMM = targetDate === todayStr
        ? `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`
        : "09:00";
      // wallCursorMin — earliest allowed start for free-floating tasks (≥ current time today).
      // Exclude missed/skipped blocks when finding the "last" anchor so new tasks
      // aren't packed after a stale evening block that was pre-planned and later
      // marked missed (e.g. user plans tomorrow at 21:00, all end up at 21:xx,
      // next morning those are missed → new free-floating tasks would start at 22:00).
      const settledResolutions = new Set(["missed", "skipped"]);
      const packableBlocks = blocks.filter(
        (b) => !settledResolutions.has(b.resolution ?? ""),
      );
      const lastExistingBlock = packableBlocks.length > 0 ? packableBlocks[packableBlocks.length - 1] : null;
      const lastExistingEndMin = lastExistingBlock
        ? timeToMinutes(lastExistingBlock.start_time) + Math.max(1, Number(lastExistingBlock.duration_min || 30))
        : null;
      let wallCursorMin = lastExistingEndMin ?? timeToMinutes(startHHMM);
      // For today's plan, never place new tasks before the current moment.
      // startHHMM is already the current HH:MM for today, so this floor
      // prevents free-floating tasks landing in the past.
      if (targetDate === todayStr) {
        wallCursorMin = Math.max(wallCursorMin, timeToMinutes(startHHMM));
      }
      const draftBlocks: ExBlock[] = [];
      let pos = startPos;

      for (const task of clean) {
        // No 30-min placeholder: a task the user left frameless stays at 0
        // (a point in the day, no timer span). Real durations floor to 1.
        const duration = task.duration && task.duration > 0 ? Math.max(1, task.duration) : 0;
        const finalKind = (task.kind || "task") as BlockKind;

        if (task.start_time) {
          const taskStartMin = timeToMinutes(task.start_time);
          const id = crypto.randomUUID();
          draftBlocks.push({
            id,
            plan_id: planId,
            user_id: user.id,
            start_time: task.start_time,
            duration_min: duration,
            estimated_minutes: duration,
            actual_minutes: null,
            title: task.title.trim(),
            type: (task.type || "deep_work") as BlockType,
            kind: finalKind,
            block_type: inferScheduleBlockType({ kind: finalKind, title: task.title }),
            ai_reasoning: task.ai_reasoning || null,
            overlap_ok: Boolean(task.overlap_ok),
            parallel_group_id: task.parallel_group_id || null,
            completed: false,
            position: pos++,
          });
          // Wall cursor never goes backwards.
          wallCursorMin = Math.max(taskStartMin + duration, wallCursorMin);
        } else {
          // Free-floating: place at wall cursor.
          const startMin = wallCursorMin;
          const id = crypto.randomUUID();
          draftBlocks.push({
            id,
            plan_id: planId,
            user_id: user.id,
            start_time: minutesToHHMM(startMin % 1440),
            duration_min: duration,
            estimated_minutes: duration,
            actual_minutes: null,
            title: task.title.trim(),
            type: (task.type || "deep_work") as BlockType,
            kind: finalKind,
            block_type: inferScheduleBlockType({ kind: finalKind, title: task.title }),
            ai_reasoning: task.ai_reasoning || null,
            overlap_ok: Boolean(task.overlap_ok),
            parallel_group_id: task.parallel_group_id || null,
            completed: false,
            position: pos++,
          });
          wallCursorMin = startMin + duration;
        }
      }

      // The for loop already set correct start_times on every new block.
      // Insert-into-gap: if a new explicit-time task lands *inside* the existing
      // timeline (earlier than some existing block), rebuild the whole day in
      // chronological order so the task sits in its true slot. Only engage for
      // monotonic same-day plans; cross-midnight / out-of-order plans fall back
      // to the simple append to stay safe.
      const newTaskBlocks = draftBlocks;
      const existingNonBreak = blocks;
      // Only compare against active (non-resolved) blocks for the mid-plan check.
      // Comparing against missed/skipped blocks would falsely fire when the user
      // adds morning tasks after a day of pre-planned evening tasks that all got
      // missed — causing a normalizeSchedule pass that inserts a huge gap block
      // (e.g. 09:30 → 21:00 Free time) between the new task and the missed tasks.
      const existingActiveNonBreak = existingNonBreak.filter(
        (b) => !settledResolutions.has(b.resolution ?? ""),
      );
      const insertsMidPlan =
        blocks.length > 0 &&
        newTaskBlocks.some((nt) =>
          existingActiveNonBreak.some((eb) => timeToMinutes(nt.start_time) < timeToMinutes(eb.start_time)),
        );

      // When a new explicit-time task lands inside the existing timeline, retime
      // the whole day around the new tasks (anchors): they keep their times,
      // earlier tasks stay, later tasks cascade forward to clear them. Cross-
      // midnight plans return null → plain append.
      const newTaskIds = new Set(newTaskBlocks.map((b) => b.id));
      const allInsertBlocks = [...blocks, ...newTaskBlocks];
      // Completed/skipped/missed tasks and calendar events are treated as extra
      // anchors so normalizeSchedule never shifts their scheduled times.
      const lockedInsertIds = new Set(
        allInsertBlocks
          .filter(b => !!b.is_calendar_event || (b.kind === "task" && !isOpenUserTask(b as Block)))
          .map(b => b.id),
      );
      const normalized = insertsMidPlan
        ? normalizeSchedule(allInsertBlocks, new Set([...newTaskIds, ...lockedInsertIds]))
        : null;

      const packed: ExBlock[] = normalized
        ? activeFirstOrder(normalized)
        : [...blocks, ...draftBlocks];

      setBlocks(packed);
      setComposerOpen(false);
      setBulkInput("");
      setBulkRows([]);
      setBulkStep("input");
      // The mid-plan (normalized) branch upserts everything via persistOrder below.
      // The append branch keeps a lightweight insert of just the new rows (offline-queueable).
      if (!normalized) {
        const toInsert = packed
          .filter((b) => draftBlocks.some((d) => d.id === b.id))
          .map((b) => ({
            id: b.id,
            plan_id: planId,
            user_id: user.id,
            start_time: b.start_time,
            duration_min: b.duration_min,
            title: b.title,
            type: b.type,
            kind: b.kind,
            estimated_minutes: b.estimated_minutes ?? b.duration_min,
            actual_minutes: null,
            block_type: inferScheduleBlockType(b),
            position: b.position,
            slot_end_time: blockSlotEndHHMM(b),
            ai_reasoning: b.ai_reasoning || null,
            overlap_ok: Boolean(b.overlap_ok),
            parallel_group_id: b.parallel_group_id || null,
          }));
        const { error: insertErr } = await supabase.from("blocks").insert(toInsert);
        if (insertErr) {
          if (!navigator.onLine || insertErr.message?.toLowerCase().includes("fetch")) {
            for (const b of toInsert) {
              await enqueueWrite({ table: "blocks", op: "insert", payload: b });
            }
          } else {
            throw insertErr;
          }
        }
      }
      await persistOrder(packed);
      void invalidatePlanCaches();
      await refetch();
      // First task on a brand-new day burns a trial slot — refresh the counter.
      if (wouldStartNewDay) void refreshEntitlement();
      toast.success(`Added ${clean.length} task${clean.length === 1 ? "" : "s"}`);
    } catch (e) {
      setBlocks(snapshot);
      const msg = e?.message || "";
      if (msg.includes("PLAN_QUOTA_REACHED")) {
        // DB trigger fired — the client gate let it through (legacy data, race,
        // or simulated-Pro mismatch). Surface as the upgrade prompt.
        void refreshEntitlement();
        toast(`Free trial limit reached — ${planQuotaLimit} planning days used`, {
          description: "Upgrade to start a new plan.",
          action: { label: "Upgrade", onClick: () => setUpgradeOpen(true) },
        });
        setUpgradeOpen(true);
      } else {
        toast.error(msg || "Unable to add tasks");
      }
    } finally {
      setPlanMutating(false);
    }
  };

  const persistOrder = async (list: ExBlock[]) => {
    if (!list.length) return;
    const payload = list.map((b, i) => ({
      id: b.id,
      plan_id: b.plan_id,
      user_id: b.user_id,
      start_time: b.start_time,
      duration_min: b.duration_min,
      title: b.title,
      type: b.type,
      kind: b.kind,
      estimated_minutes: b.estimated_minutes ?? b.duration_min,
      actual_minutes: b.actual_minutes ?? null,
      block_type: inferScheduleBlockType(b),
      completed: b.completed,
      position: i,
      ai_reasoning: b.ai_reasoning ?? null,
      location: b.location ?? null,
      location_lat: b.location_lat ?? null,
      location_lng: b.location_lng ?? null,
      is_calendar_event: b.is_calendar_event ?? false,
      overlap_ok: b.overlap_ok ?? false,
      parallel_group_id: b.parallel_group_id ?? null,
      slot_end_time: blockSlotEndHHMM(b),
      resolution: b.resolution ?? null,
      resolved_at: b.resolved_at ?? null,
      completed_at: b.completed_at ?? null,
    }));
    const { error: upErr } = await supabase.from("blocks").upsert(payload);
    if (upErr) {
      if (!navigator.onLine || upErr.message?.toLowerCase().includes("fetch")) {
        await enqueueWrite({ table: "blocks", op: "upsert", payload });
      } else {
        throw upErr;
      }
    }
  };

  // Current local time rounded UP to the next 5 min, as "HH:MM". The floor for
  // start times when the plan is for today — you can't schedule into the past.
  const roundedNowHHMM = () => {
    const d = new Date();
    const mins = Math.min(23 * 60 + 59, d.getHours() * 60 + Math.ceil(d.getMinutes() / 5) * 5);
    return minutesToHHMM(mins);
  };

  const openStartTimePicker = (block: Block) => {
    if (block?.is_calendar_event) return;
    startTimeTargetRef.current = block.id;
    const el = startTimeInputRef.current;
    if (!el) return;
    
    // Set to time type right before opening so iOS WKWebView doesn't pre-calculate bounds
    el.type = "time";
    el.value = block.start_time || "09:00";
    el.min = isToday ? roundedNowHHMM() : "";
    
    try {
      const withPicker = el as HTMLInputElement & { showPicker?: () => void };
      if (typeof withPicker.showPicker === "function") withPicker.showPicker();
      else el.click();
    } catch {
      el.click();
    }
  };


  // Commit a native-picked start time: clamp past→now for today, then apply the
  // same packing / gap-break logic the old sheet used, and persist.
  const commitStartTime = async (rawValue: string) => {
    const id = startTimeTargetRef.current;
    startTimeTargetRef.current = null;
    if (!id) return;
    if (!/^\d{2}:\d{2}$/.test(rawValue)) return;
    if (planMutating || startTimeBusyRef.current) return;

    // For today's plan, clamp chosen time to at least the current moment so
    // the user can't schedule into the past.
    const value = isToday
      ? minutesToHHMM(Math.max(timeToMinutes(rawValue), timeToMinutes(roundedNowHHMM())))
      : rawValue;

    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const snapshot = blocks;
    const targetMin = timeToMinutes(value);

    const makeBreak = (fromMin: number, toMin: number): ExBlock => ({
      id: crypto.randomUUID(),
      plan_id: blocks[0].plan_id,
      user_id: blocks[0].user_id,
      start_time: minutesToHHMM(fromMin % 1440),
      duration_min: toMin - fromMin,
      estimated_minutes: toMin - fromMin,
      actual_minutes: null,
      title: "Break",
      type: "routine",
      kind: "break",
      completed: false,
      position: 0,
    });

    // Editing a time behaves like inserting one: the edited block is the anchor
    // (keeps its exact time, repositions chronologically), earlier tasks stay,
    // later tasks cascade forward. Returns null for cross-midnight plans → fall
    // back to the legacy sequential retiming. activeFirstOrder returns tasks
    // only (no gap rows).
    const updated = blocks.map((b) => (b.id === id ? { ...b, start_time: value } : b));
    // Completed/skipped/missed tasks and calendar events are treated as extra
    // anchors so normalizeSchedule never re-times their scheduled slots.
    const lockedEditIds = new Set(
      updated
        .filter(b => !!b.is_calendar_event || (b.kind === "task" && !isOpenUserTask(b as Block)))
        .map(b => b.id),
    );
    const normalized = normalizeSchedule(updated, new Set([id, ...lockedEditIds]));

    let packed: ExBlock[];
    if (normalized) {
      packed = activeFirstOrder(normalized);
    } else {
      // Legacy fallback (cross-midnight / non-monotonic): sequential retiming.
      // makeBreak only computes intermediate spacing for packLinearSchedule;
      // activeFirstOrder strips those gap rows back out before we persist.
      const legacy = [...blocks];
      if (idx > 0) {
        const previousPacked = packLinearSchedule(legacy.slice(0, idx));
        const last = previousPacked[previousPacked.length - 1];
        const previousEndMin = timeToMinutes(last.start_time) + Number(last.duration_min);

        if (targetMin > previousEndMin) {
          if (legacy[idx - 1].kind === "break") {
            legacy[idx - 1] = {
              ...legacy[idx - 1],
              duration_min: Number(legacy[idx - 1].duration_min) + (targetMin - previousEndMin),
            };
          } else {
            legacy.splice(idx, 0, makeBreak(previousEndMin, targetMin));
          }
        } else if (targetMin < previousEndMin && legacy[idx - 1].kind === "break") {
          const newBreakDuration = Number(legacy[idx - 1].duration_min) - (previousEndMin - targetMin);
          if (newBreakDuration > 0) {
            legacy[idx - 1] = { ...legacy[idx - 1], duration_min: newBreakDuration };
          } else {
            legacy.splice(idx - 1, 1);
          }
        }
      }
      const targetIdx = legacy.findIndex((b) => b.id === id);
      if (targetIdx >= 0) legacy[targetIdx] = { ...legacy[targetIdx], start_time: value };
      packed = activeFirstOrder(packLinearSchedule(legacy));
    }

    setBlocks(packed);
    haptics.notify("success");
    startTimeBusyRef.current = true;
    setPlanMutating(true);
    try {
      await persistOrder(packed);
      void invalidatePlanCaches();
      if (isToday) void syncBlockNotifications(viewDate, packed);
    } catch (e) {
      setBlocks(snapshot);
      toast.error(e?.message || "Couldn't update start time");
    } finally {
      setPlanMutating(false);
      startTimeBusyRef.current = false;
    }
  };

  const handleDragStart = (e: DragStartEvent) => {
    setDndBodyScrollLock(true);
    setActiveDragId(e.active.id as string);
    // iOS-style "lift" feedback the instant the drag activates. The card's
    // CSS scale + shadow run alongside; this pairs the visual cue with a
    // tactile one so the long-press feels responsive instead of silent.
    haptics.impact("medium");
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDndBodyScrollLock(false);
    setActiveDragId(null);
    if (isPast) return; // past days are frozen — no reordering
    const { active, over } = e;
    haptics.impact("light");
    if (!over || active.id === over.id) return;

    // Calendar events and resolved tasks are immovable drop targets.
    const isLocked = (b: ExBlock) =>
      !!b.is_calendar_event || (b.kind === "task" && !isOpenUserTask(b as Block));

    const activeBlock = blocks.find(b => b.id === active.id);
    const overBlock = blocks.find(b => b.id === over.id);
    if (!activeBlock || !overBlock) return;
    if (isLocked(activeBlock) || isLocked(overBlock)) return;

    // Exchange start_times between the two blocks, then RE-FLOW: the dragged
    // block is the anchor (it keeps the slot the user dropped it on) and any task
    // it now overlaps cascades forward — so a drag between tasks of different
    // lengths can't leave overlapping slots ("liquid timeline"). When the plan
    // genuinely wraps past midnight normalizeSchedule returns null and we keep the
    // plain time-swap. No gap rows.
    const withSwapped = blocks.map(b => {
      if (b.id === active.id) return { ...b, start_time: overBlock.start_time };
      if (b.id === over.id)   return { ...b, start_time: activeBlock.start_time };
      return b;
    });
    const lockedDragIds = new Set(withSwapped.filter(isLocked).map(b => b.id));
    const cascaded = normalizeSchedule(withSwapped, new Set([String(active.id), ...lockedDragIds]));
    const reordered = activeFirstOrder(cascaded ?? withSwapped);

    const snapshot = blocks;
    setBlocks(reordered);
    void (async () => {
      try {
        await persistOrder(reordered);
        invalidatePlanCaches();
        if (isToday) void syncBlockNotifications(viewDate, reordered);
      } catch (err) {
        setBlocks(snapshot);
        toast.error(err?.message || "Unable to reorder blocks");
        void invalidatePlanCaches();
      }
    })();
  };

  const replanRest = async () => {
    if (planMutating) return;
    if (!user || !plan) return;
    setMoreOpen(false);
    setReplanning(true);
    setPlanMutating(true);
    const signal = getAiAbortSignal();
    try {
      const remaining = blocks.filter((b) => isUserTask(b) && isOpenUserTask(b));
      const nowHM = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      const tz = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { data, error } = await invokeAiCached<AiPlanResponse>(
        "generate-plan",
        {
          raw_input: remaining.map(b => `${b.title} (${b.duration_min}m)`).join("\n"),
          energy_preference: profile?.energy_preference || "morning",
          name: profile?.display_name,
          mode: "replan",
          start_time: nowHM,
          plan_date: viewDate,
          now_iso: new Date().toISOString(),
          timezone: tz,
          active_hours_start: profile?.active_hours_start || undefined,
          active_hours_end: profile?.active_hours_end || undefined,
          ai_tone: profile?.ai_tone || "professional",
          ai_tone_custom: profile?.ai_tone_custom || null,
          ai_planning_rules: profile?.ai_planning_rules || "",
          ai_context_custom: profile?.ai_context_custom || null,
        },
        { ttlMs: 0, timeoutMs: 75_000, signal },
      );
      if (signal.aborted) return;
      if (error) throw error;
      if (data?.code === "INCOMPLETE_TASKS_NEED_CLARIFICATION") {
        throw new Error(data.error || "Please clarify incomplete tasks before re-planning.");
      }
      if (data?.error) throw new Error(data.error);
      const toRemoveIds = blocks
        .filter((b) => {
          if (b.is_calendar_event) return false;
          if (isUserTask(b) && isOpenUserTask(b)) return true;
          if ((b.kind === "break" || b.kind === "lunch") && !b.completed) return true;
          return false;
        })
        .map((b) => b.id);
      const keep = blocks.filter((b) => !toRemoveIds.includes(b.id));
      if (toRemoveIds.length) {
        await supabase.from("blocks").delete().in("id", toRemoveIds);
      }
      const startPos = keep.length;
      const newBlocks = (data.blocks || []).map((b, i: number) => ({
        plan_id: plan.id, user_id: user.id,
        start_time: b.start_time, duration_min: b.duration_min, title: b.title,
        type: b.type, kind: b.kind, block_type: inferScheduleBlockType(b), position: startPos + i,
        estimated_minutes: b.estimated_minutes ?? b.duration_min,
        actual_minutes: b.actual_minutes ?? null,
        ai_reasoning: b.reasoning ?? null,
        location: b.location ?? null,
        location_lat: b.location_lat ?? null,
        location_lng: b.location_lng ?? null,
        overlap_ok: Boolean(b.overlap_ok),
        parallel_group_id: typeof b.parallel_group_id === "string" && b.parallel_group_id ? b.parallel_group_id : null,
        slot_end_time: typeof b.slot_end_time === "string" && /^\d{2}:\d{2}$/.test(b.slot_end_time)
          ? b.slot_end_time
          : blockSlotEndHHMM({ start_time: b.start_time, duration_min: b.duration_min } as Block),
      }));
      if (newBlocks.length) await supabase.from("blocks").insert(newBlocks);
      const { data: bs } = await supabase.from("blocks").select("*").eq("plan_id", plan.id).order("position");
      setBlocks((bs || []) as ExBlock[]);
      void invalidatePlanCaches();
      if (isToday) void syncBlockNotifications(viewDate, (bs || []) as Block[]);
      toast.success("Re-planned");
    } catch (e) {
      if (signal.aborted) return;
      toast.error(e.message || "Unable to re-plan remaining tasks");
    } finally {
      if (!signal.aborted) {
        setReplanning(false);
        setPlanMutating(false);
      }
    }
  };

  const startClarification = async () => {
    if (bulkRows.length === 0 || !user || bulkAiLoading) return;

    // Non-pro users cannot use AI scheduling — show upgrade sheet.
    if (!isPro) {
      setUpgradeOpen(true);
      return;
    }

    // Skip the clarification round-trip entirely when the user has already
    // pinned explicit start-times on every task — the AI has all it needs.
    const allTimesSet = bulkRows.length > 0 && bulkRows.every(r => !!r.start_time);
    if (allTimesSet) {
      await autoScheduleBulkRows();
      return;
    }

    // Use questions pre-fetched by parse-tasks (combined call) — no extra round-trip.
    if (preFetchedQuestions !== null) {
      if (preFetchedQuestions.length > 0) {
        setClarificationQuestions(preFetchedQuestions);
        setClarificationAnswers({});
        setBulkStep("clarify");
      } else {
        await autoScheduleBulkRows();
      }
      return;
    }

    // Fallback: call generate-clarification separately (e.g. when parse-tasks failed).
    setBulkAiLoading(true);
    setBulkAiStep("clarifying");
    const signal = getAiAbortSignal();
    try {
      const { data, error } = await invokeAiCached<AiPlanResponse>(
        "generate-clarification",
        {
          raw_input: bulkRows.map(r =>
            r.start_time ? `${r.title} at ${r.start_time}` : r.title
          ).join("\n"),
        },
        { ttlMs: 15_000, timeoutMs: 20_000, signal }
      );
      if (signal.aborted) return;
      if (error) throw error;
      const questions = data?.questions || [];
      if (questions.length > 0) {
        setClarificationQuestions(questions);
        setClarificationAnswers({});
        setBulkStep("clarify");
      } else {
        await autoScheduleBulkRows();
      }
    } catch (e) {
      if (signal.aborted) return;
      console.warn("Clarification failed, proceeding to plan:", e);
      toast("Couldn't load clarification questions — planning directly", { duration: 2500 });
      await autoScheduleBulkRows();
    } finally {
      if (!signal.aborted) { setBulkAiLoading(false); setBulkAiStep(null); }
    }
  };

  const autoScheduleBulkRows = async () => {
    if (bulkRows.length === 0 || !user || bulkAiLoading) return;
    if (!isPro) { setUpgradeOpen(true); return; }
    setBulkAiLoading(true);
    setBulkAiStep("planning");
    const signal = getAiAbortSignal();
    try {
      // Schedule against the date the composer was opened on (see addBulkRows).
      const targetDate = composerTargetDateRef.current;
      const nowHM = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      const startHHMM = targetDate === todayDateStr() ? nowHM : "09:00";
      const tz = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { data, error } = await invokeAiCached<AiPlanResponse>(
        "generate-plan",
        {
          // Embed time + duration hints already set in the review step so
          // generate-plan treats them as HIGHEST PRIORITY fixed commitments
          // (its prompt already handles "at HH:MM" and "[Xmin]" patterns).
          raw_input: bulkRows.map(r => {
            let line = r.title;
            if (r.duration != null) line += ` [${r.duration}min]`;
            if (r.start_time) line += ` at ${r.start_time}`;
            return line;
          }).join("\n"),
          planning_context: Object.keys(clarificationAnswers).length > 0
            ? "User Clarifications:\n" + Object.entries(clarificationAnswers).map(([qId, a]) => {
                const qText = clarificationQuestions.find(q => q.id === qId)?.text || qId;
                return `- Q: ${qText}\n  A: ${a}`;
              }).join("\n")
            : undefined,
          energy_preference: profile?.energy_preference || "morning",
          name: profile?.display_name,
          mode: "plan",
          start_time: startHHMM,
          plan_date: targetDate,
          now_iso: new Date().toISOString(),
          timezone: tz,
          // Send only user-configured hours; edge function defaults to 00:00–23:59
          // when nothing is provided, so the AI is uncapped unless the user has
          // explicitly set their own active window in Settings.
          active_hours_start: profile?.active_hours_start || undefined,
          active_hours_end: profile?.active_hours_end || undefined,
          ai_tone: profile?.ai_tone || "professional",
          ai_tone_custom: profile?.ai_tone_custom || null,
          ai_planning_rules: profile?.ai_planning_rules || "",
          ai_context_custom: profile?.ai_context_custom || null,
        },
        { ttlMs: 0, timeoutMs: 75_000, signal },
      );
      if (signal.aborted) return;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.blocks && Array.isArray(data.blocks)) {
        // Filter to task blocks only — AI may insert breaks/buffers that shift indices.
        const taskBlocks = (data.blocks || []).filter(b => b.kind === "task");
        // Match each original row to an AI block by title similarity, not by index,
        // so that splits, breaks, or re-orderings can't cause tasks to vanish.
        const normalize = (s: string) =>
          String(s || "").toLowerCase().replace(/\s*\(part\s*\d+\)/i, "").replace(/[^a-z0-9 ]/g, "").trim();
        const matched = new Set<number>();
        const newRows = bulkRows.map((row) => {
          const rowKey = normalize(row.title);
          let bestIdx = -1;
          let bestScore = 0;
          taskBlocks.forEach((b, idx) => {
            if (matched.has(idx)) return;
            const aiKey = normalize(b.title);
            const score =
              aiKey === rowKey ? 3 :
              aiKey.includes(rowKey) || rowKey.includes(aiKey) ? 2 :
              aiKey.split(" ").some(w => w.length > 3 && rowKey.includes(w)) ? 1 : 0;
            if (score > bestScore) { bestScore = score; bestIdx = idx; }
          });
          if (bestIdx >= 0 && bestScore > 0) {
            matched.add(bestIdx);
            const aiBlock = taskBlocks[bestIdx];
            return {
              title: row.title,  // always keep the user's original title
              duration: row.duration ?? aiBlock.duration_min,
              // If user explicitly pinned a start_time in review, it takes
              // priority over whatever the AI scheduled (AI may move past times).
              start_time: row.start_time ?? aiBlock.start_time,
              type: aiBlock.type,
              kind: aiBlock.kind,
              ai_reasoning: aiBlock.reasoning,
              overlap_ok: Boolean(aiBlock.overlap_ok),
              parallel_group_id: aiBlock.parallel_group_id,
            };
          }
          return row;
        });
        const sortedRows = newRows.sort((a, b) => {
          const tA = a.start_time ? timeToMinutes(a.start_time) : 9999;
          const tB = b.start_time ? timeToMinutes(b.start_time) : 9999;
          return tA - tB;
        });
        setBulkRows(sortedRows);
        setBulkStep("review");
        haptics.notify("success");
      } else {
        // AI returned a response but without usable blocks — surface this
        // explicitly instead of leaving the user on a blank review step.
        toast.error("AI returned an empty plan — try rephrasing your tasks.");
      }
    } catch (e) {
      if (signal.aborted) return;
      const raw = (e?.message || "").toString();
      const friendly =
        /Failed to send a request|Load failed|Failed to fetch|NetworkError|net::|ENOTFOUND|ECONNREFUSED|aborted/i.test(raw)
          ? "Couldn't reach the AI — check your connection and try again."
          : raw && !/AI gateway error/i.test(raw)
            ? raw
            : "Couldn't auto-schedule. Please try again.";
      toast.error(friendly);
    } finally {
      if (!signal.aborted) { setBulkAiLoading(false); setBulkAiStep(null); }
    }
  };

  /** Ensure (and return) the plan id for an arbitrary date. */
  const ensurePlanIdForDate = async (date: string): Promise<string | null> => {
    if (!user) return null;
    const { data: existing } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("date", date)
      .maybeSingle();
    if (existing?.id) return existing.id as string;
    const { data: created, error } = await supabase
      .from("plans")
      .insert({ user_id: user.id, date, raw_input: "" })
      .select("id")
      .single();
    if (error || !created?.id) {
      toast.error(error?.message || "Couldn't open that day");
      return null;
    }
    return created.id as string;
  };

  /** Copy a set of blocks onto a target day as fresh user tasks, then mark
   *  the originals as `skipped` so they read as "moved" rather than missed. */
  const moveBlocksToDate = async (
    sourceBlocks: ExBlock[],
    targetDate: string,
  ): Promise<{ moved: number } | null> => {
    if (!user) return null;
    const items = sourceBlocks.filter(
      (b) => !b.is_calendar_event && b.kind === "task",
    );
    if (!items.length) return { moved: 0 };
    const targetPlanId = await ensurePlanIdForDate(targetDate);
    if (!targetPlanId) return null;
    // Read existing blocks on the target day to compute position offset.
    const { data: existing } = await supabase
      .from("blocks")
      .select("id, position")
      .eq("plan_id", targetPlanId);
    const startPos = (existing?.length ?? 0);
    const toInsert = items.map((b, i) => ({
      plan_id: targetPlanId,
      user_id: user.id,
      start_time: "09:00",
      duration_min: b.duration_min,
      title: b.title,
      type: b.type,
      kind: "task" as const,
      block_type: inferScheduleBlockType(b),
      completed: false,
      position: startPos + i,
      estimated_minutes: b.estimated_minutes ?? b.duration_min,
      actual_minutes: null,
      location: b.location ?? null,
      location_lat: b.location_lat ?? null,
      location_lng: b.location_lng ?? null,
      slot_end_time: blockSlotEndHHMM({
        start_time: "09:00",
        duration_min: b.duration_min,
      } as Block),
      // Track origin so a subsequent move can delete this copy cleanly.
      source_block_id: b.source_block_id ?? b.id,
    }));
    const { error: insertErr } = await supabase.from("blocks").insert(toInsert);
    if (insertErr) {
      const msg = insertErr.message || "";
      if (msg.includes("PLAN_QUOTA_REACHED")) {
        void refreshEntitlement();
        toast(`Free trial limit reached — ${planQuotaLimit} planning days used`, {
          description: "Upgrade to keep moving tasks to new days.",
          action: { label: "Upgrade", onClick: () => setUpgradeOpen(true) },
        });
        setUpgradeOpen(true);
        return null;
      }
      throw insertErr;
    }
    // Mark the source blocks as moved (resolution=skipped, so they don't
    // keep counting as "missed" on revisits).
    const movedAt = new Date().toISOString();
    await supabase
      .from("blocks")
      .update({ resolution: "skipped", resolved_at: movedAt, moved_to_date: targetDate })
      .in("id", items.map((b) => b.id));
    return { moved: items.length };
  };

  const handleDayPickerPick = async (targetDate: string) => {
    const intent = dayPickerIntent;
    setDayPickerIntent(null);
    if (!intent) return;
    if (intent.kind === "navigate") {
      navigateToDay(targetDate);
      return;
    }
    if (targetDate === viewDate) {
      toast("Pick a different day");
      return;
    }
    if (intent.kind === "move-task") {
      const blk = blocks.find((b) => b.id === intent.blockId);
      if (!blk) return;
      // Open the Review tasks sheet so the user can tweak time/duration
      // before committing the move. pendingMoveState carries the source
      // blocks + target date into addBulkRows.
      setPendingMoveState({ sourceBlocks: [blk], targetDate });
      setBulkRows([{
        title: blk.title,
        duration: Number(blk.duration_min) || 30,
        start_time: blk.start_time || undefined,
        type: blk.type || "deep_work",
      }]);
      setBulkStep("review");
      composerTargetDateRef.current = targetDate;
      setComposerOpen(true);
      return;
    }
    if (intent.kind === "carry-missed") {
      // Use the same movableTasks list the banner shows — guarantees the count
      // the user sees in the banner equals the count that actually gets moved.
      const candidates = movableTasks;
      if (!candidates.length) {
        toast("Nothing left to carry forward");
        return;
      }
      // Open Review tasks so user can set time/duration for ALL carried tasks.
      setPendingMoveState({ sourceBlocks: candidates, targetDate });
      setBulkRows(candidates.map((b) => ({
        title: b.title,
        duration: Number(b.duration_min) || 30,
        start_time: b.start_time || undefined,
        type: b.type || "deep_work",
      })));
      setBulkStep("review");
      composerTargetDateRef.current = targetDate;
      setMoreOpen(false);
      setComposerOpen(true);
      return;
    }
    if (intent.kind === "checklist-carry-ungrouped") {
      const candidates = checklistRef.current?.getUngroupedUnfinishedItems() || [];
      if (!candidates.length) {
        toast("Nothing left to carry forward");
        return;
      }
      try {
        await checklistRef.current?.moveItemsToDate(candidates.map(i => i.id), targetDate);
        setMoreOpen(false);
        haptics.notify("success");
        toast.success(
          `Moved ${candidates.length} item${candidates.length === 1 ? "" : "s"} to ${friendlyDateFor(parseDateStr(targetDate))}`,
          { action: { label: "Open", onClick: () => navigateToDay(targetDate) } },
        );
      } catch (e) {
        toast.error(e?.message || "Unable to carry items forward");
      }
    }
  };


  const firstUnfinishedTask = displayBlocks.find((b) => isUserTask(b) && isOpenUserTask(b));
  const userTasks = displayBlocks.filter(isUserTask);
  const totalTasks = userTasks.length;
  const doneTasks = userTasks.filter((b) => isUserTaskDone(b)).length;
  // Missed = never started (resolution "missed").
  // Skipped = user explicitly skipped. Both can be moved to another day.
  const movableTasks = useMemo(
    () =>
      displayBlocks.filter(
        (b) =>
          isUserTask(b) &&
          !b.is_calendar_event &&
          // Exclude tasks already moved to another day — moved_to_date is set
          // by moveBlocksToDate when the user carries or individually moves a task.
          !(b as ExBlock).moved_to_date &&
          ((b as ExBlock).resolution === "missed" || (b as ExBlock).resolution === "skipped"),
      ),
    [displayBlocks],
  );
  // Keep alias for any existing references below.
  const missedTasks = movableTasks;

  const spotlightId = useMemo(
    () => displayBlocks.find((b) => isUserTask(b) && isOpenUserTask(b) && !b.is_calendar_event)?.id,
    [displayBlocks],
  );

  // ── Render-perf memoization for the block list ──────────────────────────
  // O(1) category lookup instead of a per-row `.find()` over all categories.
  const categoryMap = useMemo(
    () => new Map(tracker.categories.map((c) => [c.id, c])),
    [tracker.categories],
  );
  // Stable id array for dnd-kit's SortableContext.
  // Exclude break rows (empty divs) and resolved user tasks (done/skipped/missed)
  // so dnd-kit never animates them when an active task is dragged nearby.
  // Calendar events and rest/lunch blocks stay in — they're in the active tier
  // and dnd-kit needs their rects for correct ghost positioning.
  const blockIds = useMemo(() =>
    blocks
      .filter(b => {
        if (b.kind === "break") return false;
        if (b.kind !== "task" || b.is_calendar_event) return true;
        return isOpenUserTask(b as Block);
      })
      .map(b => b.id),
  [blocks]);
  // Earliest selectable time today — recomputed only on the minute tick, not
  // every render. Stable identity keeps memo'd rows from re-rendering otherwise.

  // The block-row handlers close over lots of state; recreating them inline per
  // render broke SortableBlock's memo and re-rendered every row on any DayView
  // state change. We keep the live closures in a ref and expose STABLE wrappers
  // so identities never change — rows only re-render when their own data does.
  const liveBlockHandlers = {
    onTapTime: (blk: Block, newTime?: string) => {
      if (newTime) {
        startTimeTargetRef.current = blk.id;
        void commitStartTime(newTime);
      } else {
        openStartTimePicker(blk as Block);
      }
    },
    onToggleComplete: (blk: Block) => {
      if (blk?.is_calendar_event) return;
      const res = (blk as ExBlock).resolution;
      if (res === "missed" || res === "skipped") { setLateCompleteBlock(blk as ExBlock); return; }
      completeBlock(blk.id);
    },
    onStartTrack: (blk: Block) => { if (blk?.is_calendar_event) return; setTrackPickerBlock(blk); },
    onStopTrack: (blk: Block) => { void stopTrackingForBlock(blk); },
    onCarryForward: (blk: Block) => setDayPickerIntent({ kind: "move-task", blockId: blk.id }),
    onEditDuration: (blk: Block) => setDurationEditId(blk.id),
    onEditReminders: (blk: Block) => openReminders(blk.id),
    onAskAi: (blk: Block) => {
      const activeTrackerMin = tracker.active?.block_id === blk.id 
        ? Math.floor((Date.now() - new Date(tracker.active.started_at).getTime()) / 60000) 
        : undefined;
      setAskAiTaskTitle(blk.title);
      setAskAiContext(buildTaskSeedContext(blk as ExBlock, blocks, activeTrackerMin));
      setAskAiOpen(true);
    },
    onSaveTemplate: (blk: Block) => void saveAsTemplate(blk),
    onSkip: (blk: Block) => void skipBlock(blk.id),
    onDeleteBlock: (blk: Block) => removeBlock(blk.id),
    onRename: (blk: Block, title: string) => void renameBlock(blk.id, title),
  };
  const blockHandlersRef = useRef(liveBlockHandlers);
  blockHandlersRef.current = liveBlockHandlers;
  const blockHandlers = useMemo(() => ({
    onTapTime: (b: Block, t?: string) => blockHandlersRef.current.onTapTime(b, t),
    onToggleComplete: (b: Block) => blockHandlersRef.current.onToggleComplete(b),
    onStartTrack: (b: Block) => blockHandlersRef.current.onStartTrack(b),
    onStopTrack: (b: Block) => blockHandlersRef.current.onStopTrack(b),
    onEditDuration: (b: Block) => blockHandlersRef.current.onEditDuration(b),
    onEditReminders: (b: Block) => blockHandlersRef.current.onEditReminders(b),
    onAskAi: (b: Block) => blockHandlersRef.current.onAskAi(b),
    onSaveTemplate: (b: Block) => blockHandlersRef.current.onSaveTemplate(b),
    onSkip: (b: Block) => blockHandlersRef.current.onSkip(b),
    onDeleteBlock: (b: Block) => blockHandlersRef.current.onDeleteBlock(b),
    onRename: (b: Block, title: string) => blockHandlersRef.current.onRename(b, title),
  }), []);
  // Carry-forward is hidden on future plans — preserve the undefined semantics
  // (SortableBlock keys its UI off the prop's presence). Identity only flips
  // when isFuture changes.
  const onCarryForwardStable = useMemo(
    () => (isFuture ? undefined : (b: Block) => blockHandlersRef.current.onCarryForward(b)),
    [isFuture],
  );
  // Drag overlay content — recompute only while a drag is active.
  const dragOverlayContent = useMemo(() => {
    if (!activeDragId) return null;
    const dragBlock = blocks.find((b) => b.id === activeDragId);
    if (!dragBlock) return null;
    const assignedId = getAssignedCategoryId(activeDragId);
    const assignedCat = assignedId ? categoryMap.get(assignedId) || null : null;
    return (
      <SortableBlock
        block={dragBlock}
        editing={false}
        tourSpotlight={false}
        trackingActive={!!tracker.active && tracker.active.block_id === activeDragId}
        assignedCategory={assignedCat}
        isOverlay
      />
    );
  }, [activeDragId, blocks, categoryMap, tracker.active]);

  return (
    <>
    <PullToRefresh
        onRefresh={async () => {
          await refetch();
          void invalidatePlanCaches();
        }}
      >
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", bounce: 0.15, duration: 0.6 }}
        className="flex w-full flex-col px-5 pt-[var(--content-inset-top)] pb-8"
      >
        <div className="app-card no-chrome-border px-2 py-2.5 flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigateToDay(yesterdayDate)}
            className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-secondary-fg/90 pressable"
            aria-label="Previous day"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setDayPickerIntent({ kind: "navigate" })}
            className="flex-1 min-w-0 flex flex-col items-center px-1 py-1 rounded-2xl pressable"
            aria-label="Pick a day"
          >
            <h1 className="font-display text-[22px] font-medium tracking-[-0.02em] text-foreground/95 text-center truncate w-full leading-tight">
              {isToday ? "Today" : parseDateStr(viewDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </h1>
            {!isToday && (
              <span className="mt-1 text-[11px] font-medium text-primary/85">Tap to jump</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigateToDay(tomorrowDate)}
            className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-secondary-fg/90 pressable"
            aria-label="Next day"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          {((planViewMode === "timeline" && !planMissing) || (planViewMode === "checklist" && (checklistCounts.total > 0 || checklistCounts.groups > 0))) && (
            <button
              onClick={() => setMoreOpen(true)}
              className="more-menu-btn h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-secondary-fg/90 pressable"
              aria-label="More"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Plan mode switcher — Timeline | Checklist (always visible in both) */}
        <PlanModePill mode={planViewMode} onChange={setPlanViewMode} openCount={checklistCounts.open} />

        {planViewMode === "checklist" ? (
          <div className="checklist-theme">
          <ChecklistView
            ref={checklistRef}
            userId={user?.id}
            viewDate={viewDate}
            eveningNudgeTime={profile?.evening_nudge_local_time}
            onChange={handleChecklistChange}
          />
          </div>
        ) : (
        <>
        {/* Progress bar */}
        {!planMissing && totalTasks > 0 && (
          <div className="mt-4 shrink-0">
            <div className="app-card no-chrome-border px-4 py-3">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="text-[13px] text-foreground/95 tabular-nums">
                  <span className="font-bold">{doneTasks}</span>
                  <span className="text-secondary-fg/60 font-normal"> / {totalTasks} done</span>
                </div>
                <div className="flex items-center gap-2">
                  {totalTasks > 0 && (
                    <span className="text-[12px] font-semibold text-primary tabular-nums">
                      {Math.round((doneTasks / totalTasks) * 100)}%
                    </span>
                  )}
                  {(() => {
                    // Sum actual_minutes for completed tasks, planned duration_min for
                    // the rest (so the total reflects real time spent, not planned).
                    const totalMin = userTasks.reduce((s, b) => {
                      const min = (b.completed || b.resolution === "done") && typeof b.actual_minutes === "number" && b.actual_minutes > 0
                        ? b.actual_minutes
                        : b.duration_min;
                      return s + min;
                    }, 0);
                    const h = Math.floor(totalMin / 60);
                    const m = totalMin % 60;
                    const label = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
                    return <span className="text-[11px] text-secondary-fg/55 tabular-nums">{label}</span>;
                  })()}
                </div>
              </div>
              <div className="h-2 rounded-full bg-muted/45 overflow-hidden">
                <div
                  className="h-full rounded-full progress-fill"
                  style={{ width: totalTasks ? `${(doneTasks / totalTasks) * 100}%` : "0%" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Movable tasks banner — fades out smoothly when all tasks are moved.
            Gated on blocksMatchView so the AnimatePresence exit animation never
            plays during a day-switch: without the gate the spring exit runs
            300–500ms after viewDate changes, keeping the banner in the layout
            and shoving the new day's skeleton below visible area. */}
        {blocksMatchView && <AnimatePresence>
          {!planMissing && !isFuture && movableTasks.length > 0 && (
            <motion.button
              key="carry-banner"
              type="button"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              onClick={() => setDayPickerIntent({ kind: "carry-missed" })}
              className="mt-4 shrink-0 w-full flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/[0.08] px-4 py-3 pressable hover:bg-destructive/[0.13] transition-colors text-left"
            >
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden />
              <span className="flex-1 min-w-0">
                <span className="text-[13px] font-semibold text-destructive leading-snug">
                  {movableTasks.length === 1
                    ? "1 unfinished task"
                    : `${movableTasks.length} unfinished tasks`}
                </span>
                <span className="block text-[11px] text-destructive/70 mt-0.5 leading-snug">
                  Tap to move to another day
                </span>
              </span>
              <ArrowRightCircle className="h-4 w-4 text-destructive/60 shrink-0" />
            </motion.button>
          )}
        </AnimatePresence>}

        {/* Inline "Start" CTA — only on today; past days are read-only and
            future days aren't actionable yet. */}
        {!planMissing && isToday && firstUnfinishedTask && (
          <Button
            onClick={() => nav(`/focus/${firstUnfinishedTask.id}`)}
            className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[15px] font-semibold pressable shadow-[0_8px_30px_-6px_hsl(var(--primary)/0.5)] border border-primary/20 mt-4 mb-1"
          >
            <Play className="h-4 w-4 mr-2" fill="currentColor" />
            {toneCopy(getTone(profile), doneTasks === 0 ? "start_first" : "start_next")}
          </Button>
        )}

        {planMissing && (
          <div className="flex items-center justify-center" style={{ minHeight: "56vh" }}>
          <div className="w-full rounded-[28px] border border-border/30 bg-card/35 px-6 py-12 text-center hero-glass shadow-card relative overflow-hidden empty-state-fade">
            {/* Soft decorative background circles inside the empty card */}
            <div className="absolute -top-12 -left-12 h-28 w-28 rounded-full bg-primary/8 blur-xl pointer-events-none" />
            <div className="absolute -bottom-12 -right-12 h-28 w-28 rounded-full bg-primary-glow/8 blur-xl pointer-events-none" />
            
            <div className="h-12 w-12 rounded-2xl bg-gradient-primary flex items-center justify-center mx-auto mb-4 border border-primary/25 shadow-[0_4px_16px_hsl(var(--primary)/0.2)] breathe">
              <CalendarDays className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="text-[17px] font-semibold text-foreground tracking-tight">
              {isToday ? "Empty day" : friendlyDateFor(parseDateStr(viewDate))}
            </div>
            <p className="text-[13px] text-secondary-fg/80 mt-2 leading-relaxed max-w-[260px] mx-auto">
              {isPast
                ? "No plan was made for this day."
                : "Add your tasks — type them out, paste a list, or let AI plan your day."}
            </p>
            {/* Past days are read-only — no Add/Ask-AI affordances. */}
            {!isPast && (
              <div className="mt-7 flex flex-col gap-2.5 max-w-[240px] mx-auto relative z-10">
                <button
                  type="button"
                  onClick={() => setComposerOpen(true)}
                  className="add-tasks-btn btn-volumetric pressable inline-flex items-center justify-center gap-2 w-full h-12 rounded-[18px] text-primary-foreground text-[14px] font-semibold"
                >
                  <ListPlus className="h-4 w-4" /> Add tasks
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAskAiTaskTitle(null);
                    setAskAiContext("__empty_day__");
                    setAskAiOpen(true);
                  }}
                  className="pressable inline-flex items-center justify-center gap-2 w-full h-11 rounded-[18px] text-[13px] font-semibold text-foreground/90 border border-soft bg-card dark:bg-white/[0.06] shadow-card dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.2)] backdrop-blur-sm"
                >
                  <Wand2 className="h-4 w-4 text-primary" /> Ask AI
                </button>
              </div>
            )}
          </div>
          </div>
        )}

        {!planMissing && (
          <>
            {((loading && displayBlocks.length === 0) || !blocksMatchView) && <SkeletonBlock count={4} />}
            {(blocksMatchView && displayBlocks.length > 0) && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragCancel={() => setDndBodyScrollLock(false)}
                onDragEnd={onDragEnd}
              >
                <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
                  <div className={`touch-pan-y space-y-2.5 mt-4 ${introPlayed ? "" : "enter-stagger"}`}>
                    {displayBlocks.map((b, idx) => {
                      // Working set is break-free (filtered on load), so every row
                      // is a real card. Lunch renders as a normal rest card.
                      const assignedId = getAssignedCategoryId(b.id);
                      const assignedCat = assignedId ? categoryMap.get(assignedId) || null : null;

                      // Visual separator between active tasks and resolved (done/skipped/missed).
                      const bIsResolved = b.kind === "task" && !b.is_calendar_event && !isOpenUserTask(b as Block);
                      const prev = displayBlocks[idx - 1];
                      const prevIsActive = prev && !(prev.kind === "task" && !prev.is_calendar_event && !isOpenUserTask(prev as Block));
                      const showSeparator = bIsResolved && !!prev && prevIsActive;
                      // "Running late" amber hint — shown for ANY open user task
                      // (timed OR frameless) whose start time has passed and which
                      // you haven't acted on or aren't actively tracking. A frameless
                      // task stays late until you act; a timed task is flipped to
                      // "missed" by applyAutoMissedBlocks once its window ends, which
                      // replaces this hint with the Missed badge.
                      const nowMin = now.getHours() * 60 + now.getMinutes();
                      const isTrackingThis = !!tracker.active && tracker.active.block_id === b.id;
                      // For timed tasks: only "late" while still inside the window.
                      // Once nowMin >= blockEndMin the task should be (or soon will
                      // be) auto-missed — don't keep labelling it "late" forever.
                      // Frameless tasks (durMin = 0) use Infinity so they always show.
                      const bDurMin = Number(b.duration_min) || 0;
                      const blockEndMin = bDurMin > 0 ? timeToMinutes(b.start_time) + bDurMin : Infinity;
                      const lateMin = isToday && isUserTask(b) && isOpenUserTask(b) && !b.is_calendar_event && !isTrackingThis && timeToMinutes(b.start_time) < nowMin && nowMin < blockEndMin
                        ? nowMin - timeToMinutes(b.start_time)
                        : undefined;

                      return (
                      <Fragment key={b.id}>
                        {showSeparator && (
                          <div className="flex items-center gap-3 py-1 px-1">
                            <div className="flex-1 h-px bg-border/30" />
                            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/40 shrink-0 select-none">
                              Past
                            </span>
                            <div className="flex-1 h-px bg-border/30" />
                          </div>
                        )}
                        <SortableBlock
                          block={b}
                          editing={false}
                          tourSpotlight={spotlightId === b.id}
                          trackingActive={!!tracker.active && tracker.active.block_id === b.id}
                          assignedCategory={assignedCat}
                          isFuturePlan={isFuture}
                          readOnly={isPast}
                          lateMin={lateMin}

                          onTapTime={blockHandlers.onTapTime}
                          onToggleComplete={blockHandlers.onToggleComplete}
                          onStartTrack={blockHandlers.onStartTrack}
                          onStopTrack={blockHandlers.onStopTrack}
                          onCarryForward={onCarryForwardStable}
                          onEditDuration={blockHandlers.onEditDuration}
                          onEditReminders={blockHandlers.onEditReminders}
                          onAskAi={blockHandlers.onAskAi}
                          onSaveTemplate={blockHandlers.onSaveTemplate}
                          onSkip={isPast ? undefined : blockHandlers.onSkip}
                          onDeleteBlock={blockHandlers.onDeleteBlock}
                          onRename={isPast ? undefined : blockHandlers.onRename}
                        />
                      </Fragment>
                      );
                    })}
                    {blocks.length === 0 && (
                      <div className="text-center px-6 min-h-[42vh] flex flex-col items-center justify-center empty-state-fade">
                        <div className="mb-4 h-12 w-12 rounded-2xl border border-soft surface-card flex items-center justify-center breathe">
                          <ListPlus className="h-5 w-5 text-secondary-fg/70" aria-hidden />
                        </div>
                        <p className="text-[15px] font-medium text-foreground/95">Nothing scheduled yet</p>
                        <p className="text-[13px] text-secondary-fg/80 mt-1.5 leading-relaxed max-w-[280px]">
                          Brain-dump your tasks below — DayDraft turns them into a timed plan.
                        </p>
                      </div>
                    )}
                  </div>
                </SortableContext>
                <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
                  {dragOverlayContent}
                </DragOverlay>
              </DndContext>
            )}

            {!isPast && (
              <motion.div layout className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setComposerOpen(true)}
                  disabled={planMutating}
                  className="add-tasks-btn btn-volumetric pressable inline-flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-primary-foreground rounded-2xl h-11"
                >
                  <ListPlus className="h-3.5 w-3.5" /> Add tasks
                </button>
                <button
                  onClick={() => {
                    setAskAiTaskTitle(null);
                    setAskAiContext(buildDaySeedContext(blocks));
                    setAskAiOpen(true);
                  }}
                  disabled={planMutating}
                  className="inline-flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-primary border border-primary/35 rounded-2xl h-11 bg-primary/12 hover:bg-primary/20 pressable transition-colors shadow-[0_4px_14px_-6px_hsl(var(--primary)/0.35)]"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Ask AI
                </button>
              </motion.div>
            )}

          </>
        )}
        </>
        )}
      </motion.div>
      </PullToRefresh>

      {/* Portaled all-done toast (Start button is now inline above the
          task list — see the JSX further up). */}
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {dayTabVisible && showAllDone && (
            <motion.div
              key="all-done-toast"
              initial={{ opacity: 0, x: "-50%", y: 20 }}
              animate={{ opacity: 1, x: "-50%", y: 0 }}
              exit={{ opacity: 0, x: "-50%", y: 10, scale: 0.95 }}
              transition={{ duration: 0.4 }}
              className="fixed left-1/2 w-full max-w-[440px] px-6 z-40 pointer-events-none"
              style={{ bottom: "calc(84px + env(safe-area-inset-bottom))" }}
            >
              <div className="w-full h-12 rounded-full bg-success/10 text-success border border-success/20 flex items-center justify-center gap-2 text-[14px] font-semibold backdrop-blur-md">
                <span className="text-success/90">✓</span> All done for today
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Header "more" sheet — Re-plan, Delete plan */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="more-menu-content rounded-t-[28px] border-border/45 bg-popover" hideClose>
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="text-[16px]">Plan options</SheetTitle>
          </SheetHeader>

          {/* Master notifications toggle */}
          <div className="mb-2 flex items-center gap-3 rounded-2xl border border-soft bg-card/40 px-4 py-3">
            <span
              className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center"
              style={{
                background: notifsEnabled
                  ? "hsl(var(--primary) / 0.12)"
                  : "hsl(var(--muted) / 0.6)",
                boxShadow: notifsEnabled
                  ? "inset 0 0 0 1px hsl(var(--primary) / 0.25)"
                  : "inset 0 0 0 1px hsl(var(--border) / 0.4)",
              }}
            >
              {notifsEnabled ? (
                <Bell className="h-4 w-4 text-primary" />
              ) : (
                <BellOff className="h-4 w-4 text-secondary-fg/70" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold text-foreground leading-tight">
                Task notifications
              </div>
              <div className="text-[12px] text-secondary-fg/70 mt-0.5 leading-snug">
                {notifsEnabled
                  ? "Reminders, start & wrap-up pings"
                  : "All reminders are muted"}
              </div>
            </div>
            <Switch
              checked={notifsEnabled}
              onCheckedChange={toggleAllNotifications}
            />
          </div>

          {planViewMode === "timeline" ? (
            <>
              {!isFuture && (
                <ActionRow
                  onClick={() => {
                    setMoreOpen(false);
                    setDayPickerIntent({ kind: "carry-missed" });
                  }}
                  icon={<CalendarDays className="h-4 w-4" />}
                  label="Carry unfinished to…"
                />
              )}
              {blocks.length > 0 && (
                <ActionRow
                  onClick={() => { setMoreOpen(false); void copyDayOutline(); }}
                  icon={<Copy className="h-4 w-4" />}
                  label="Copy plan as text"
                />
              )}
            </>
          ) : (
            <>
              {checklistCounts.total > 0 && (
                <ActionRow
                  onClick={() => {
                    setMoreOpen(false);
                    checklistRef.current?.enterSelectMode();
                  }}
                  icon={<CheckSquare className="h-4 w-4" />}
                  label="Select items"
                />
              )}
              {!isFuture && (
                <ActionRow
                  onClick={() => {
                    setMoreOpen(false);
                    setDayPickerIntent({ kind: "checklist-carry-ungrouped" });
                  }}
                  icon={<CalendarDays className="h-4 w-4" />}
                  label="Carry unfinished to…"
                />
              )}
              <ActionRow
                onClick={() => {
                  setMoreOpen(false);
                  checklistRef.current?.copyPlanAsText();
                }}
                icon={<Copy className="h-4 w-4" />}
                label="Copy plan as text"
              />
            </>
          )}
          {/* Past days are frozen — deleting a finished day's plan is locked. */}
          {!isPast && (
            <ActionRow
              onClick={() => { setMoreOpen(false); setConfirmDeletePlan(true); }}
              icon={<Trash2 className="h-4 w-4" />}
              label={planViewMode === "checklist" ? "Delete checklist" : "Delete plan"}
              destructive
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Task composer — bulk mode only */}
      <Sheet
        open={composerOpen}
        onOpenChange={(v) => {
          if (!v) { setBulkStep("input"); setBulkInput(""); setBulkRows([]); setPendingMoveState(null); }
          setComposerOpen(v);
        }}
      >
        <SheetContent 
          side="bottom" 
          className="rounded-t-[28px] border-border/45 bg-popover max-h-[92vh] flex flex-col"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetHeader className="text-left shrink-0">
            <SheetTitle className="flex items-center gap-2 text-[16px]">
              {bulkStep === "review" && pendingMoveState
                ? <><ListPlus className="h-4 w-4 text-primary" /> Move to {friendlyDateFor(parseDateStr(pendingMoveState.targetDate))}</>
                : bulkStep === "review"
                  ? <><ListPlus className="h-4 w-4 text-primary" /> Review tasks</>
                  : <><ListPlus className="h-4 w-4 text-primary" /> Add tasks</>
              }
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 flex-1 overflow-y-auto">
            {bulkStep === "input" ? (
              <BulkInputStep
                initialValue={bulkInput}
                templates={templates}
                onDeleteTemplate={handleComposerDeleteTemplate}
                onContinue={handleComposerContinue}
                disabled={planMutating || bulkParsing}
                loading={bulkParsing}
              />
            ) : bulkStep === "clarify" ? (
              <div className="flex flex-col gap-4 pb-4">
                {/* Header */}
                <div className="flex items-start gap-3 px-0.5">
                  <div className="shrink-0 mt-0.5 h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-[15px] leading-snug">A few quick questions</h3>
                    <p className="text-[12.5px] text-secondary-fg/80 mt-0.5 leading-relaxed">
                      Help AI plan smarter — answer what you can.
                    </p>
                  </div>
                </div>

                {/* Question cards */}
                <div className="space-y-3">
                  {clarificationQuestions.map((q, qi) => {
                    const selectedOpt = clarificationAnswers[q.id];
                    const isCustom = selectedOpt && !q.options.includes(selectedOpt);
                    return (
                      <div
                        key={q.id}
                        className="rounded-[18px] border border-border/55 bg-foreground/[0.04] dark:bg-foreground/[0.06] px-4 py-4"
                      >
                        {/* Step indicator + question */}
                        <div className="flex items-baseline gap-2 mb-3">
                          {clarificationQuestions.length > 1 && (
                            <span className="shrink-0 text-[10px] font-bold tabular-nums text-primary/55 uppercase tracking-wider">
                              {qi + 1}/{clarificationQuestions.length}
                            </span>
                          )}
                          <p className="text-[13.5px] font-semibold text-foreground leading-snug">{q.text}</p>
                        </div>

                        {/* Option chips */}
                        <div className="flex flex-wrap gap-2">
                          {q.options.map((opt) => {
                            const active = clarificationAnswers[q.id] === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => {
                                  haptics.selection();
                                  setClarificationAnswers(prev => ({ ...prev, [q.id]: opt }));
                                }}
                                className={[
                                  "pressable inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium transition-all duration-150 border",
                                  active
                                    ? "bg-primary/12 border-primary/35 text-primary"
                                    : "bg-foreground/[0.05] border-border/40 text-secondary-fg hover:bg-foreground/[0.09] hover:text-foreground",
                                ].join(" ")}
                              >
                                {active && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                                {opt}
                              </button>
                            );
                          })}
                        </div>

                        {/* Custom answer input */}
                        <div className="mt-2.5 relative">
                          <input
                            type="text"
                            placeholder="Or type your own answer…"
                            value={isCustom ? selectedOpt : ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setClarificationAnswers(prev => ({ ...prev, [q.id]: v || "" }));
                            }}
                            onFocus={() => {
                              // Clear preset selection when user starts typing custom
                              if (selectedOpt && !isCustom) {
                                setClarificationAnswers(prev => ({ ...prev, [q.id]: "" }));
                              }
                            }}
                            style={{ fontSize: 16 }}
                            className={[
                              "w-full h-9 rounded-xl px-3 text-[13px] border transition-colors outline-none",
                              isCustom
                                ? "bg-primary/[0.06] border-primary/30 text-foreground placeholder:text-secondary-fg/40"
                                : "bg-foreground/[0.03] border-border/35 text-foreground placeholder:text-secondary-fg/35 focus:border-primary/30 focus:bg-primary/[0.04]",
                            ].join(" ")}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* CTA + skip — vertically centered column */}
                <div className="flex flex-col items-center gap-2 pt-1">
                  <Button
                    onClick={() => void autoScheduleBulkRows()}
                    disabled={bulkAiLoading}
                    className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/92 text-white font-semibold pressable"
                  >
                    {bulkAiLoading
                      ? <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      : <Sparkles className="h-5 w-5 mr-2" />}
                    {bulkAiStep === "planning" ? "Building your plan…" : "Build Plan"}
                  </Button>
                  <button
                    type="button"
                    disabled={bulkAiLoading}
                    onClick={() => { setClarificationAnswers({}); void autoScheduleBulkRows(); }}
                    className="text-[12.5px] text-secondary-fg/55 hover:text-secondary-fg py-1.5 pressable transition-colors disabled:opacity-40"
                  >
                    Skip — plan without answers
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pb-4">
                <div className="flex items-start justify-between px-1">
                  <div>
                    <p className="text-[12px] text-secondary-fg leading-relaxed">
                      {pendingMoveState
                        ? "Set time and duration for each task on the new day."
                        : "Review your tasks. Tap time or duration to adjust."
                      }
                    </p>
                    {highlightMissingStartTime && (
                      <p className="text-[11.5px] text-amber-400 font-medium mt-1">
                        Set a start time for each task to continue.
                      </p>
                    )}
                  </div>
                  {!pendingMoveState && (
                    <Button
                      onClick={() => void startClarification()}
                      disabled={bulkAiLoading || planMutating}
                      size="sm"
                      className="h-8 rounded-full bg-primary/10 text-primary border border-primary/25 text-[12px] font-medium pressable shrink-0"
                    >
                      <Loader2 className={`h-3.5 w-3.5 mr-1.5 ${bulkAiLoading ? "animate-spin" : "hidden"}`} />
                      <Sparkles className={`h-3.5 w-3.5 mr-1.5 ${bulkAiLoading ? "hidden" : ""}`} />
                      {bulkAiStep === "clarifying" ? "Thinking…" : bulkAiStep === "planning" ? "Scheduling…" : "Auto-schedule"}
                    </Button>
                  )}
                </div>
                <div className="space-y-2.5 max-h-[48vh] overflow-y-auto pr-1 pb-2 pt-1">
                  {bulkRows.map((row, i) => (
                    <div key={i} className="flex flex-col gap-2 rounded-[18px] border border-border/60 bg-foreground/[0.04] dark:bg-foreground/[0.06] px-4 py-4 shadow-sm">
                      <form 
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          e.currentTarget.querySelector("input")?.blur();
                        }}
                      >
                        <DebouncedInput
                          value={row.title}
                          enterKeyHint="done"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }}
                          onDebouncedChange={(val) => { setBulkRows((rs) => rs.map((r, idx) => idx === i ? { ...r, title: val } : r)); setPreFetchedQuestions(null); }}
                          className="flex-1 h-9 px-3 rounded-xl border border-border/45 bg-foreground/[0.04] text-[15px] font-semibold text-foreground focus-visible:ring-0 focus-visible:border-primary/55 focus-visible:bg-primary/[0.05] shadow-none placeholder:text-secondary-fg/45 transition-colors duration-150"
                        />
                        <button type="button" onClick={() => { setBulkRows((rs) => rs.filter((_, idx) => idx !== i)); setPreFetchedQuestions(null); }}
                          className="h-8 w-8 grid place-items-center rounded-full text-secondary-fg/50 hover:text-destructive hover:bg-destructive/10 pressable transition-colors shrink-0" aria-label="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </form>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        <div className="relative inline-flex items-center">
                          <label
                            className={`relative flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] font-medium pressable transition-colors cursor-pointer select-none ${row.start_time ? "pr-8" : ""} ${
                              !row.start_time && highlightMissingStartTime
                                ? "animate-warn-bg"
                                : !row.start_time
                                  ? "border-border/45 bg-muted/40 text-secondary-fg/55 italic"
                                  : "border-border/45 bg-muted/40 text-secondary-fg hover:text-foreground"
                            }`}
                          >
                            <Clock className="h-3.5 w-3.5 opacity-70 pointer-events-none" />
                            <span className="pointer-events-none">{row.start_time ? fmtTime(row.start_time) : "Set time"}</span>
                            <input
                              type="time"
                              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                              value={row.start_time ?? ""}
                              min={isToday ? roundedNowHHMM() : undefined}
                              tabIndex={-1}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (!val) return;
                                setBulkRows((rs) => {
                                  const next = rs.map((r, idx) => idx === i ? { ...r, start_time: val } : r);
                                  if (highlightMissingStartTime && next.every(r => r.start_time)) setHighlightMissingStartTime(false);
                                  return next;
                                });
                                setPreFetchedQuestions(null);
                              }}
                              style={{ fontSize: 16 }}
                            />
                          </label>
                          {row.start_time && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setBulkRows((rs) => rs.map((r, idx) => idx === i ? { ...r, start_time: undefined } : r));
                                setPreFetchedQuestions(null);
                              }}
                              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full flex items-center justify-center text-secondary-fg hover:bg-foreground/10"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <button type="button" onClick={() => setBulkDurationEditIndex(i)}
                          className={`flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] font-medium tabular-nums pressable transition-colors ${
                            row.duration == null && highlightMissingDuration
                              ? "border-destructive/60 bg-destructive/10 text-destructive animate-pulse"
                              : row.duration == null
                                ? "border-border/45 bg-muted/40 text-secondary-fg/45 italic"
                                : "border-border/45 bg-muted/40 text-secondary-fg hover:text-foreground"
                          }`}
                        >
                          <Timer className="h-3.5 w-3.5 opacity-70" />
                          {row.duration == null
                            ? "Set"
                            : row.duration < 60
                              ? `${row.duration}m`
                              : `${Math.floor(row.duration / 60)}h${row.duration % 60 ? ` ${row.duration % 60}m` : ""}`}
                        </button>
                      </div>
                    </div>
                  ))}
                  {bulkRows.length === 0 && (
                    <p className="text-center text-[13px] text-secondary-fg py-10 bg-muted/20 rounded-[18px] border border-dashed border-border/45 mx-1">No tasks left.</p>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-3 border-t border-border/30 px-1">
                  <Button variant="outline" onClick={() => {
                    if (pendingMoveState) {
                      // In move mode "Back" cancels the whole flow
                      setPendingMoveState(null);
                      setComposerOpen(false);
                      setBulkRows([]);
                      setBulkStep("input");
                    } else {
                      setBulkStep("input");
                    }
                    setHighlightMissingStartTime(false);
                    setHighlightMissingDuration(false);
                  }} disabled={planMutating} className="h-12 rounded-2xl border-soft text-[14px]">
                    {pendingMoveState ? "Cancel" : "Back"}
                  </Button>
                  <Button
                    onClick={() => {
                      // Require a start time for every task so it doesn't float
                      const missingStart = bulkRows.filter(r => !r.start_time).length;
                      if (missingStart > 0) {
                        setHighlightMissingStartTime(true);
                        haptics.notify("error");
                        return;
                      }
                      setHighlightMissingStartTime(false);
                      const missing = bulkRows.filter(r => r.duration == null).length;
                      if (missing > 0) {
                        pendingBulkActionRef.current = () => void addBulkRows(bulkRows);
                        setDurationWarnKind(missing === bulkRows.length ? "all" : "some");
                      } else {
                        void addBulkRows(bulkRows);
                      }
                    }}
                    disabled={planMutating || bulkRows.length === 0}
                    className="flex-1 h-12 rounded-2xl bg-primary hover:bg-primary/92 text-primary-foreground font-semibold pressable"
                  >
                    {pendingMoveState
                      ? `Move ${bulkRows.length} ${bulkRows.length === 1 ? "task" : "tasks"}`
                      : `Add ${bulkRows.length} ${bulkRows.length === 1 ? "task" : "tasks"}`
                    }
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Duration warning dialog — shown when user tries to add/schedule tasks without duration */}
      <AlertDialog open={durationWarnKind !== null} onOpenChange={(v) => { if (!v) { setDurationWarnKind(null); pendingBulkActionRef.current = null; } }}>
        <AlertDialogContent className="max-w-[320px] w-[calc(100vw-2rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {durationWarnKind === "all" ? "No duration set" : "Some tasks missing duration"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {durationWarnKind === "all"
                ? "Without duration you won't be notified when tasks end. Add anyway?"
                : "Tasks without duration won't send an end notification. Add anyway?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDurationWarnKind(null); pendingBulkActionRef.current = null; setHighlightMissingDuration(true); }}>
              Go back
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pendingBulkActionRef.current;
                setDurationWarnKind(null);
                pendingBulkActionRef.current = null;
                action?.();
              }}
            >
              Add anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeletePlan} onOpenChange={setConfirmDeletePlan}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {planViewMode === "checklist" ? "Delete checklist?" : "Delete entire plan?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {planViewMode === "checklist"
                ? `Every checklist item for ${friendlyDateFor(parseDateStr(viewDate))} will be removed.`
                : `The plan for ${friendlyDateFor(parseDateStr(viewDate))} and all its blocks will be removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={planMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (planViewMode === "checklist") {
                  setConfirmDeletePlan(false);
                  // Wipe EVERYTHING for the day — items + categories — not just
                  // items (empty categories used to linger). Checklist-only;
                  // never touches the timeline.
                  checklistRef.current?.deleteAllForDay();
                  toast.success("Checklist deleted");
                  return;
                }
                
                if (!plan) return;
                if (planMutating) return;
                setPlanMutating(true);
                setConfirmDeletePlan(false);
                try {
                  await supabase.from("blocks").delete().eq("plan_id", plan.id);
                  await supabase.from("plans").delete().eq("id", plan.id);
                  void invalidatePlanCaches();
                  toast.success("Plan deleted");
                  nav(isToday ? "/today" : `/today?date=${viewDate}`);
                } catch (e) {
                  toast.error(e?.message || "Unable to delete plan");
                } finally {
                  setPlanMutating(false);
                }
              }}
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={!!reminderBlockId} onOpenChange={(v) => { if (!v) { setReminderBlockId(null); setReminderAdvancedOpen(false); } }}>
        <SheetContent
          side="bottom"
          className="rounded-t-[28px] border-border/45 bg-popover p-0 flex flex-col max-h-[90vh]"
          hideClose
        >
          <SheetTitle className="sr-only">Reminders</SheetTitle>
          {(() => {
            const b = blocks.find(x => x.id === reminderBlockId);
            if (!b) return null;
            const PRIMARY_OPTIONS = [0, 2, 5, 10, 15, 30, 60];
            const SECONDARY_OPTIONS = [0, 5, 10, 15, 30, 60];
            const sortedLeads = [...reminderCfg.leadsMin].sort((a, c) => c - a);
            const primary = sortedLeads[0] ?? 2;
            const secondary = sortedLeads.find((n) => n !== primary) ?? null;
            const setAlerts = (p: number, s: number | null) => {
              const next = s == null || s === p ? [p] : [p, s].sort((a, c) => c - a);
              saveReminders({ ...reminderCfg, leadsMin: next });
            };
            const REPEAT_OPTIONS = [0, 1, 2, 3, 5];
            const fmtDuration = (m: number) => m < 60 ? `${m}m` : `${Math.floor(m/60)}h${m%60 ? ` ${m%60}m` : ""}`;
            const chipBase = "h-9 px-3.5 rounded-full text-[13px] font-semibold pressable tabular-nums transition-[box-shadow,background-color,color] duration-150";
            const chipOn = "text-primary";
            const chipOff = "text-foreground/80";
            const chipStyleOn: React.CSSProperties = {
              background: "linear-gradient(180deg, hsl(var(--primary)/0.18) 0%, hsl(var(--primary)/0.08) 100%)",
              boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.08), 0 0 0 1.5px hsl(var(--primary)/0.45), 0 4px 14px -8px hsl(var(--primary)/0.45)",
            };
            const chipStyleOff: React.CSSProperties = {
              background: "linear-gradient(180deg, hsl(var(--card)/0.6) 0%, hsl(var(--card)/0.35) 100%)",
              boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.05), 0 0 0 1px hsl(var(--border)/0.45)",
            };
            const smallChipBase = "h-8 px-3 rounded-full text-[12px] font-semibold pressable tabular-nums transition-[box-shadow,background-color,color] duration-150";

            return (
              <>
                {/* Header */}
                <div className="shrink-0 px-5 pt-6 pb-3 flex items-start gap-3">
                  <div className="h-10 w-10 rounded-[12px] flex items-center justify-center bg-primary/12 border border-primary/22 shrink-0">
                    <Bell className="h-[18px] w-[18px] text-primary" strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="font-display text-[19px] font-semibold tracking-tight leading-tight">Reminders</div>
                    <div className="text-[12px] text-secondary-fg/75 mt-0.5 truncate">
                      {b.title} · {fmtTime(b.start_time)} · {fmtDuration(b.duration_min)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setReminderBlockId(null); setReminderAdvancedOpen(false); }}
                    className="h-8 w-8 rounded-full flex items-center justify-center text-secondary-fg/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors pressable shrink-0 text-[18px]"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto px-5 pt-1 pb-2 space-y-5">
                  {/* Primary toggle */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => saveReminders({ ...reminderCfg, enabled: !reminderCfg.enabled })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        saveReminders({ ...reminderCfg, enabled: !reminderCfg.enabled });
                      }
                    }}
                    className="w-full flex items-center justify-between gap-4 rounded-2xl px-4 py-3.5 pressable cursor-pointer transition-[box-shadow,background-color] duration-200"
                    style={
                      reminderCfg.enabled
                        ? {
                            background: "linear-gradient(180deg, hsl(var(--primary)/0.16) 0%, hsl(var(--primary)/0.05) 100%)",
                            boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.08), 0 0 0 1.5px hsl(var(--primary)/0.4), 0 8px 24px -12px hsl(var(--primary)/0.4)",
                          }
                        : {
                            background: "linear-gradient(180deg, hsl(var(--card)/0.5) 0%, hsl(var(--card)/0.3) 100%)",
                            boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.04), 0 0 0 1px hsl(var(--border)/0.4)",
                          }
                    }
                  >
                    <div className="text-left min-w-0">
                      <div className={`text-[14.5px] font-semibold ${reminderCfg.enabled ? "text-foreground" : "text-foreground/85"}`}>Remind me</div>
                      <div className="text-[12px] text-secondary-fg/75 mt-0.5 leading-snug">
                        {reminderCfg.enabled ? "Alerts fire while the app is open" : "No reminders for this task"}
                      </div>
                    </div>
                    <Switch
                      checked={reminderCfg.enabled}
                      onCheckedChange={(v) => saveReminders({ ...reminderCfg, enabled: v })}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Toggle reminders"
                      className="shrink-0"
                    />
                  </div>

                  <div className={reminderCfg.enabled ? "space-y-5" : "opacity-40 pointer-events-none space-y-5"}>
                    {/* Primary alert */}
                    <section>
                      <div className="flex items-baseline justify-between mb-2.5 px-0.5">
                        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80">Alert</span>
                        <span className="text-[11px] text-secondary-fg/75 tabular-nums">
                          {primary === 0 ? "at start" : `${primary} min before`}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {PRIMARY_OPTIONS.map((n) => {
                          const on = primary === n;
                          return (
                            <motion.button
                              key={n}
                              type="button"
                              onClick={() => setAlerts(n, secondary && secondary !== n ? secondary : null)}
                              whileTap={{ scale: 0.94 }}
                              transition={{ type: "spring", stiffness: 500, damping: 24 }}
                              style={on ? chipStyleOn : chipStyleOff}
                              className={`${chipBase} ${on ? chipOn : chipOff}`}
                            >
                              {n === 0 ? "At start" : `${n} min`}
                            </motion.button>
                          );
                        })}
                      </div>
                    </section>

                    {/* Second alert */}
                    <section>
                      <div className="flex items-baseline justify-between mb-2.5 px-0.5">
                        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80">
                          Second alert <span className="font-normal normal-case tracking-normal text-secondary-fg/55">· optional</span>
                        </span>
                        {secondary != null && (
                          <button
                            type="button"
                            onClick={() => setAlerts(primary, null)}
                            className="text-[11px] font-medium text-primary pressable"
                          >Remove</button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <motion.button
                          type="button"
                          onClick={() => setAlerts(primary, null)}
                          whileTap={{ scale: 0.94 }}
                          transition={{ type: "spring", stiffness: 500, damping: 24 }}
                          style={secondary == null ? chipStyleOn : chipStyleOff}
                          className={`${chipBase} ${secondary == null ? chipOn : chipOff}`}
                        >None</motion.button>
                        {SECONDARY_OPTIONS.filter((n) => n !== primary).map((n) => {
                          const on = secondary === n;
                          return (
                            <motion.button
                              key={n}
                              type="button"
                              onClick={() => setAlerts(primary, n)}
                              whileTap={{ scale: 0.94 }}
                              transition={{ type: "spring", stiffness: 500, damping: 24 }}
                              style={on ? chipStyleOn : chipStyleOff}
                              className={`${chipBase} ${on ? chipOn : chipOff}`}
                            >
                              {n === 0 ? "At start" : `${n} min`}
                            </motion.button>
                          );
                        })}
                      </div>
                    </section>

                    {/* Advanced — animated reveal */}
                    <div
                      className="rounded-2xl overflow-hidden"
                      style={{
                        background: "linear-gradient(180deg, hsl(var(--card)/0.5) 0%, hsl(var(--card)/0.3) 100%)",
                        boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.04), 0 0 0 1px hsl(var(--border)/0.4)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => { haptics.selection(); setReminderAdvancedOpen((v) => !v); }}
                        className="w-full flex items-center justify-between px-4 py-3.5 pressable text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-semibold text-foreground/90">Advanced</div>
                          <div className="text-[11.5px] text-secondary-fg/70 mt-0.5 leading-snug truncate">
                            {reminderCfg.endAlertLeadMin > 0 ? `End ping ${reminderCfg.endAlertLeadMin}m before` : "End ping off"} · {reminderCfg.endFollowUp ? "follow-up on" : "follow-up off"}
                          </div>
                        </div>
                        <motion.span
                          animate={{ rotate: reminderAdvancedOpen ? 90 : 0 }}
                          transition={{ type: "spring", stiffness: 380, damping: 28 }}
                          className="text-secondary-fg/70 text-[14px] shrink-0 ml-2 inline-block"
                        >
                          ›
                        </motion.span>
                      </button>
                      <AnimatePresence initial={false}>
                        {reminderAdvancedOpen && (
                          <motion.div
                            key="advanced-body"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 pt-2 space-y-4 border-t border-border/30">
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80 mb-2.5 px-0.5">Before it ends</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {[0, 2, 5, 10, 15, 30].map((n) => {
                                    const on = (reminderCfg.endAlertLeadMin ?? 0) === n;
                                    return (
                                      <motion.button
                                        key={n}
                                        type="button"
                                        onClick={() => saveReminders({ ...reminderCfg, endAlertLeadMin: n })}
                                        whileTap={{ scale: 0.94 }}
                                        transition={{ type: "spring", stiffness: 500, damping: 24 }}
                                        style={on ? chipStyleOn : chipStyleOff}
                                        className={`${smallChipBase} ${on ? chipOn : chipOff}`}
                                      >{n === 0 ? "At end" : `${n} min`}</motion.button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80 mb-2.5 px-0.5">Repeat after start</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {REPEAT_OPTIONS.map((n) => {
                                    const on = reminderCfg.repeats === n;
                                    return (
                                      <motion.button
                                        key={n}
                                        type="button"
                                        onClick={() => saveReminders({ ...reminderCfg, repeats: n })}
                                        whileTap={{ scale: 0.94 }}
                                        transition={{ type: "spring", stiffness: 500, damping: 24 }}
                                        style={on ? chipStyleOn : chipStyleOff}
                                        className={`${smallChipBase} ${on ? chipOn : chipOff}`}
                                      >{n === 0 ? "Don't repeat" : `${n}×`}</motion.button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-1">
                                <div>
                                  <p className="text-[13px] font-semibold text-foreground/80">Ask me afterward</p>
                                  <p className="text-[11px] text-foreground/45 mt-0.5">"How did it go?" when the slot ends</p>
                                </div>
                                <Switch
                                  checked={reminderCfg.endFollowUp ?? false}
                                  onCheckedChange={(v) => saveReminders({ ...reminderCfg, endFollowUp: v })}
                                />
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  <p className="text-[11px] text-secondary-fg/60 leading-relaxed text-center pt-1">
                    Alerts fire on your device even when DayDraft is closed · Saved on this device
                  </p>
                </div>

                <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
      <AskAiSheet open={askAiOpen} onOpenChange={setAskAiOpen} seedContext={askAiContext} taskTitle={askAiTaskTitle} />
      <LateCompleteSheet
        open={!!lateCompleteBlock}
        onOpenChange={(v) => { if (!v) setLateCompleteBlock(null); }}
        taskTitle={lateCompleteBlock?.title ?? ""}
        resolution={(lateCompleteBlock?.resolution as "missed" | "skipped") ?? "missed"}
        onConfirm={() => { if (lateCompleteBlock) completeBlock(lateCompleteBlock.id); }}
        onReturn={() => {
          // Don't auto-drop it back at "now". Hand off to the time/duration
          // picker (the same "Return to timeline?" sheet used when un-completing
          // a done task) so the user chooses when to reschedule it.
          if (lateCompleteBlock) setUncompleteTarget(lateCompleteBlock as Block);
        }}
      />

      <DayPickerSheet
        open={!!dayPickerIntent}
        onOpenChange={(v) => { if (!v) setDayPickerIntent(null); }}
        value={
          dayPickerIntent?.kind === "navigate"
            ? viewDate
            : // Move/carry: no day is pre-selected so any tap (including tomorrow)
              // actually fires onPick. Previously tomorrowDate here caused the sheet
              // to silently close when the user tapped tomorrow (ymd===value bail).
              ""
        }
        onPick={(d) => void handleDayPickerPick(d)}
        title={
          dayPickerIntent?.kind === "move-task"
            ? "Move task to…"
            : dayPickerIntent?.kind === "carry-missed"
              ? "Carry unfinished to…"
              : "Pick a day"
        }
        subtitle={
          dayPickerIntent?.kind === "move-task"
            ? "We'll put it at the end of that day's plan."
            : dayPickerIntent?.kind === "carry-missed"
              ? `${movableTasks.length} task${movableTasks.length === 1 ? "" : "s"} will be added there and marked moved here.`
              : undefined
        }
        pastDays={dayPickerIntent?.kind === "navigate" ? 7 : 0}
        futureDays={28}
      />

      {/* Category picker — opens when user taps "Track" on a row.
          Note: picking a category *earmarks* it for this block; the timer
          only starts later, when the user opens Focus on this task. */}
      <Sheet open={!!trackPickerBlock} onOpenChange={(v) => { if (!v) { setTrackPickerBlock(null); setNewCatName(""); } }}>
        <SheetContent
          side="bottom"
          // p-0 overrides the SheetContent default p-6 — without it the sheet
          // has 24px padding AND the sticky header adds its own px-6 pt-5,
          // producing ~44px of double top-padding.
          className="rounded-t-[28px] border-border/45 bg-popover max-h-[85vh] flex flex-col p-0"
          style={{ paddingBottom: "var(--keyboard-inset, 0px)" }}
          hideClose
        >
          {/* Sticky header keeps the title + close always visible even when
              there are many categories and the user has scrolled down. */}
          <div className="shrink-0 sticky top-0 z-10 bg-popover px-5 pt-4 pb-3 flex items-center justify-between gap-2 border-b border-border/30">
            <SheetTitle className="flex items-center gap-2 text-[16px]">
              <Play className="h-4 w-4 text-primary" fill="currentColor" /> Tracker category
            </SheetTitle>
            <button
              type="button"
              onClick={() => { setTrackPickerBlock(null); setNewCatName(""); }}
              className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-secondary-fg/60 hover:text-foreground hover:bg-foreground/[0.06] pressable transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pt-4" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)" }}>
          {trackPickerBlock && (
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-[14px] font-medium text-foreground leading-tight">{trackPickerBlock.title}</div>
                <div className="text-[12px] text-secondary-fg mt-1">
                  Pick a category. Time only starts counting when you open Focus on this task.
                </div>
              </div>

              {(() => {
                const currentAssigned = getAssignedCategoryId(trackPickerBlock.id);
                if (!currentAssigned) return null;
                return (
                  <div className="flex items-center justify-between rounded-[12px] border border-soft bg-card/60 px-3 py-2 text-[12px]">
                    <span className="text-secondary-fg">
                      Currently set: <span className="text-foreground font-medium">
                        {tracker.categories.find((c) => c.id === currentAssigned)?.name || "(missing)"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        clearAssignedCategoryId(trackPickerBlock.id);
                        setAssignedCatTick((n) => n + 1);
                        haptics.selection();
                        setTrackPickerBlock(null);
                        toast("Category cleared");
                      }}
                      className="text-destructive font-medium pressable"
                    >
                      Clear
                    </button>
                  </div>
                );
              })()}

              {tracker.categories.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {tracker.categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => assignCategoryToBlock(c.id, trackPickerBlock)}
                      className="flex items-center gap-2.5 rounded-2xl border border-soft surface-card px-3 py-3 pressable hover:border-primary/40 transition-colors text-left"
                    >
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ background: c.color }}
                        aria-hidden
                      />
                      <span className="text-[13px] font-medium text-foreground truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-secondary-fg">
                  No categories yet — create one below.
                </p>
              )}

              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-secondary-fg/85 font-medium mb-1.5">
                  New category
                </div>
                <form 
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleAddCategoryAndAssign();
                  }}
                >
                  <input
                    type="text"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void handleAddCategoryAndAssign(); }
                    }}
                    placeholder="e.g. Deep work, Client A, Chores"
                    className="flex-1 h-11 rounded-xl border border-soft bg-background/40 px-3 text-[14px] text-foreground placeholder:text-secondary-fg/55 focus:outline-none focus:border-primary/45 focus:ring-2 focus:ring-primary/15"
                  />
                  <Button
                    type="button"
                    onClick={() => void handleAddCategoryAndAssign()}
                    disabled={!newCatName.trim() || addingCategory}
                    className="h-11 rounded-xl bg-primary hover:bg-primary/92 text-primary-foreground text-[13px] font-semibold px-4 pressable"
                  >
                    Add
                  </Button>
                </form>
              </div>
            </div>
          )}
          </div>
        </SheetContent>
      </Sheet>

      <DurationPicker
        open={!!durationEditId}
        onClose={() => setDurationEditId(null)}
        value={blocks.find(b => b.id === durationEditId)?.duration_min || 30}
        onChange={async (v) => {
          if (planMutating) return;
          const id = durationEditId;
          if (!id) return;
          const idx = blocks.findIndex(b => b.id === id);
          if (idx < 0) return;
          const snapshot = blocks;

          // Only the edited block changes length. It is the anchor (keeps its
          // exact start_time); calendar events and resolved (done/skipped/missed)
          // tasks are also anchored so their slots NEVER move. Only later OPEN
          // tasks slide forward, and only as far as needed to clear the new
          // length (normalizeSchedule = minimal movement).
          const updated = blocks.map((b) => (b.id === id ? { ...b, duration_min: v } : b));
          const lockedIds = new Set(
            updated
              .filter((b) => !!b.is_calendar_event || (b.kind === "task" && !isOpenUserTask(b as Block)))
              .map((b) => b.id),
          );
          const normalized = normalizeSchedule(updated, new Set([id, ...lockedIds]));
          // Fallback (cross-midnight / non-monotonic): keep every start_time as-is.
          const next = activeFirstOrder(normalized ?? updated);

          setBlocks(next);
          setPlanMutating(true);
          try {
            await persistOrder(next);
            void invalidatePlanCaches();
            if (isToday) void syncBlockNotifications(viewDate, next);
          } catch (e) {
            setBlocks(snapshot);
            toast.error(e?.message || "Couldn't update duration");
          } finally {
            setPlanMutating(false);
          }
        }}
        title="Duration"
      />

      <DurationPicker
        open={bulkDurationEditIndex !== null}
        onClose={() => setBulkDurationEditIndex(null)}
        value={bulkDurationEditIndex !== null ? bulkRows[bulkDurationEditIndex]?.duration || 30 : 30}
        onChange={(minutes) => {
          const index = bulkDurationEditIndex;
          if (index === null) return;
          setBulkRows((rows) => {
            const updated = rows.map((row, i) => i === index ? { ...row, duration: minutes } : row);
            // If all durations are now set, clear the red-highlight state
            if (updated.every(r => r.duration != null)) setHighlightMissingDuration(false);
            return updated;
          });
          setPreFetchedQuestions(null);
        }}
        title="Task duration"
      />



      {/* Hidden native time input — starts as text to avoid iOS variant selector bug on focus,
          then dynamically becomes time when clicked. Placed globally to avoid constraints layout bugs
          when inside dnd-kit transform blocks. */}
      <input
        ref={startTimeInputRef}
        type="text"
        className="fixed bottom-0 left-1/2 w-4 h-4 opacity-0 pointer-events-none z-50"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          commitStartTime(e.target.value);
        }}
        onBlur={(e) => {
          // Revert to text when focus is lost
          if (startTimeInputRef.current) startTimeInputRef.current.type = "text";
        }}
      />

      {uncompleteTarget && (
        <UncompleteTaskSheet
          block={uncompleteTarget}
          onConfirm={(action, newStart, newDur) => {
            setUncompleteTarget(null);
            void uncompleteTaskAction(uncompleteTarget, action, newStart, newDur);
          }}
          onCancel={() => setUncompleteTarget(null)}
        />
      )}
    </>
  );
}

// Segmented switcher between the timed plan and the untimed checklist. The
// sliding pill is filled with the *active mode's own colour* (Timeline=primary,
// Checklist=accent) so the colour itself signals which mode you're in.
const PlanModePill = ({ mode, onChange, openCount }: { mode: "timeline" | "checklist"; onChange: (m: "timeline" | "checklist") => void; openCount: number }) => (
  <div className="mt-3 relative h-11 rounded-2xl bg-muted/40 border border-soft p-1 select-none">
    <motion.div
      className="absolute top-1 bottom-1 left-1 rounded-xl shadow-sm"
      style={{
        width: "calc(50% - 4px)",
        background: mode === "checklist" ? "hsl(var(--checklist-accent))" : "hsl(var(--primary))",
      }}
      animate={{ x: mode === "timeline" ? "0%" : "100%" }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    />
    <div className="relative grid grid-cols-2 h-full">
      <button
        type="button"
        onClick={() => { haptics.selection(); onChange("timeline"); }}
        className={`relative z-10 flex items-center justify-center gap-1.5 text-[13px] font-semibold rounded-xl transition-colors ${mode === "timeline" ? "text-primary-foreground" : "text-secondary-fg/70"}`}
      >
        <Clock className="h-4 w-4" /> Timeline
      </button>
      <button
        type="button"
        data-tour="checklist-pill"
        onClick={() => { haptics.selection(); onChange("checklist"); }}
        className={`relative z-10 flex items-center justify-center gap-1.5 text-[13px] font-semibold rounded-xl transition-colors ${mode === "checklist" ? "text-white" : "text-secondary-fg/70"}`}
      >
        <ListChecks className="h-4 w-4" /> Checklist
        {openCount > 0 && (
          <span className={`ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums ${mode === "checklist" ? "bg-white/20 text-white" : "bg-[hsl(var(--checklist-accent)/0.15)] text-[hsl(var(--checklist-accent))]"}`}>
            {openCount}
          </span>
        )}
      </button>
    </div>
  </div>
);

const ActionRow = ({ onClick, icon, label, destructive, children }: { onClick?: () => void; icon?: React.ReactNode; label: string; destructive?: boolean; children?: React.ReactNode }) => (
  <div className="relative">
    <button
      onClick={onClick}
      // When an overlay child (e.g. <input type="time">) covers this row, the
      // button must NOT intercept taps — iOS WebKit otherwise swallows the tap
      // before the native time-picker can open. pointer-events:none lets the
      // absolutely-positioned input receive the touch directly.
      style={children ? { pointerEvents: "none" } : undefined}
      className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-xl pressable transition-colors text-[14px] ${destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted/40"}`}
    >
      {icon && <span className={`shrink-0 ${destructive ? "text-destructive/80" : "text-secondary-fg"}`}>{icon}</span>}
      <span className="flex-1 text-left">{label}</span>
    </button>
    {children}
  </div>
);
