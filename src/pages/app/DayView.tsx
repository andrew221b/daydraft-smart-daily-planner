import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { trackAiEvent } from "@/lib/aiRuntime";
import { syncBlockNotifications } from "@/lib/localNotifications";
import { enqueueWrite } from "@/lib/idbCache";
import { invokeAiCached } from "@/lib/aiCache";
import { useAbortOnUnmount } from "@/hooks/useAbortOnUnmount";
import {
  Block, fmtTime, todayDateStr, parseDateStr, friendlyDateFor, isFutureDateStr, isUserTask, isOpenUserTask, isUserTaskDone, inferScheduleBlockType, packLinearSchedule,
  blockSlotEndHHMM, timeToMinutes, minutesToHHMM,
} from "@/lib/daydraft";
import { ChevronLeft, ChevronRight, Play, CalendarDays, Trash2, Bell, BellOff, MoreHorizontal, Clock, Timer, MapPin, Copy, Sparkles, ListPlus, Wand2, ArrowRightCircle, Loader2, Bookmark, X } from "lucide-react";
import { DayPickerSheet } from "@/components/app/DayPickerSheet";
import { Button } from "@/components/ui/button";
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay } from "@dnd-kit/core";
import { motion, AnimatePresence } from "framer-motion";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
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
import { useTour, TOUR_DAYVIEW } from "@/components/app/Tour";
import { haptics } from "@/lib/haptics";
import { SkeletonBlock } from "@/components/app/SkeletonBlock";
import { scheduleBlockReminders, ensureNotificationPermission, clearScheduledReminders, getReminderConfig, setReminderConfig, ReminderConfig } from "@/lib/blockReminders";
import { DurationPicker } from "@/components/app/DurationPicker";
import { mapsUrl } from "@/lib/maps";
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
import { setDndBodyScrollLock } from "@/lib/dndScrollLock";
import { AskAiSheet } from "@/components/app/AskAiSheet";
import { Textarea } from "@/components/ui/textarea";
import { parseBulkTasks, extractDurationFromTitle } from "@/lib/taskSplitter";
import { useTimeTracker } from "@/hooks/useTimeTracker";
import { useTabVisible } from "@/components/app/PersistentTabs";

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
};

export default function DayView() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const nav = useNavigate();
  const tour = useTour();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const rawDate = searchParams.get("date");
  const viewDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayDateStr();
  const isFuture = isFutureDateStr(viewDate);
  const isToday = viewDate === todayDateStr();
  const [blocks, setBlocks] = useState<ExBlock[]>([]);
  const [now, setNow] = useState(new Date());
  const [replanning, setReplanning] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState("");
  const [bulkRows, setBulkRows] = useState<{ title: string; duration: number; start_time?: string }[]>([]);
  const [bulkStep, setBulkStep] = useState<"input" | "review">("input");
  const [bulkDurationEditIndex, setBulkDurationEditIndex] = useState<number | null>(null);
  const [bulkStartTimeEditIndex, setBulkStartTimeEditIndex] = useState<number | null>(null);
  const [bulkStartTimeDraft, setBulkStartTimeDraft] = useState<string>("09:00");
  const [bulkAiLoading, setBulkAiLoading] = useState(false);
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tappedBlock, setTappedBlock] = useState<ExBlock | null>(null);
  const [reminderBlockId, setReminderBlockId] = useState<string | null>(null);
  const [reminderCfg, setReminderCfg] = useState<ReminderConfig>({
    enabled: true,
    leadsMin: [2],
    repeats: 0,
    endLeadsMin: [2],
    endAlertLeadMin: 5,
    endAlertRepeat: 0,
  });
  const [durationEditId, setDurationEditId] = useState<string | null>(null);
  const [startTimeEditId, setStartTimeEditId] = useState<string | null>(null);
  const [startTimeDraft, setStartTimeDraft] = useState<string>("09:00");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [planMutating, setPlanMutating] = useState(false);
  const [askAiOpen, setAskAiOpen] = useState(false);
  const [askAiContext, setAskAiContext] = useState<string | null>(null);
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
    | { kind: "move-task"; blockId: string };
  const [dayPickerIntent, setDayPickerIntent] = useState<DayPickerIntent | null>(null);

  useEffect(() => {
    if (searchParams.get("composer") === "1") setComposerOpen(true);
  }, [searchParams]);

  const shiftDate = (ymd: string, days: number) => {
    const d = parseDateStr(ymd);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const tomorrowDate = shiftDate(viewDate, 1);
  const yesterdayDate = shiftDate(viewDate, -1);
  const navigateToDay = (ymd: string) => {
    if (ymd === todayDateStr()) nav("/today");
    else nav(`/today?date=${ymd}`);
  };

  const dayTabVisible = useTabVisible();

  const { data: dayData, isLoading: loading, refetch } = useQuery({
    queryKey: planDayQueryKey(user?.id ?? "", viewDate),
    queryFn: () => fetchDayPlan(user!.id, viewDate),
    enabled: !!user?.id && dayTabVisible,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const plan = dayData?.plan ?? null;
  const planMissing = !loading && !plan;

  useEffect(() => {
    setBlocks((dayData?.blocks || []) as ExBlock[]);
    
    // Only schedule local notifications for today's plan
    if (viewDate === todayDateStr() && dayData?.blocks) {
      syncBlockNotifications(viewDate, dayData.blocks);
    }
  }, [dayData?.plan?.id, dayData?.blocks]);

  const openReminders = (id: string) => {
    setReminderCfg(getReminderConfig(id));
    setReminderBlockId(id);
    setTappedBlock(null);
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
      ensureNotificationPermission().then((ok) => {
        if (ok) scheduleBlockReminders(blocks as any, { planDate: viewDate });
      });
    }
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // tolerance: 12 (was 8) — gives finger micro-jitter during the 250ms
    // long-press window more headroom, so a steady press doesn't get
    // cancelled by sub-pixel drift before it activates.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 12 } })
  );

  useEffect(() => {
    if (blocks.length === 0) return;
    const t = setTimeout(() => tour.start(TOUR_DAYVIEW), 500);
    return () => clearTimeout(t);
  }, [blocks.length > 0]);

  // `now` only drives the "is this block currently running?" highlight on
  // the timeline — there's no point ticking it while DayView's tab isn't
  // visible. PersistentTabs keeps the tree alive, but the interval can
  // sleep until the user comes back.
  useEffect(() => {
    if (!dayTabVisible) return;
    setNow(new Date()); // re-sync on return so the highlight is fresh
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, [dayTabVisible]);

  const [showAllDone, setShowAllDone] = useState(false);
  const prevIsAllDoneRef = useRef<boolean | null>(null);
  
  useEffect(() => {
    const totalTasks = blocks.filter(isUserTask).length;
    const firstUnfinishedTask = blocks.find((b) => isUserTask(b) && isOpenUserTask(b));
    const isAllDone = !planMissing && !isFuture && !firstUnfinishedTask && totalTasks > 0;
    
    // Only trigger the animation if we transition from NOT all done to ALL done.
    if (prevIsAllDoneRef.current === false && isAllDone && dayTabVisible) {
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
  }, [dayTabVisible, blocks, planMissing, isFuture, showAllDone]);

  // Drop localStorage tracker-category records for blocks that no longer
  // exist (deleted from a different device, plan reset, etc).
  useEffect(() => {
    if (!blocks.length) return;
    pruneAssignedCategories(blocks.map((b) => b.id));
  }, [blocks.length]);

  const copyDayOutline = async () => {
    if (!blocks.length) return;
    const headline = plan?.ai_summary || `Plan · ${friendlyDateFor(parseDateStr(viewDate))}`;
    const text = formatPlanAsPlainText({ headline, blocks: blocks as any });
    const ok = await copyTextToClipboard(text);
    if (ok) toast.success("Copied outline");
    else toast.error("Could not copy");
  };

  useEffect(() => {
    if (!isToday || blocks.length === 0) return;
    let cancelled = false;
    (async () => {
      const ok = await ensureNotificationPermission();
      if (cancelled || !ok) return;
      scheduleBlockReminders(blocks as any, { planDate: viewDate });
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
        .order("created_at" as any, { ascending: false });
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
      } as any);
      await queryClient.invalidateQueries({ queryKey: ["block-templates", user.id] });
      haptics.notify("success");
      toast.success("Saved as template");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save template");
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!user) return;
    try {
      await supabase.from("block_templates").delete().eq("id", id);
      await queryClient.invalidateQueries({ queryKey: ["block-templates", user.id] });
      toast.success("Template removed");
    } catch (e: any) {
      toast.error(e?.message || "Couldn't remove template");
    }
  };

  useEffect(() => {
    if (!user?.id || !viewDate || blocks.length === 0 || isFuture) return;
    let cancelled = false;
    (async () => {
      const changed = await applyAutoMissedBlocks(supabase, viewDate, blocks as Block[]);
      if (!cancelled && changed) void invalidatePlanCaches();
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, viewDate, blocks, isFuture]);

  const removeBlock = async (id: string) => {
    if (blockOpLocksRef.current.has(`remove:${id}`)) return;
    blockOpLocksRef.current.add(`remove:${id}`);
    const snapshot = blocks;
    const removed = snapshot.find(b => b.id === id);
    if (!removed) {
      blockOpLocksRef.current.delete(`remove:${id}`);
      return;
    }
    const next = packLinearSchedule(blocks.filter(x => x.id !== id));
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
            } as any);
            await persistOrder(snapshot);
            void invalidatePlanCaches();
          },
        },
      });
    } catch (e: any) {
      setBlocks(snapshot);
      toast.error(e?.message || "Unable to remove block");
    } finally {
      blockOpLocksRef.current.delete(`remove:${id}`);
    }
  };

  const completeBlock = async (id: string) => {
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
    const userTasks = snapshot.filter(isUserTask);
    const doneBefore = userTasks.filter((b) => isUserTaskDone(b)).length;
    const firstUserTaskDoneToday =
      isToday && isUserTask(toggled) && !wasDone && doneBefore === 0;

    const completedAtIso = new Date().toISOString();
    const completedAtMs = Date.now();
    let resolvedActual: number | null = null;
    if (!wasDone) {
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
    } catch (e: any) {
      setBlocks(snapshot);
      toast.error(e?.message || "Unable to update task");
    } finally {
      blockOpLocksRef.current.delete(`complete:${id}`);
    }
  };


  const ensurePlanId = async () => {
    if (!user) return null;
    if (plan?.id) return plan.id;
    const { data: created, error } = await supabase
      .from("plans")
      .insert({ user_id: user.id, date: viewDate, raw_input: bulkInput || "" } as any)
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

  const prepareBulkRows = async () => {
    const titles = parseBulkTasks(bulkInput);
    if (!titles.length) {
      toast.error("Write at least one task");
      return;
    }
    // Pull "5 hours" / "30 min" / "1h 15m" out of each title up-front so the
    // review sheet shows the real duration the user typed instead of a flat
    // 30m default they have to re-edit by hand.
    const rows = titles.map((rawTitle) => {
      const { title, duration } = extractDurationFromTitle(rawTitle);
      return { title: title || rawTitle, duration: duration ?? 30 };
    });
    setBulkRows(rows);
    setBulkStep("review");
  };

  const addBulkRows = async (rows: { title: string; duration: number; start_time?: string }[]) => {
    if (planMutating || !user) return;
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
      const planId = await ensurePlanId();
      if (!planId) return;
      const startPos = blocks.length;
      // Start packing from current time (today) or 09:00 (future days).
      const todayStr = todayDateStr();
      const startHHMM = viewDate === todayStr
        ? `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`
        : "09:00";
      const draftBlocks: ExBlock[] = clean.map((task, i) => {
        const id = crypto.randomUUID();
        const duration = Math.max(5, task.duration || 30);
        return {
          id,
          plan_id: planId,
          user_id: user.id,
          start_time: task.start_time || startHHMM,
          duration_min: duration,
          estimated_minutes: duration,
          actual_minutes: null,
          title: task.title.trim(),
          type: "deep_work",
          kind: "task",
          block_type: inferScheduleBlockType({ kind: "task", title: task.title }),
          completed: false,
          position: startPos + i,
        };
      });
      const packed = packLinearSchedule([...blocks, ...draftBlocks]);
      setBlocks(packed);
      setComposerOpen(false);
      setBulkInput("");
      setBulkRows([]);
      setBulkStep("input");
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
        }));
      const { error: insertErr } = await supabase.from("blocks").insert(toInsert as any);
      if (insertErr) {
        if (!navigator.onLine || insertErr.message?.toLowerCase().includes("fetch")) {
          for (const b of toInsert) {
            await enqueueWrite({ table: "blocks", op: "insert", payload: b });
          }
        } else {
          throw insertErr;
        }
      }
      await persistOrder(packed);
      void invalidatePlanCaches();
      await refetch();
      // First task on a brand-new day burns a trial slot — refresh the counter.
      if (wouldStartNewDay) void refreshEntitlement();
      toast.success(`Added ${clean.length} task${clean.length === 1 ? "" : "s"}`);
    } catch (e: any) {
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
    const { error: upErr } = await supabase.from("blocks").upsert(payload as any);
    if (upErr) {
      if (!navigator.onLine || upErr.message?.toLowerCase().includes("fetch")) {
        await enqueueWrite({ table: "blocks", op: "upsert", payload });
      } else {
        throw upErr;
      }
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
    const { active, over } = e;
    // Soft "settle" tap on drop, regardless of whether the position changed.
    haptics.impact("light");
    if (!over || active.id === over.id) return;
    const oldIdx = blocks.findIndex(b => b.id === active.id);
    const newIdx = blocks.findIndex(b => b.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const moved = arrayMove(blocks, oldIdx, newIdx);
    if (newIdx === 0 && blocks.length > 0) {
      moved[0] = { ...moved[0], start_time: blocks[0].start_time };
    }
    const reordered = packLinearSchedule(moved);
    const snapshot = blocks;
    setBlocks(reordered);
    void persistOrder(reordered)
      .then(() => invalidatePlanCaches())
      .catch((e: any) => {
        setBlocks(snapshot);
        toast.error(e?.message || "Unable to reorder blocks");
        void invalidatePlanCaches();
      });
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
      const { data, error } = await invokeAiCached<any>(
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
          active_hours_start: (profile as any)?.active_hours_start || "09:00",
          active_hours_end: (profile as any)?.active_hours_end || "22:00",
          ai_tone: (profile as any)?.ai_tone || "professional",
          ai_tone_custom: (profile as any)?.ai_tone_custom || null,
          ai_planning_rules: (profile as any)?.ai_planning_rules || "",
        },
        { ttlMs: 0, timeoutMs: 60_000, signal },
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
      const newBlocks = (data.blocks || []).map((b: any, i: number) => ({
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
      toast.success("Re-planned");
    } catch (e: any) {
      if (signal.aborted) return;
      toast.error(e.message || "Unable to re-plan remaining tasks");
    } finally {
      if (!signal.aborted) {
        setReplanning(false);
        setPlanMutating(false);
      }
    }
  };

  const autoScheduleBulkRows = async () => {
    if (bulkRows.length === 0 || !user || bulkAiLoading) return;
    setBulkAiLoading(true);
    const signal = getAiAbortSignal();
    try {
      const nowHM = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      const startHHMM = viewDate === todayDateStr() ? nowHM : "09:00";
      const tz = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { data, error } = await invokeAiCached<any>(
        "generate-plan",
        {
          raw_input: bulkRows.map(r => r.title).join("\n"),
          energy_preference: profile?.energy_preference || "morning",
          name: profile?.display_name,
          mode: "plan",
          start_time: startHHMM,
          plan_date: viewDate,
          now_iso: new Date().toISOString(),
          timezone: tz,
          active_hours_start: (profile as any)?.active_hours_start || "09:00",
          active_hours_end: (profile as any)?.active_hours_end || "22:00",
          ai_tone: (profile as any)?.ai_tone || "professional",
          ai_tone_custom: (profile as any)?.ai_tone_custom || null,
          ai_planning_rules: (profile as any)?.ai_planning_rules || "",
        },
        { ttlMs: 0, timeoutMs: 60_000, signal },
      );
      if (signal.aborted) return;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.blocks && Array.isArray(data.blocks)) {
        const scheduled = data.blocks;
        const newRows = bulkRows.map((row, i) => {
          const aiBlock = scheduled[i];
          if (aiBlock) {
            return {
              title: aiBlock.title || row.title,
              duration: aiBlock.duration_min || row.duration,
              start_time: aiBlock.start_time,
            };
          }
          return row;
        });
        setBulkRows(newRows);
        haptics.notify("success");
      }
    } catch (e: any) {
      if (signal.aborted) return;
      toast.error(e.message || "Failed to auto-schedule tasks");
    } finally {
      if (!signal.aborted) setBulkAiLoading(false);
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
      .insert({ user_id: user.id, date, raw_input: "" } as any)
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
    }));
    const { error: insertErr } = await supabase.from("blocks").insert(toInsert as any);
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
      try {
        const result = await moveBlocksToDate([blk], targetDate);
        if (!result) return;
        void invalidatePlanCaches();
        await refetch();
        haptics.notify("success");
        toast.success(`Moved to ${friendlyDateFor(parseDateStr(targetDate))}`, {
          action: { label: "Open", onClick: () => navigateToDay(targetDate) },
        });
      } catch (e: any) {
        toast.error(e?.message || "Couldn't move that task");
      }
      return;
    }
    if (intent.kind === "carry-missed") {
      // Carry everything the user hasn't actually finished: still-open,
      // explicitly missed, AND skipped tasks. Only done tasks are excluded —
      // there's no point moving something the user already completed.
      const candidates = blocks.filter(
        (b) => isUserTask(b) && !isUserTaskDone(b),
      );
      if (!candidates.length) {
        toast("Nothing left to carry forward");
        return;
      }
      try {
        const result = await moveBlocksToDate(candidates, targetDate);
        if (!result) return;
        void invalidatePlanCaches();
        await refetch();
        setMoreOpen(false);
        haptics.notify("success");
        toast.success(
          `Moved ${result.moved} task${result.moved === 1 ? "" : "s"} to ${friendlyDateFor(parseDateStr(targetDate))}`,
          { action: { label: "Open", onClick: () => navigateToDay(targetDate) } },
        );
      } catch (e: any) {
        toast.error(e?.message || "Unable to carry tasks forward");
      }
    }
  };


  const firstUnfinishedTask = blocks.find((b) => isUserTask(b) && isOpenUserTask(b));
  const userTasks = blocks.filter(isUserTask);
  const totalTasks = userTasks.length;
  const doneTasks = userTasks.filter((b) => isUserTaskDone(b)).length;
  const missedTasks = useMemo(
    () =>
      blocks.filter(
        (b) =>
          isUserTask(b) && !b.is_calendar_event && (b as ExBlock).resolution === "missed",
      ),
    [blocks],
  );
  const isPast = !isToday && !isFuture;

  const spotlightId = useMemo(
    () => blocks.find((b) => isUserTask(b) && isOpenUserTask(b) && !b.is_calendar_event)?.id,
    [blocks],
  );

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
        <div className="app-card px-2 py-2.5 flex items-center gap-1">
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
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-secondary-fg/65">
              {isToday ? "Timeline" : isPast ? "Past" : "Plan"}
            </p>
            <h1 className="font-display text-[22px] font-medium tracking-[-0.02em] text-foreground/95 text-center truncate w-full mt-1 leading-tight">
              {isToday ? "Today" : friendlyDateFor(parseDateStr(viewDate))}
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
          {!planMissing && (
            <button
              onClick={() => setMoreOpen(true)}
              className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-secondary-fg/90 pressable"
              aria-label="More"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Progress bar */}
        {!planMissing && totalTasks > 0 && (
          <div className="mt-4 shrink-0">
            <div className="app-card px-4 py-3">
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
                  <span className="text-[11px] text-secondary-fg/55 tabular-nums">
                    {Math.round(userTasks.reduce((s, b) => s + b.duration_min, 0) / 6) / 10}h
                  </span>
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

        {/* Missed-tasks pill: sleek, minimal */}
        {!planMissing && !isFuture && missedTasks.length > 0 && (
          <div className="mt-4 shrink-0 flex justify-center mb-1">
            <button
              type="button"
              onClick={() => setDayPickerIntent({ kind: "carry-missed" })}
              className="rounded-full border border-destructive/25 bg-destructive/[0.08] px-3.5 py-1.5 flex items-center gap-2 pressable hover:bg-destructive/[0.12] transition-colors"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse shrink-0" aria-hidden />
              <span className="text-[12px] font-medium text-destructive">
                {missedTasks.length} missed {missedTasks.length === 1 ? "slot" : "slots"}
              </span>
              <span className="text-[12px] font-semibold text-destructive/80 ml-1">
                Move &rarr;
              </span>
            </button>
          </div>
        )}

        {/* Inline "Start" CTA. */}
        {!planMissing && !isFuture && firstUnfinishedTask && (
          <Button
            onClick={() => nav(`/focus/${firstUnfinishedTask.id}`)}
            className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-[15px] font-semibold pressable shadow-[0_8px_30px_-6px_hsl(var(--primary)/0.5)] border border-primary/20 mt-4 mb-1"
          >
            <Play className="h-4 w-4 mr-2" fill="currentColor" />
            {toneCopy(getTone(profile as any), doneTasks === 0 ? "start_first" : "start_next")}
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
              Add your tasks — type them out, paste a list, or let AI plan your day.
            </p>
            <div className="mt-7 flex flex-col gap-2.5 max-w-[240px] mx-auto relative z-10">
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="btn-volumetric pressable inline-flex items-center justify-center gap-2 w-full h-12 rounded-[18px] text-primary-foreground text-[14px] font-semibold"
              >
                <ListPlus className="h-4 w-4" /> Add tasks
              </button>
              <button
                type="button"
                onClick={() => {
                  setAskAiContext("I have an empty day. Ask me one useful question that helps me decide what to add, without creating a schedule for me.");
                  setAskAiOpen(true);
                }}
                className="pressable inline-flex items-center justify-center gap-2 w-full h-11 rounded-[18px] text-[13px] font-semibold text-foreground/90 border border-border/50 bg-white/[0.07] dark:bg-white/[0.06] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.2)] backdrop-blur-sm"
              >
                <Wand2 className="h-4 w-4 text-primary" /> Ask AI
              </button>
            </div>
          </div>
          </div>
        )}

        {!planMissing && (
          <>
            {loading && blocks.length === 0 && <SkeletonBlock count={4} />}
            {(!loading || blocks.length > 0) && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragCancel={() => setDndBodyScrollLock(false)}
                onDragEnd={onDragEnd}
              >
                <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  <div className="touch-pan-y space-y-2.5 mt-4 enter-stagger">
                    {blocks.map((b) => {
                      const assignedId = getAssignedCategoryId(b.id);
                      const assignedCat = assignedId
                        ? tracker.categories.find((c) => c.id === assignedId) || null
                        : null;
                      return (
                      <SortableBlock
                        key={b.id}
                        block={b}
                        editing={false}
                        tourSpotlight={spotlightId === b.id}
                        trackingActive={!!tracker.active && tracker.active.block_id === b.id}
                        assignedCategory={assignedCat}
                        onTap={(blk) => setTappedBlock(blk)}
                        onTapTime={(blk) => {
                          if (blk?.is_calendar_event) return;
                          setStartTimeDraft(blk.start_time || "09:00");
                          setStartTimeEditId(blk.id);
                        }}
                        onToggleComplete={(blk) => {
                          if (blk?.is_calendar_event) return;
                          completeBlock(blk.id);
                        }}
                        onStartTrack={(blk) => {
                          if (blk?.is_calendar_event) return;
                          setTrackPickerBlock(blk);
                        }}
                        onStopTrack={(blk) => {
                          void stopTrackingForBlock(blk);
                        }}
                        onCarryForward={!isFuture ? (blk) => setDayPickerIntent({ kind: "move-task", blockId: blk.id }) : undefined}
                        onEditDuration={(blk) => setDurationEditId(blk.id)}
                        onEditReminders={(blk) => openReminders(blk.id)}
                        onAskAi={(blk) => {
                          setAskAiContext(`Help me think about this task: "${blk.title}" (${blk.duration_min} min). Suggest a realistic time estimate, breakdown into steps, or the best time of day. Just ideas — don't build a full plan.`);
                          setAskAiOpen(true);
                        }}
                        onSaveTemplate={(blk) => void saveAsTemplate(blk)}
                        onDeleteBlock={(blk) => removeBlock(blk.id)}
                      />
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
                  {activeDragId ? (() => {
                    const dragBlock = blocks.find((b) => b.id === activeDragId);
                    if (!dragBlock) return null;
                    const assignedId = getAssignedCategoryId(activeDragId);
                    const assignedCat = assignedId ? tracker.categories.find((c) => c.id === assignedId) || null : null;
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
                  })() : null}
                </DragOverlay>
              </DndContext>
            )}

            {!isPast && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setComposerOpen(true)}
                  disabled={planMutating}
                  className="inline-flex items-center justify-center gap-1.5 text-[12px] font-medium text-foreground/75 border border-border/40 rounded-2xl h-11 bg-transparent hover:bg-muted/35 pressable transition-colors disabled:opacity-50"
                >
                  <ListPlus className="h-3.5 w-3.5 opacity-70" /> Add tasks
                </button>
                <button
                  onClick={() => {
                    const taskList = blocks
                      .filter((b) => b.kind === "task" && !b.is_calendar_event)
                      .map((b) => `• ${b.start_time} ${b.title} (${b.duration_min}m)`)
                      .join("\n");
                    setAskAiContext(
                      taskList
                        ? `My schedule for today:\n${taskList}\n\nLook at this day and suggest one small improvement. Just advice — don't change or reschedule anything.`
                        : "I have an empty day. Ask me one useful question to help me decide what to focus on, without creating a schedule for me."
                    );
                    setAskAiOpen(true);
                  }}
                  disabled={planMutating}
                  className="inline-flex items-center justify-center gap-1.5 text-[12px] font-medium text-primary border border-primary/25 rounded-2xl h-11 bg-primary/10 hover:bg-primary/15 pressable transition-colors disabled:opacity-50"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Ask AI
                </button>
              </div>
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

      {/* Block tap sheet — single place for all per-block actions */}
      <Sheet open={!!tappedBlock} onOpenChange={(v) => !v && setTappedBlock(null)}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover">
          {tappedBlock && (
            <div className="space-y-1">
              <SheetHeader className="text-left mb-3">
                <SheetTitle className="text-[16px]">{tappedBlock.title}</SheetTitle>
                <div className="text-[12px] text-secondary-fg tabular-nums">
                  {fmtTime(tappedBlock.start_time)} ·{" "}
                  {tappedBlock.completed && typeof tappedBlock.actual_minutes === "number"
                    ? `${tappedBlock.actual_minutes}m actual${
                        tappedBlock.duration_min !== tappedBlock.actual_minutes
                          ? ` · ${tappedBlock.duration_min}m planned`
                          : ""
                      }`
                    : tappedBlock.duration_min < 60
                      ? `${tappedBlock.duration_min}m planned`
                      : `${Math.floor(tappedBlock.duration_min / 60)}h${tappedBlock.duration_min % 60 ? ` ${tappedBlock.duration_min % 60}m` : ""} planned`}
                </div>
              </SheetHeader>

              {!tappedBlock.is_calendar_event && tappedBlock.kind === "task" && isOpenUserTask(tappedBlock as Block) && (
                <ActionRow
                  onClick={() => { const blk = tappedBlock; setTappedBlock(null); setTrackPickerBlock(blk); }}
                  icon={<Play className="h-4 w-4" fill="currentColor" />}
                  label={tracker.active && tracker.active.block_id === tappedBlock.id ? "Tracking now · stop" : "Start tracking"}
                />
              )}
              {!tappedBlock.is_calendar_event && (
                <ActionRow
                  onClick={() => { setDurationEditId(tappedBlock.id); setTappedBlock(null); }}
                  icon={<Timer className="h-4 w-4" />}
                  label="Change duration"
                />
              )}
              {!tappedBlock.is_calendar_event && (
                <ActionRow
                  onClick={() => {
                    setStartTimeDraft(tappedBlock.start_time || "09:00");
                    setStartTimeEditId(tappedBlock.id);
                    setTappedBlock(null);
                  }}
                  icon={<Clock className="h-4 w-4" />}
                  label="Change start time"
                />
              )}
              {!tappedBlock.is_calendar_event && tappedBlock.kind === "task" && isOpenUserTask(tappedBlock as Block) && (
                <ActionRow
                  onClick={() => {
                    const id = tappedBlock.id;
                    setTappedBlock(null);
                    setDayPickerIntent({ kind: "move-task", blockId: id });
                  }}
                  icon={<ArrowRightCircle className="h-4 w-4" />}
                  label="Move to another day"
                />
              )}
              {!tappedBlock.is_calendar_event && isToday && (
                <ActionRow
                  onClick={() => openReminders(tappedBlock.id)}
                  icon={getReminderConfig(tappedBlock.id).enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                  label="Reminders"
                />
              )}
              {tappedBlock.location && (
                <a
                  href={mapsUrl(tappedBlock.location, tappedBlock.location_lat, tappedBlock.location_lng)}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-surface/50 pressable text-[14px]"
                >
                  <MapPin className="h-4 w-4 text-secondary-fg" />
                  <span className="flex-1">{tappedBlock.location}</span>
                </a>
              )}
              <ActionRow
                onClick={() => {
                  const blk = tappedBlock;
                  setTappedBlock(null);
                  setAskAiContext(`Help me think about this task: "${blk!.title}" (${blk!.duration_min} min). Suggest a realistic estimate, breakdown into steps, or a smarter time of day. Don't propose a full plan — just ideas I can apply.`);
                  setAskAiOpen(true);
                }}
                icon={<Sparkles className="h-4 w-4" />}
                label="Ask AI about this"
              />
              {!tappedBlock.is_calendar_event && tappedBlock.kind === "task" && (
                <ActionRow
                  onClick={() => { const blk = tappedBlock; setTappedBlock(null); void saveAsTemplate(blk); }}
                  icon={<Bookmark className="h-4 w-4" />}
                  label="Save as template"
                />
              )}
              {!tappedBlock.is_calendar_event && (
                <ActionRow
                  onClick={() => { const id = tappedBlock.id; setTappedBlock(null); removeBlock(id); }}
                  icon={<Trash2 className="h-4 w-4" />}
                  label="Delete"
                  destructive
                />
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Header "more" sheet — Re-plan, Delete plan */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="text-[16px]">Plan options</SheetTitle>
          </SheetHeader>
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
          <ActionRow
            onClick={() => { setMoreOpen(false); setConfirmDeletePlan(true); }}
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete plan"
            destructive
          />
        </SheetContent>
      </Sheet>

      {/* Task composer — bulk mode only */}
      <Sheet
        open={composerOpen}
        onOpenChange={(v) => {
          if (!v) { setBulkStep("input"); setBulkInput(""); setBulkRows([]); }
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
              {bulkStep === "review"
                ? <><ListPlus className="h-4 w-4 text-primary" /> Review tasks</>
                : <><ListPlus className="h-4 w-4 text-primary" /> Add tasks</>
              }
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 flex-1 overflow-y-auto">
            {bulkStep === "input" ? (
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
                            onClick={() => setBulkInput((v) => v ? `${v}\n${t.raw_input}` : t.raw_input)}
                            className="text-[12px] font-medium text-foreground/85 max-w-[11rem] truncate pressable"
                          >
                            {t.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteTemplate(t.id)}
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
                <Textarea
                  autoFocus={false}
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  placeholder={"Fix mobile layout, download PDF, send to client\nCall Alex, invoice client"}
                  className="min-h-[150px] rounded-2xl border-soft bg-card text-[14px]"
                />
                <Button onClick={() => void prepareBulkRows()} disabled={planMutating} className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/92 text-white font-semibold pressable">
                  Continue
                </Button>
              </div>
            ) : (
              <div className="space-y-3 pb-4">
                <div className="flex items-start justify-between px-1">
                  <p className="text-[12px] text-secondary-fg leading-relaxed max-w-[65%]">
                    Review your tasks. Tap time or duration to adjust.
                  </p>
                  <Button
                    onClick={() => void autoScheduleBulkRows()}
                    disabled={bulkAiLoading || planMutating}
                    size="sm"
                    className="h-8 rounded-full bg-primary/10 text-primary border border-primary/25 text-[12px] font-medium pressable shrink-0"
                  >
                    {bulkAiLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    Auto-schedule
                  </Button>
                </div>
                <div className="space-y-2.5 max-h-[48vh] overflow-y-auto pr-1 pb-2 pt-1">
                  {bulkRows.map((row, i) => (
                    <div key={i} className="flex flex-col gap-2 rounded-[18px] border border-border/40 bg-surface-card px-4 py-3.5 shadow-sm">
                      <div className="flex items-center gap-2">
                        <input
                          value={row.title}
                          onChange={(e) => setBulkRows((rs) => rs.map((r, idx) => idx === i ? { ...r, title: e.target.value } : r))}
                          className="flex-1 h-8 px-0 bg-transparent border-0 text-[15px] font-semibold text-foreground focus:outline-none placeholder:text-secondary-fg/50"
                        />
                        <button type="button" onClick={() => setBulkRows((rs) => rs.filter((_, idx) => idx !== i))}
                          className="h-8 w-8 grid place-items-center rounded-full text-secondary-fg/50 hover:text-destructive hover:bg-destructive/10 pressable transition-colors shrink-0" aria-label="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        <button type="button" onClick={() => {
                            setBulkStartTimeDraft(row.start_time || "09:00");
                            setBulkStartTimeEditIndex(i);
                          }}
                          className="flex items-center gap-1.5 h-8 px-3 rounded-full border border-border/45 bg-muted/40 text-[13px] font-medium text-secondary-fg hover:text-foreground pressable transition-colors"
                        >
                          <Clock className="h-3.5 w-3.5 opacity-70" />
                          {row.start_time ? fmtTime(row.start_time) : "Set time"}
                        </button>
                        <button type="button" onClick={() => setBulkDurationEditIndex(i)}
                          className="flex items-center gap-1.5 h-8 px-3 rounded-full border border-border/45 bg-muted/40 text-[13px] font-medium tabular-nums text-secondary-fg hover:text-foreground pressable transition-colors"
                        >
                          <Timer className="h-3.5 w-3.5 opacity-70" />
                          {row.duration < 60 ? `${row.duration}m` : `${Math.floor(row.duration / 60)}h${row.duration % 60 ? ` ${row.duration % 60}m` : ""}`}
                        </button>
                      </div>
                    </div>
                  ))}
                  {bulkRows.length === 0 && (
                    <p className="text-center text-[13px] text-secondary-fg py-10 bg-muted/20 rounded-[18px] border border-dashed border-border/45 mx-1">No tasks left.</p>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-3 border-t border-border/30 px-1">
                  <Button variant="outline" onClick={() => setBulkStep("input")} disabled={planMutating} className="h-12 rounded-2xl border-soft text-[14px]">
                    Back
                  </Button>
                  <Button onClick={() => void addBulkRows(bulkRows)} disabled={planMutating || bulkRows.length === 0}
                    className="flex-1 h-12 rounded-2xl bg-primary hover:bg-primary/92 text-primary-foreground font-semibold pressable"
                  >
                    Add {bulkRows.length} {bulkRows.length === 1 ? "task" : "tasks"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDeletePlan} onOpenChange={setConfirmDeletePlan}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entire plan?</AlertDialogTitle>
            <AlertDialogDescription>
              The plan for {friendlyDateFor(parseDateStr(viewDate))} and all its blocks will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={planMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
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
                } catch (e: any) {
                  toast.error(e?.message || "Unable to delete plan");
                } finally {
                  setPlanMutating(false);
                }
              }}
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={!!reminderBlockId} onOpenChange={(v) => !v && setReminderBlockId(null)}>
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
                    onClick={() => setReminderBlockId(null)}
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
                            <button
                              key={n}
                              type="button"
                              onClick={() => setAlerts(n, secondary && secondary !== n ? secondary : null)}
                              style={on ? chipStyleOn : chipStyleOff}
                              className={`${chipBase} ${on ? chipOn : chipOff}`}
                            >
                              {n === 0 ? "At start" : `${n} min`}
                            </button>
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
                        <button
                          type="button"
                          onClick={() => setAlerts(primary, null)}
                          style={secondary == null ? chipStyleOn : chipStyleOff}
                          className={`${chipBase} ${secondary == null ? chipOn : chipOff}`}
                        >None</button>
                        {SECONDARY_OPTIONS.filter((n) => n !== primary).map((n) => {
                          const on = secondary === n;
                          return (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setAlerts(primary, n)}
                              style={on ? chipStyleOn : chipStyleOff}
                              className={`${chipBase} ${on ? chipOn : chipOff}`}
                            >
                              {n === 0 ? "At start" : `${n} min`}
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    {/* Advanced */}
                    <details className="group rounded-2xl overflow-hidden" style={{
                      background: "linear-gradient(180deg, hsl(var(--card)/0.5) 0%, hsl(var(--card)/0.3) 100%)",
                      boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.04), 0 0 0 1px hsl(var(--border)/0.4)",
                    }}>
                      <summary className="flex items-center justify-between px-4 py-3.5 cursor-pointer pressable list-none">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-semibold text-foreground/90">Advanced</div>
                          <div className="text-[11.5px] text-secondary-fg/70 mt-0.5 leading-snug truncate">
                            End-of-slot ping in {reminderCfg.endAlertLeadMin}m · repeat {reminderCfg.repeats === 0 ? "off" : `${reminderCfg.repeats}×`}
                          </div>
                        </div>
                        <span className="text-secondary-fg/70 transition-transform group-open:rotate-90 text-[14px] shrink-0 ml-2">›</span>
                      </summary>
                      <div className="px-4 pb-4 pt-2 space-y-4 border-t border-border/30">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-secondary-fg/80 mb-2.5 px-0.5">Before window ends</div>
                          <div className="flex flex-wrap gap-1.5">
                            {[0, 2, 5, 10, 15, 30].map((n) => {
                              const on = (reminderCfg.endAlertLeadMin ?? 5) === n;
                              return (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => saveReminders({ ...reminderCfg, endAlertLeadMin: n })}
                                  style={on ? chipStyleOn : chipStyleOff}
                                  className={`${smallChipBase} ${on ? chipOn : chipOff}`}
                                >{n === 0 ? "At end" : `${n} min`}</button>
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
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => saveReminders({ ...reminderCfg, repeats: n })}
                                  style={on ? chipStyleOn : chipStyleOff}
                                  className={`${smallChipBase} ${on ? chipOn : chipOff}`}
                                >{n === 0 ? "Don't repeat" : `${n}×`}</button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </details>
                  </div>

                  <p className="text-[11px] text-secondary-fg/60 leading-relaxed text-center pt-1">
                    Reminders fire while the app is open · Saved on this device
                  </p>
                </div>

                <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
      <AskAiSheet open={askAiOpen} onOpenChange={setAskAiOpen} seedContext={askAiContext} />

      <DayPickerSheet
        open={!!dayPickerIntent}
        onOpenChange={(v) => { if (!v) setDayPickerIntent(null); }}
        value={
          dayPickerIntent?.kind === "navigate"
            ? viewDate
            : // For move/carry default the suggestion to tomorrow.
              tomorrowDate
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
              ? (() => {
                  const count = blocks.filter(
                    (b) => isUserTask(b) && !isUserTaskDone(b),
                  ).length;
                  return `${count} task${count === 1 ? "" : "s"} will be added there and marked moved here.`;
                })()
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
          className="rounded-t-[28px] border-border/45 bg-popover max-h-[85vh] flex flex-col"
          style={{ paddingBottom: "var(--keyboard-inset, 0px)" }}
        >
          <div className="flex-1 overflow-y-auto p-6">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-[16px]">
              <Play className="h-4 w-4 text-primary" fill="currentColor" /> Tracker category
            </SheetTitle>
          </SheetHeader>
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
                <div className="flex items-center gap-2">
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
                </div>
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
          const updated = [...blocks];
          updated[idx] = { ...updated[idx], duration_min: v };
          const next = packLinearSchedule(updated);
          setBlocks(next);
          setPlanMutating(true);
          try {
            const updatedBlock = next.find((x) => x.id === id);
            if (!updatedBlock) { setBlocks(snapshot); return; }
            const payload = {
              duration_min: v,
              slot_end_time: blockSlotEndHHMM(updatedBlock),
            };
            const { error: upErr } = await supabase.from("blocks").update(payload).eq("id", id);
            if (upErr) {
              if (!navigator.onLine || upErr.message?.toLowerCase().includes("fetch")) {
                await enqueueWrite({ table: "blocks", op: "update", payload, filter: { id } });
              } else {
                throw upErr;
              }
            }
            await persistOrder(next);
            void invalidatePlanCaches();
          } catch (e: any) {
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
          setBulkRows((rows) => rows.map((row, i) => i === index ? { ...row, duration: minutes } : row));
        }}
        title="Task duration"
      />

      <Sheet open={bulkStartTimeEditIndex !== null} onOpenChange={(v) => !v && setBulkStartTimeEditIndex(null)}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="text-[16px]">Set task time</SheetTitle>
          </SheetHeader>
          <input
            type="time"
            value={bulkStartTimeDraft}
            onChange={(e) => setBulkStartTimeDraft(e.target.value)}
            className="w-full h-12 px-3 rounded-lg bg-card border border-soft text-[16px] text-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
          />
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                const i = bulkStartTimeEditIndex;
                if (i !== null) {
                  setBulkRows((rs) => rs.map((r, idx) => idx === i ? { ...r, start_time: undefined } : r));
                }
                setBulkStartTimeEditIndex(null);
              }}
            >
              Clear time
            </Button>
            <Button
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                const i = bulkStartTimeEditIndex;
                if (i !== null) {
                  if (!/^\d{2}:\d{2}$/.test(bulkStartTimeDraft)) {
                    toast.error("Pick a valid time");
                    return;
                  }
                  setBulkRows((rs) => rs.map((r, idx) => idx === i ? { ...r, start_time: bulkStartTimeDraft } : r));
                }
                setBulkStartTimeEditIndex(null);
              }}
            >
              Save
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!startTimeEditId} onOpenChange={(v) => !v && setStartTimeEditId(null)}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="text-[16px]">Change start time</SheetTitle>
          </SheetHeader>
          <input
            type="time"
            value={startTimeDraft}
            onChange={(e) => setStartTimeDraft(e.target.value)}
            className="w-full h-12 px-3 rounded-lg bg-card border border-soft text-[16px] text-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
          />
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setStartTimeEditId(null)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={async () => {
                if (planMutating) return;
                const id = startTimeEditId;
                if (!id) return;
                if (!/^\d{2}:\d{2}$/.test(startTimeDraft)) {
                  toast.error("Pick a valid time");
                  return;
                }
                const idx = blocks.findIndex(b => b.id === id);
                if (idx < 0) { setStartTimeEditId(null); return; }
                const snapshot = blocks;
                const updated = [...blocks];
                const targetMin = timeToMinutes(startTimeDraft);
                
                // If it's not the first block, check if pushing the time later creates a gap
                let packed: Block[];
                if (idx > 0) {
                  const previousPacked = packLinearSchedule(updated.slice(0, idx));
                  const previousEndMin = timeToMinutes(previousPacked[previousPacked.length - 1].start_time) + Number(previousPacked[previousPacked.length - 1].duration_min);
                  
                  if (targetMin > previousEndMin) {
                    // User explicitly pushed this later, insert a Break to fill the gap
                    const breakDuration = targetMin - previousEndMin;
                    const breakBlock: Block = {
                      id: crypto.randomUUID(),
                      plan_id: updated[0].plan_id,
                      user_id: updated[0].user_id,
                      start_time: minutesToHHMM(previousEndMin),
                      duration_min: breakDuration,
                      title: "Break",
                      type: "routine",
                      kind: "break",
                      completed: false,
                      position: 0,
                    };
                    updated.splice(idx, 0, breakBlock);
                  }
                }
                
                // Still update the block itself (for idx === 0, this drives the whole schedule)
                const targetIdx = updated.findIndex(b => b.id === id);
                if (targetIdx >= 0) {
                  updated[targetIdx] = { ...updated[targetIdx], start_time: startTimeDraft };
                }
                
                packed = packLinearSchedule(updated);
                setBlocks(packed);
                setStartTimeEditId(null);
                haptics.notify("success");
                setPlanMutating(true);
                try {
                  await persistOrder(packed);
                  void invalidatePlanCaches();
                } catch (e: any) {
                  setBlocks(snapshot);
                  toast.error(e?.message || "Couldn't update start time");
                } finally {
                  setPlanMutating(false);
                }
              }}
            >
              Save
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

const ActionRow = ({ onClick, icon, label, destructive }: { onClick: () => void; icon?: React.ReactNode; label: string; destructive?: boolean }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-xl pressable transition-colors text-[14px] ${destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted/40"}`}
  >
    {icon && <span className={`shrink-0 ${destructive ? "text-destructive/80" : "text-secondary-fg"}`}>{icon}</span>}
    <span className="flex-1 text-left">{label}</span>
  </button>
);
