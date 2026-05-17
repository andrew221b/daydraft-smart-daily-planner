import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  Block, fmtTime, todayDateStr, parseDateStr, friendlyDateFor, isFutureDateStr, isUserTask, isOpenUserTask, isUserTaskDone, inferScheduleBlockType, packLinearSchedule,
  blockSlotEndHHMM,
} from "@/lib/daydraft";
import { ChevronLeft, Play, Plus, Coffee, CalendarDays, Trash2, Bell, BellOff, MoreHorizontal, Clock, MapPin, Copy, Sparkles, ListPlus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableBlock } from "@/components/app/SortableBlock";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { resolveActualMinutesOnComplete, wallMinutesFromSlotStart } from "@/lib/blockActualTime";
import { useCalmMode } from "@/lib/calmMode";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { setDndBodyScrollLock } from "@/lib/dndScrollLock";
import { AskAiSheet } from "@/components/app/AskAiSheet";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { parseBulkTasks } from "@/lib/taskSplitter";

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
  const dayScrollRef = useRef<HTMLDivElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState("");
  const [bulkRows, setBulkRows] = useState<{ title: string; duration: number }[]>([]);
  const [bulkStep, setBulkStep] = useState<"input" | "review">("input");
  const [bulkDurationEditIndex, setBulkDurationEditIndex] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<"task" | "break">("task");
  const [newDuration, setNewDuration] = useState(30);
  const [newDurationOpen, setNewDurationOpen] = useState(false);
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
  const blockOpLocksRef = useRef(new Set<string>());
  const [calmMode] = useCalmMode();
  const { isPro } = useEntitlement();

  useEffect(() => {
    if (searchParams.get("composer") === "1") setBulkOpen(true);
  }, [searchParams]);

  const tomorrowDate = (() => {
    const d = parseDateStr(viewDate);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const { data: dayData, isLoading: loading, refetch } = useQuery({
    queryKey: planDayQueryKey(user?.id ?? "", viewDate),
    queryFn: () => fetchDayPlan(user!.id, viewDate),
    enabled: !!user?.id,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const plan = dayData?.plan ?? null;
  const planMissing = !loading && !plan;

  useEffect(() => {
    setBlocks((dayData?.blocks || []) as ExBlock[]);
  }, [dayData?.plan?.id, dayData?.blocks]);

  const openReminders = (id: string) => {
    setReminderCfg(getReminderConfig(id));
    setReminderBlockId(id);
    setTappedBlock(null);
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
    useSensor(PointerSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } })
  );

  useEffect(() => {
    if (blocks.length === 0) return;
    const t = setTimeout(() => tour.start(TOUR_DAYVIEW), 500);
    return () => clearTimeout(t);
  }, [blocks.length > 0]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

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
      await supabase.from("blocks").delete().eq("id", id);
      if (plan && next.length === 0) {
        await supabase.from("plans").delete().eq("id", plan.id);
        setBlocks([]);
        await invalidatePlanCaches();
        return;
      }
      await persistOrder(next);
      await invalidatePlanCaches();
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
            await invalidatePlanCaches();
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
    if (!wasDone && user) {
      try {
        resolvedActual = await resolveActualMinutesOnComplete(
          supabase,
          user.id,
          id,
          viewDate,
          toggled.start_time,
          completedAtMs,
        );
      } catch {
        resolvedActual = Math.max(1, Math.min(wallMinutesFromSlotStart(viewDate, toggled.start_time, completedAtMs), 24 * 60));
      }
    }

    setBlocks((bs) =>
      bs.map((b) =>
        b.id === id
          ? {
              ...b,
              completed: !wasDone,
              completed_at: !wasDone ? completedAtIso : null,
              actual_minutes: !wasDone ? resolvedActual : null,
              resolution: !wasDone ? ("done" as const) : null,
              resolved_at: !wasDone ? completedAtIso : null,
            }
          : b,
      ),
    );
    haptics.notify("success");
    try {
      const { error: upErr } = await supabase
        .from("blocks")
        .update({
          completed: !wasDone,
          completed_at: !wasDone ? completedAtIso : null,
          actual_minutes: !wasDone ? resolvedActual : null,
          resolution: !wasDone ? "done" : null,
          resolved_at: !wasDone ? completedAtIso : null,
        })
        .eq("id", id);
      if (upErr) throw upErr;
      if (!wasDone) {
        try { localStorage.setItem(`dd_last_plan_progress_${viewDate}`, new Date().toISOString()); } catch {/* ignore */}
      }
      await invalidatePlanCaches();
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
            await invalidatePlanCaches();
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

  const addInlineBlock = async () => {
    if (planMutating) return;
    if (!user) return;
    if (!newTitle.trim() && newKind === "task") { toast.error("Add a title"); return; }
    let planId = plan?.id;
    if (!planId) {
      const { data: created, error: planErr } = await supabase
        .from("plans")
        .insert({ user_id: user.id, date: viewDate, raw_input: "" } as any)
        .select("id")
        .single();
      if (planErr || !created?.id) {
        toast.error(planErr?.message || "Couldn't create plan");
        return;
      }
      planId = created.id;
    }
    const insertAt = blocks.length;
    const newId = crypto.randomUUID();
    const last = blocks[blocks.length - 1];
    const startMin = last ? (() => {
      const [h, m] = last.start_time.split(":").map(Number);
      return h * 60 + m + last.duration_min;
    })() : 9 * 60;
    const item: ExBlock = {
      id: newId,
      plan_id: planId!,
      user_id: user.id,
      start_time: `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`,
      duration_min: newDuration,
      estimated_minutes: newDuration,
      actual_minutes: null,
      title: newKind === "break" ? (newTitle.trim() || "Break") : newTitle.trim(),
      type: newKind === "break" ? "routine" : "deep_work",
      kind: newKind,
      block_type: newKind === "break" ? "rest" : inferScheduleBlockType({ kind: newKind, title: newTitle.trim() }),
      completed: false,
      position: insertAt,
    };
    const snapshot = blocks;
    const next = packLinearSchedule([...snapshot, item]);
    setBlocks(next);
    setAddOpen(false);
    setNewTitle(""); setNewDuration(30); setNewKind("task");
    haptics.notify("success");
    setPlanMutating(true);
    try {
      const placed = next.find((b) => b.id === newId)!;
      const { error: insertErr } = await supabase.from("blocks").insert({
        id: newId,
        plan_id: planId!,
        user_id: user.id,
        start_time: placed.start_time,
        duration_min: placed.duration_min,
        title: placed.title,
        type: placed.type,
        kind: placed.kind,
        estimated_minutes: placed.estimated_minutes ?? placed.duration_min,
        actual_minutes: placed.actual_minutes ?? null,
        block_type: inferScheduleBlockType(placed),
        position: placed.position,
        slot_end_time: blockSlotEndHHMM(placed),
      });
      if (insertErr) throw insertErr;
      await persistOrder(next);
      await invalidatePlanCaches();
      await refetch();
    } catch (e: any) {
      setBlocks(snapshot);
      toast.error(e?.message || "Unable to add block");
    } finally {
      setPlanMutating(false);
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
    setBulkRows(titles.map((title) => ({ title, duration: 30 })));
    setBulkStep("review");
  };

  const addBulkRows = async (rows: { title: string; duration: number }[]) => {
    if (planMutating || !user) return;
    const clean = rows.filter((t) => t.title.trim());
    if (!clean.length) {
      toast.error("No tasks to add");
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
          start_time: startHHMM,
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
      setBulkOpen(false);
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
      const { error } = await supabase.from("blocks").insert(toInsert as any);
      if (error) throw error;
      await persistOrder(packed);
      await invalidatePlanCaches();
      await refetch();
      toast.success(`Added ${clean.length} task${clean.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      setBlocks(snapshot);
      toast.error(e?.message || "Unable to add tasks");
    } finally {
      setPlanMutating(false);
    }
  };

  const persistOrder = async (list: ExBlock[]) => {
    const ops = list.map((b, i) =>
      supabase
        .from("blocks")
        .update({
          position: i,
          start_time: b.start_time,
          slot_end_time: blockSlotEndHHMM(b),
        })
        .eq("id", b.id),
    );
    const results = await Promise.all(ops);
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;
  };

  const handleDragStart = (_e: DragStartEvent) => {
    setDndBodyScrollLock(true);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDndBodyScrollLock(false);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = blocks.findIndex(b => b.id === active.id);
    const newIdx = blocks.findIndex(b => b.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = packLinearSchedule(arrayMove(blocks, oldIdx, newIdx));
    const snapshot = blocks;
    setBlocks(reordered);
    void persistOrder(reordered)
      .then(() => invalidatePlanCaches())
      .catch((e: any) => {
        setBlocks(snapshot);
        toast.error(e?.message || "Unable to reorder blocks");
      });
  };

  const replanRest = async () => {
    if (planMutating) return;
    if (!user || !plan) return;
    setMoreOpen(false);
    setReplanning(true);
    setPlanMutating(true);
    try {
      const remaining = blocks.filter((b) => isUserTask(b) && isOpenUserTask(b));
      const nowHM = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      const tz = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { data, error } = await supabase.functions.invoke("generate-plan", {
        body: {
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
      });
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
      await invalidatePlanCaches();
      toast.success("Re-planned");
    } catch (e: any) {
      toast.error(e.message || "Unable to re-plan remaining tasks");
    } finally {
      setReplanning(false);
      setPlanMutating(false);
    }
  };

  const rollOverUnfinishedToTomorrow = async () => {
    if (!user) return;
    const openTasks = blocks
      .filter((b) => isUserTask(b) && isOpenUserTask(b) && !b.is_calendar_event)
      .map((b) => b.title?.trim())
      .filter(Boolean) as string[];
    if (!openTasks.length) {
      toast("No unfinished tasks to carry forward");
      return;
    }
    try {
      await supabase.from("quick_captures").insert(
        openTasks.map((title) => ({
          user_id: user.id,
          content: `[for:${tomorrowDate}] ${title}`,
        })) as any
      );
      setMoreOpen(false);
      toast.success(`Moved ${openTasks.length} task${openTasks.length === 1 ? "" : "s"} to tomorrow`);
      nav(`/today?date=${tomorrowDate}`);
    } catch (e: any) {
      toast.error(e?.message || "Unable to carry tasks forward");
    }
  };

  const firstUnfinishedTask = blocks.find((b) => isUserTask(b) && isOpenUserTask(b));
  const userTasks = blocks.filter(isUserTask);
  const totalTasks = userTasks.length;
  const doneTasks = userTasks.filter((b) => isUserTaskDone(b)).length;

  const spotlightId = useMemo(
    () => blocks.find((b) => isUserTask(b) && isOpenUserTask(b) && !b.is_calendar_event)?.id,
    [blocks],
  );

  return (
    <Shell>
      <PullToRefresh
        scrollContainerRef={dayScrollRef}
        onRefresh={async () => {
          await refetch();
          await invalidatePlanCaches();
        }}
      >
      <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-6 pt-12 pb-2">
        <div className="rounded-[22px] border border-border/45 bg-background/30 backdrop-blur-[2px] px-3 py-3.5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => nav(isToday ? "/home" : `/today?date=${viewDate}`)}
            className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-secondary-fg/90 hover:text-foreground hover:bg-muted/40 pressable transition-colors"
            aria-label={isToday ? "Back to home" : "Back to planner"}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0 flex flex-col items-center px-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-secondary-fg/65">
              {isToday ? "Timeline" : "Plan"}
            </p>
            <h1 className="font-display text-[22px] font-medium tracking-[-0.02em] text-foreground/95 text-center truncate w-full mt-1 leading-tight">
              {isToday ? "Today" : friendlyDateFor(parseDateStr(viewDate))}
            </h1>
            {!isToday && (
              <button
                type="button"
                onClick={() => nav("/home")}
                className="mt-1.5 text-[12px] font-medium text-primary/90 pressable"
              >
                Jump to today
              </button>
            )}
          </div>
          <div className="flex items-center shrink-0 gap-0.5">
            {!calmMode && !planMissing && blocks.length > 0 && (
              <button
                type="button"
                onClick={() => void copyDayOutline()}
                className="h-10 w-10 rounded-full flex items-center justify-center text-secondary-fg/90 hover:text-foreground hover:bg-muted/40 pressable transition-colors"
                aria-label="Copy plan as text"
              >
                <Copy className="h-4 w-4" />
              </button>
            )}
            {!planMissing && (
              <button
                onClick={() => setMoreOpen(true)}
                className="h-10 w-10 rounded-full flex items-center justify-center text-secondary-fg/90 hover:text-foreground hover:bg-muted/40 pressable transition-colors"
                aria-label="More"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {calmMode && !planMissing && (
        <div className="mt-5 shrink-0 px-6">
          <div className="rounded-[18px] border border-border/40 bg-background/25 px-3.5 py-2.5 text-[11px] text-secondary-fg/85 leading-relaxed">
            Calm Mode — fewer secondary controls.
          </div>
        </div>
      )}
      {/* Progress — soft container */}
      {!calmMode && !planMissing && totalTasks > 0 && (
        <div className="mt-5 shrink-0 px-6">
          <div className="rounded-[22px] border border-border/45 bg-background/25 backdrop-blur-[2px] px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[13px] text-foreground/95 tabular-nums">
                <span className="font-medium">{doneTasks}</span>
                <span className="text-secondary-fg/80">/{totalTasks} done</span>
              </div>
              <div className="text-[11px] text-secondary-fg/75 tabular-nums">
                {Math.round(userTasks.reduce((s, b) => s + b.duration_min, 0) / 6) / 10}h planned
              </div>
            </div>
            <div className="mt-2.5 h-1.5 rounded-full bg-muted/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/85 transition-all duration-500"
                style={{ width: totalTasks ? `${(doneTasks / totalTasks) * 100}%` : "0%" }}
              />
            </div>
          </div>
        </div>
      )}

      <div
        ref={dayScrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-6 pb-[calc(96px+env(safe-area-inset-bottom))] [-webkit-overflow-scrolling:touch] pt-8"
      >
        {planMissing && (
          <div className="rounded-[22px] border border-dashed border-border/50 bg-muted/[0.06] px-6 py-10 text-center">
            <CalendarDays className="h-7 w-7 mx-auto text-secondary-fg/70 mb-3 opacity-80" />
            <div className="text-[15px] font-medium text-foreground/95 tracking-tight">
              {isToday ? "Empty day" : friendlyDateFor(parseDateStr(viewDate))}
            </div>
            <p className="text-[12px] text-secondary-fg/80 mt-2 leading-relaxed">
              Write your plan however it comes out. We'll clean it up into separate blocks for review.
            </p>
            <div className="mt-6">
              <Button
                onClick={() => setBulkOpen(true)}
                className="h-11 w-full rounded-2xl bg-primary hover:bg-primary/92 text-primary-foreground text-[13px] font-medium pressable"
              >
                <ListPlus className="h-4 w-4 mr-1" /> Write plan
              </Button>
            </div>
          </div>
        )}

        {!planMissing && (
          <>
            {loading && <SkeletonBlock count={4} />}
            {!loading && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragCancel={() => setDndBodyScrollLock(false)}
                onDragEnd={onDragEnd}
              >
                <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  <div className="touch-pan-y space-y-2.5">
                    {blocks.map((b) => (
                      <SortableBlock
                        key={b.id}
                        block={b}
                        editing={false}
                        tourSpotlight={spotlightId === b.id}
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
                        onAskAi={(blk) => {
                          if (blk?.is_calendar_event) return;
                          setAskAiContext(`Help me think about this task: "${blk.title}" (${blk.duration_min} min). Suggest one practical next step, a better estimate, or a small breakdown. Don't schedule my day — just advice.`);
                          setAskAiOpen(true);
                        }}
                      />
                    ))}
                    {blocks.length === 0 && (
                      <div className="text-center text-secondary-fg py-12 text-sm">No tasks scheduled.</div>
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {/* Inline add — single soft button, no sheet trigger needed */}
            {!isFuture && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                  onClick={() => setAddOpen(true)}
                  disabled={planMutating}
                  className="inline-flex items-center justify-center gap-1.5 text-[12px] font-medium text-foreground/75 border border-border/40 rounded-2xl h-11 bg-transparent hover:bg-muted/35 pressable transition-colors disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5 opacity-70" /> Add task
                </button>
                <button
                  onClick={() => setBulkOpen(true)}
                  disabled={planMutating}
                  className="inline-flex items-center justify-center gap-1.5 text-[12px] font-medium text-foreground/75 border border-border/40 rounded-2xl h-11 bg-transparent hover:bg-muted/35 pressable transition-colors disabled:opacity-50"
                >
                  <ListPlus className="h-3.5 w-3.5 opacity-70" /> Paste list
                </button>
                <button
                  onClick={() => {
                    setAskAiContext("Look at my current day and suggest one small helpful improvement. Don't change or schedule anything — just advice I can apply manually.");
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
      </div>
      </div>
      </PullToRefresh>

      {!planMissing && !isFuture && firstUnfinishedTask && (
        <div
          className="fixed left-1/2 -translate-x-1/2 w-full max-w-[440px] px-6 z-30"
          style={{ bottom: "calc(84px + env(safe-area-inset-bottom))" }}
        >
          <Button onClick={() => nav(`/focus/${firstUnfinishedTask.id}`)}
            className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/92 text-primary-foreground text-[15px] font-medium pressable">
            <Play className="h-4 w-4" fill="currentColor" /> {toneCopy(getTone(profile as any), doneTasks === 0 ? "start_first" : "start_next")}
          </Button>
        </div>
      )}
      {!planMissing && !isFuture && !firstUnfinishedTask && totalTasks > 0 && (
        <div
          className="fixed left-1/2 -translate-x-1/2 w-full max-w-[440px] px-6 z-30"
          style={{ bottom: "calc(84px + env(safe-area-inset-bottom))" }}
        >
          <div className="w-full h-12 rounded-2xl bg-success/15 text-success border border-success/30 flex items-center justify-center text-[14px] font-medium">
            All done for today ✓
          </div>
        </div>
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

              {!tappedBlock.is_calendar_event && (
                <ActionRow
                  onClick={() => { setDurationEditId(tappedBlock.id); setTappedBlock(null); }}
                  icon={<Clock className="h-4 w-4" />}
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
              {!tappedBlock.is_calendar_event && tappedBlock.kind === "task" && isOpenUserTask(tappedBlock) && (
                null
              )}
              {!calmMode && !tappedBlock.is_calendar_event && isToday && (
                <ActionRow
                  onClick={() => openReminders(tappedBlock.id)}
                  icon={getReminderConfig(tappedBlock.id).enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                  label="Reminders"
                />
              )}
              {!calmMode && tappedBlock.location && (
                <a
                  href={mapsUrl(tappedBlock.location, tappedBlock.location_lat, tappedBlock.location_lng)}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-surface/50 pressable text-[14px]"
                >
                  <MapPin className="h-4 w-4 text-secondary-fg" />
                  <span className="flex-1">{tappedBlock.location}</span>
                </a>
              )}
              {!calmMode && (
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
              onClick={rollOverUnfinishedToTomorrow}
              icon={<CalendarDays className="h-4 w-4" />}
              label="Carry unfinished to tomorrow"
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

      {/* Add task sheet */}
      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-[16px]">
              <Plus className="h-4 w-4 text-primary" /> Add to day
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setNewKind("task")}
                className={`flex-1 h-10 rounded-lg border text-[13px] font-medium pressable transition-colors ${newKind === "task" ? "surface-accent border-accent text-primary" : "bg-card border-soft text-secondary-fg"}`}
              >Task</button>
              <button
                onClick={() => { setNewKind("break"); if (!newTitle) setNewTitle("Break"); }}
                className={`flex-1 h-10 rounded-lg border text-[13px] font-medium pressable inline-flex items-center justify-center gap-1.5 transition-colors ${newKind === "break" ? "surface-accent border-accent text-primary" : "bg-card border-soft text-secondary-fg"}`}
              ><Coffee className="h-3.5 w-3.5" /> Break</button>
            </div>
            <input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder={newKind === "break" ? "Break name (optional)" : "What's the task?"}
              className="w-full h-11 px-3 rounded-lg bg-card border border-soft text-[14px] text-foreground placeholder:text-faint focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            />
            <button
              onClick={() => setNewDurationOpen(true)}
              className="w-full flex items-center justify-between bg-card border border-soft rounded-lg px-3 py-2.5 pressable hover:border-primary/40 transition-colors"
            >
              <span className="text-[12px] text-secondary-fg">Duration</span>
              <span className="text-[13px] font-semibold tabular-nums">
                {newDuration < 60 ? `${newDuration}m` : `${Math.floor(newDuration/60)}h${newDuration%60 ? ` ${newDuration%60}m` : ""}`}
              </span>
            </button>
            <Button
              onClick={addInlineBlock}
              disabled={planMutating}
              className="w-full h-11 rounded-lg bg-primary hover:bg-primary/92 text-primary-foreground font-medium pressable"
            >Add</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={bulkOpen} onOpenChange={setBulkOpen}>
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-[16px]">
              <ListPlus className="h-4 w-4 text-primary" /> {bulkStep === "input" ? "Paste your tasks" : "Review tasks"}
            </SheetTitle>
          </SheetHeader>
          {bulkStep === "input" ? (
            <div className="mt-4 space-y-3">
              <p className="text-[12px] leading-relaxed text-secondary-fg">
                Paste a messy list. It will only become editable tasks — no AI schedule, no automatic planning.
              </p>
              <Textarea
                autoFocus
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder={"Finish Nike review\nCall Alex\nInvoice client\nQuick cleanup"}
                className="min-h-[150px] rounded-2xl border-soft bg-card text-[14px]"
              />
              <Button
                onClick={() => void prepareBulkRows()}
                disabled={planMutating}
                className="w-full h-11 rounded-2xl bg-primary hover:bg-primary/92 text-primary-foreground font-medium pressable"
              >
                Continue
              </Button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-[11px] text-secondary-fg leading-relaxed">
                Edit titles or duration. Tasks stay in this order; no AI changes them.
              </p>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {bulkRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-xl border border-soft bg-card px-2.5 py-2">
                    <input
                      value={row.title}
                      onChange={(e) => setBulkRows((rs) => rs.map((r, idx) => idx === i ? { ...r, title: e.target.value } : r))}
                      className="flex-1 h-9 px-1 bg-transparent border-0 text-[13.5px] focus:outline-none"
                    />
                    <select
                      value={row.duration}
                      onChange={(e) => setBulkRows((rs) => rs.map((r, idx) => idx === i ? { ...r, duration: Number(e.target.value) } : r))}
                      className="h-8 px-2 rounded-lg bg-muted/40 border border-soft text-[12px] tabular-nums"
                    >
                      {[15, 30, 45, 60, 90, 120].map((m) => (
                        <option key={m} value={m}>{m < 60 ? `${m}m` : `${m / 60}h${m % 60 ? ` ${m % 60}m` : ""}`}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setBulkRows((rs) => rs.filter((_, idx) => idx !== i))}
                      className="h-8 w-8 grid place-items-center text-secondary-fg hover:text-destructive pressable"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {bulkRows.length === 0 && (
                  <p className="text-center text-[12px] text-secondary-fg py-4">No tasks left.</p>
                )}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => setBulkStep("input")}
                  disabled={planMutating}
                  className="h-11 rounded-2xl border-soft text-[13px]"
                >
                  Back
                </Button>
                <Button
                  onClick={() => void addBulkRows(bulkRows)}
                  disabled={planMutating || bulkRows.length === 0}
                  className="flex-1 h-11 rounded-2xl bg-primary hover:bg-primary/92 text-primary-foreground font-medium pressable"
                >
                  Add {bulkRows.length} {bulkRows.length === 1 ? "task" : "tasks"}
                </Button>
              </div>
            </div>
          )}
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
                  await invalidatePlanCaches();
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
        <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-surface-elevated">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><Bell className="h-4 w-4 text-primary" /> Reminders</SheetTitle>
          </SheetHeader>
          {(() => {
            const b = blocks.find(x => x.id === reminderBlockId);
            if (!b) return null;
            const LEAD_OPTIONS = [0, 2, 5, 10, 15, 30, 60];
            const REPEAT_OPTIONS = [0, 1, 2, 3, 5];
            const toggleLead = (n: number) => {
              const has = reminderCfg.leadsMin.includes(n);
              const next = has
                ? reminderCfg.leadsMin.filter(x => x !== n)
                : [...reminderCfg.leadsMin, n].sort((a, c) => c - a);
              saveReminders({ ...reminderCfg, leadsMin: next });
            };
            return (
              <div className="mt-4 space-y-4">
                <div className="text-sm text-foreground font-medium">{b.title}</div>
                <div className="text-xs text-secondary-fg">Starts at {b.start_time}</div>
                <div className="flex items-center justify-between rounded-xl surface-card border border-soft px-3 py-2.5">
                  <span className="text-sm">Notify me</span>
                  <button
                    onClick={() => saveReminders({ ...reminderCfg, enabled: !reminderCfg.enabled })}
                    className={`px-3 h-7 rounded-full text-[11px] font-medium pressable ${reminderCfg.enabled ? "bg-primary text-primary-foreground" : "bg-muted text-secondary-fg"}`}
                  >{reminderCfg.enabled ? "On" : "Off"}</button>
                </div>
                <div className={reminderCfg.enabled ? "" : "opacity-40 pointer-events-none"}>
                  <div className="text-[11px] uppercase tracking-wider text-secondary-fg mb-2">Before start</div>
                  <div className="flex flex-wrap gap-1.5">
                    {LEAD_OPTIONS.map(n => {
                      const on = reminderCfg.leadsMin.includes(n);
                      return (
                        <button
                          key={n}
                          onClick={() => toggleLead(n)}
                          className={`h-8 px-3 rounded-full text-[12px] font-medium pressable border ${on ? "surface-accent border-accent text-primary" : "surface-soft border-soft text-secondary-fg"}`}
                        >{n === 0 ? "At start" : `${n} min`}</button>
                      );
                    })}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-secondary-fg mt-5 mb-2">Repeat after start</div>
                  <div className="flex flex-wrap gap-1.5">
                    {REPEAT_OPTIONS.map(n => (
                      <button
                        key={n}
                        onClick={() => saveReminders({ ...reminderCfg, repeats: n })}
                        className={`h-8 px-3 rounded-full text-[12px] font-medium pressable border ${reminderCfg.repeats === n ? "surface-accent border-accent text-primary" : "surface-soft border-soft text-secondary-fg"}`}
                      >{n === 0 ? "Don't repeat" : `${n}× every 5 min`}</button>
                    ))}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-secondary-fg mt-5 mb-2">Before window ends</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[0, 2, 5, 10, 15, 30].map((n) => {
                      const on = (reminderCfg.endAlertLeadMin ?? 5) === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => saveReminders({ ...reminderCfg, endAlertLeadMin: n })}
                          className={`h-8 px-3 rounded-full text-[12px] font-medium pressable border ${on ? "surface-accent border-accent text-primary" : "surface-soft border-soft text-secondary-fg"}`}
                        >
                          {n === 0 ? "At end" : `${n} min`}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-secondary-fg mt-5 mb-2">Extra pings (every 1 min after first)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[0, 1, 2, 3, 5].map((n) => {
                      const on = (reminderCfg.endAlertRepeat ?? 0) === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => saveReminders({ ...reminderCfg, endAlertRepeat: n })}
                          className={`h-8 px-3 rounded-full text-[12px] font-medium pressable border ${on ? "surface-accent border-accent text-primary" : "surface-soft border-soft text-secondary-fg"}`}
                        >
                          {n === 0 ? "None" : `${n} extra`}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="text-[11px] text-secondary-fg leading-relaxed">
                  Reminders fire while the app is open. Saved on this device.
                </p>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
      <AskAiSheet open={askAiOpen} onOpenChange={setAskAiOpen} initialPrompt={askAiContext} />

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
            const updatedBlock = next.find((x) => x.id === id)!;
            const { error } = await supabase.from("blocks").update({
              duration_min: v,
              slot_end_time: blockSlotEndHHMM(updatedBlock),
            }).eq("id", id);
            if (error) throw error;
            await persistOrder(next);
            await invalidatePlanCaches();
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
        open={newDurationOpen}
        onClose={() => setNewDurationOpen(false)}
        value={newDuration}
        onChange={setNewDuration}
        title="New block duration"
      />

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
                updated[idx] = { ...updated[idx], start_time: startTimeDraft };
                const packed = packLinearSchedule(updated);
                setBlocks(packed);
                setStartTimeEditId(null);
                haptics.notify("success");
                setPlanMutating(true);
                try {
                  await persistOrder(packed);
                  await invalidatePlanCaches();
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
    </Shell>
  );
}

const ActionRow = ({ onClick, icon, label, destructive }: { onClick: () => void; icon?: React.ReactNode; label: string; destructive?: boolean }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg pressable hover:bg-muted/40 text-[14px] ${destructive ? "text-destructive" : "text-foreground"}`}
  >
    {icon && <span className={destructive ? "text-destructive" : "text-secondary-fg"}>{icon}</span>}
    <span className="flex-1 text-left">{label}</span>
  </button>
);
