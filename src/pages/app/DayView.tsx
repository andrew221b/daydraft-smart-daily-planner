import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Block, fmtTime, todayDateStr, parseDateStr, friendlyDateFor, isFutureDateStr } from "@/lib/daydraft";
import { ChevronLeft, Sparkles, Play, RefreshCw, Plus, Coffee, ChevronDown, CalendarDays, Trash2, Bell, BellOff, MoreHorizontal, Clock, Info, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
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

type ExBlock = Block & {
  ai_reasoning?: string | null;
  location?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  is_calendar_event?: boolean;
};

const retime = (blocks: ExBlock[]): ExBlock[] => {
  if (!blocks.length) return blocks;
  const [h, m] = blocks[0].start_time.split(":").map(Number);
  let cursor = h * 60 + m;
  return blocks.map((b, i) => {
    const start = i === 0 ? b.start_time : `${String(Math.floor(cursor / 60)).padStart(2,"0")}:${String(cursor % 60).padStart(2,"0")}`;
    cursor += b.duration_min;
    return { ...b, start_time: start };
  });
};

export default function DayView() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const nav = useNavigate();
  const tour = useTour();
  const [searchParams] = useSearchParams();
  const viewDate = searchParams.get("date") || todayDateStr();
  const isFuture = isFutureDateStr(viewDate);
  const isToday = viewDate === todayDateStr();
  const [plan, setPlan] = useState<{ id: string; ai_summary: string | null; ai_subtext: string | null } | null>(null);
  const [blocks, setBlocks] = useState<ExBlock[]>([]);
  const [planMissing, setPlanMissing] = useState(false);
  const [now, setNow] = useState(new Date());
  const [replanning, setReplanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [collapseDone, setCollapseDone] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<"task" | "break">("task");
  const [newDuration, setNewDuration] = useState(30);
  const [newDurationOpen, setNewDurationOpen] = useState(false);
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tappedBlock, setTappedBlock] = useState<ExBlock | null>(null);
  const [reminderBlockId, setReminderBlockId] = useState<string | null>(null);
  const [reminderCfg, setReminderCfg] = useState<ReminderConfig>({ enabled: true, leadsMin: [2], repeats: 0 });
  const [durationEditId, setDurationEditId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      setPlanMissing(false);
      const { data: p } = await supabase.from("plans").select("id, ai_summary, ai_subtext")
        .eq("user_id", user.id).eq("date", viewDate).maybeSingle();
      if (!p) {
        setPlan(null);
        setBlocks([]);
        setPlanMissing(true);
        setLoading(false);
        return;
      }
      setPlan(p);
      const { data: bs } = await supabase.from("blocks").select("*").eq("plan_id", p.id).order("position");
      setBlocks((bs || []) as ExBlock[]);
      setLoading(false);
    })();
  }, [user?.id, viewDate]);

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

  const removeBlock = async (id: string) => {
    const snapshot = blocks;
    const removed = blocks.find(b => b.id === id);
    if (!removed) return;
    const next = retime(blocks.filter(x => x.id !== id));
    setBlocks(next);
    haptics.impact("light");
    let undone = false;
    toast("Removed", {
      action: { label: "Undo", onClick: () => { undone = true; setBlocks(snapshot); } },
      duration: 5000,
    });
    setTimeout(async () => {
      if (undone) return;
      await supabase.from("blocks").delete().eq("id", id);
      if (plan && next.length === 0) {
        await supabase.from("plans").delete().eq("id", plan.id);
        setPlan(null);
        setPlanMissing(true);
        return;
      }
      await persistOrder(next);
    }, 5200);
  };

  const completeBlock = async (id: string) => {
    const snapshot = blocks;
    const wasDone = blocks.find(b => b.id === id)?.completed;
    setBlocks(bs => bs.map(b => b.id === id ? { ...b, completed: !b.completed } : b));
    haptics.notify("success");
    let undone = false;
    toast.success(wasDone ? "Reopened" : "Done", {
      action: { label: "Undo", onClick: () => { undone = true; setBlocks(snapshot); } },
      duration: 4000,
    });
    setTimeout(async () => {
      if (undone) {
        await supabase.from("blocks").update({ completed: !!wasDone }).eq("id", id);
        return;
      }
      await supabase.from("blocks").update({ completed: !wasDone }).eq("id", id);
    }, 4200);
  };

  const addInlineBlock = async () => {
    if (!plan || !user) return;
    if (!newTitle.trim() && newKind === "task") { toast.error("Add a title"); return; }
    const insertAt = blocks.length;
    const newId = crypto.randomUUID();
    const last = blocks[blocks.length - 1];
    const startMin = last ? (() => {
      const [h, m] = last.start_time.split(":").map(Number);
      return h * 60 + m + last.duration_min;
    })() : 9 * 60;
    const item: ExBlock = {
      id: newId,
      plan_id: plan.id,
      user_id: user.id,
      start_time: `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`,
      duration_min: newDuration,
      title: newKind === "break" ? (newTitle.trim() || "Break") : newTitle.trim(),
      type: newKind === "break" ? "routine" : "deep_work",
      kind: newKind,
      completed: false,
      position: insertAt,
    };
    const next = retime([...blocks, item]);
    setBlocks(next);
    setAddOpen(false);
    setNewTitle(""); setNewDuration(30); setNewKind("task");
    haptics.notify("success");
    await supabase.from("blocks").insert({
      id: newId,
      plan_id: plan.id,
      user_id: user.id,
      start_time: item.start_time,
      duration_min: item.duration_min,
      title: item.title,
      type: item.type,
      kind: item.kind,
      position: item.position,
    });
    await persistOrder(next);
  };

  const persistOrder = async (list: ExBlock[]) => {
    await Promise.all(list.map((b, i) =>
      supabase.from("blocks").update({ position: i, start_time: b.start_time }).eq("id", b.id)
    ));
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = blocks.findIndex(b => b.id === active.id);
    const newIdx = blocks.findIndex(b => b.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = retime(arrayMove(blocks, oldIdx, newIdx));
    setBlocks(reordered);
    persistOrder(reordered);
  };

  const replanRest = async () => {
    if (!user || !plan) return;
    setMoreOpen(false);
    setReplanning(true);
    try {
      const remaining = blocks.filter(b => b.kind === "task" && !b.completed);
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
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const keep = blocks.filter(b => b.kind === "task" ? b.completed : false);
      await supabase.from("blocks").delete().eq("plan_id", plan.id).eq("completed", false);
      const startPos = keep.length;
      const newBlocks = (data.blocks || []).map((b: any, i: number) => ({
        plan_id: plan.id, user_id: user.id,
        start_time: b.start_time, duration_min: b.duration_min, title: b.title,
        type: b.type, kind: b.kind, position: startPos + i,
        ai_reasoning: b.reasoning ?? null,
        location: b.location ?? null,
        location_lat: b.location_lat ?? null,
        location_lng: b.location_lng ?? null,
      }));
      if (newBlocks.length) await supabase.from("blocks").insert(newBlocks);
      const { data: bs } = await supabase.from("blocks").select("*").eq("plan_id", plan.id).order("position");
      setBlocks((bs || []) as ExBlock[]);
      toast.success("Re-planned");
    } catch (e: any) {
      toast.error(e.message || "Couldn't re-plan");
    } finally { setReplanning(false); }
  };

  const firstUnfinishedTask = blocks.find(b => b.kind === "task" && !b.completed && !b.is_calendar_event);
  const totalTasks = blocks.filter(b => b.kind === "task").length;
  const doneTasks = blocks.filter(b => b.kind === "task" && b.completed).length;

  const upcomingBlocks = blocks.filter(b => !(b.kind === "task" && b.completed));
  const completedBlocks = blocks.filter(b => b.kind === "task" && b.completed);

  return (
    <Shell>
      <div className="px-6 pt-12 flex items-center justify-between">
        <button onClick={() => nav("/today")} className="h-9 w-9 -ml-2 rounded-full flex items-center justify-center text-secondary-fg hover:text-foreground hover:bg-surface pressable">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-[16px] font-semibold tracking-tight">
          {isToday ? "Today" : friendlyDateFor(parseDateStr(viewDate))}
        </h1>
        <button
          onClick={() => setMoreOpen(true)}
          disabled={planMissing}
          className="h-9 w-9 -mr-2 rounded-full flex items-center justify-center text-secondary-fg hover:text-foreground hover:bg-surface pressable disabled:opacity-30"
          aria-label="More"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      {/* Compact progress strip — single line, no boxed card */}
      {!planMissing && totalTasks > 0 && (
        <div className="px-6 mt-5">
          <div className="flex items-baseline justify-between">
            <div className="text-[13.5px] text-foreground tabular-nums">
              <span className="font-semibold">{doneTasks}</span>
              <span className="text-secondary-fg">/{totalTasks} done</span>
            </div>
            <div className="text-[11.5px] text-secondary-fg tabular-nums">
              {Math.round(blocks.filter(b => b.kind === "task").reduce((s,b) => s + b.duration_min, 0) / 6) / 10}h planned
            </div>
          </div>
          <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: totalTasks ? `${(doneTasks / totalTasks) * 100}%` : "0%" }} />
          </div>
        </div>
      )}

      <div className="px-3 mt-5">
        {planMissing && (
          <div className="mx-2 rounded-xl bg-card border border-border shadow-card p-6 text-center">
            <CalendarDays className="h-6 w-6 mx-auto text-secondary-fg mb-2" />
            <div className="text-sm font-medium">
              {isFuture ? `No plan for ${friendlyDateFor(parseDateStr(viewDate))} yet`
                : isToday ? "No plan for today yet"
                : `No plan for ${friendlyDateFor(parseDateStr(viewDate))}`}
            </div>
            <p className="text-xs text-secondary-fg mt-1">
              {isToday || isFuture ? "Head back to the planner." : "This day was never planned."}
            </p>
            <Button onClick={() => nav(isToday ? "/today" : `/today?date=${viewDate}`)}
              className="mt-4 h-9 px-4 rounded-lg bg-primary hover:bg-primary/92 text-primary-foreground text-[13px] font-medium pressable">
              Open planner
            </Button>
          </div>
        )}

        {!planMissing && (
          <>
            {loading && <SkeletonBlock count={4} />}
            {!loading && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={upcomingBlocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-0.5">
                    {upcomingBlocks.map((b) => (
                      <SortableBlock key={b.id} block={b} editing={false} onTap={(blk) => setTappedBlock(blk)} />
                    ))}
                    {upcomingBlocks.length === 0 && completedBlocks.length === 0 && (
                      <div className="text-center text-secondary-fg py-12 text-sm">Nothing scheduled.</div>
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {/* Inline add — single soft button, no sheet trigger needed */}
            {!isFuture && (
              <button
                onClick={() => setAddOpen(true)}
                className="mt-3 ml-[60px] inline-flex items-center gap-1.5 text-[12px] text-secondary-fg hover:text-primary pressable"
              >
                <Plus className="h-3.5 w-3.5" /> Add task
              </button>
            )}

            {completedBlocks.length > 0 && (
              <div className="mt-6">
                <button
                  onClick={() => setCollapseDone(c => !c)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-secondary-fg pressable hover:text-foreground"
                >
                  <span>{completedBlocks.length} completed</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapseDone ? "" : "rotate-180"}`} />
                </button>
                {!collapseDone && (
                  <div className="space-y-0.5 mt-1">
                    {completedBlocks.map(b => (
                      <SortableBlock key={b.id} block={b} editing={false} onTap={(blk) => setTappedBlock(blk)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {!planMissing && !isFuture && firstUnfinishedTask && (
        <div className="fixed bottom-[68px] left-1/2 -translate-x-1/2 w-full max-w-[420px] px-5 z-30">
          <Button onClick={() => nav(`/focus/${firstUnfinishedTask.id}`)}
            className="w-full h-12 rounded-xl bg-primary hover:bg-primary/92 text-primary-foreground text-[15px] font-medium pressable shadow-elevated">
            <Play className="h-4 w-4" fill="currentColor" /> {toneCopy(getTone(profile as any), doneTasks === 0 ? "start_first" : "start_next")}
          </Button>
        </div>
      )}
      {!planMissing && !isFuture && !firstUnfinishedTask && totalTasks > 0 && (
        <div className="fixed bottom-[68px] left-1/2 -translate-x-1/2 w-full max-w-[420px] px-5 z-30">
          <Button onClick={() => nav(isToday ? "/recap" : `/recap?date=${viewDate}`)} className="w-full h-12 rounded-xl bg-success text-success-foreground hover:bg-success/90 text-[15px] font-medium pressable shadow-elevated">
            {toneCopy(getTone(profile as any), "recap_cta")} →
          </Button>
        </div>
      )}

      {/* Block tap sheet — single place for all per-block actions */}
      <Sheet open={!!tappedBlock} onOpenChange={(v) => !v && setTappedBlock(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl border-border bg-popover">
          {tappedBlock && (
            <div className="space-y-1">
              <SheetHeader className="text-left mb-3">
                <SheetTitle className="text-[16px]">{tappedBlock.title}</SheetTitle>
                <div className="text-[12px] text-secondary-fg tabular-nums">
                  {fmtTime(tappedBlock.start_time)} · {tappedBlock.duration_min < 60 ? `${tappedBlock.duration_min}m` : `${Math.floor(tappedBlock.duration_min/60)}h${tappedBlock.duration_min%60 ? ` ${tappedBlock.duration_min%60}m` : ""}`}
                </div>
              </SheetHeader>

              {!tappedBlock.is_calendar_event && (
                <ActionRow
                  onClick={() => { const id = tappedBlock.id; setTappedBlock(null); completeBlock(id); }}
                  label={tappedBlock.completed ? "Mark as not done" : "Mark done"}
                />
              )}
              {!tappedBlock.is_calendar_event && (
                <ActionRow
                  onClick={() => { setDurationEditId(tappedBlock.id); setTappedBlock(null); }}
                  icon={<Clock className="h-4 w-4" />}
                  label="Change duration"
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
                  className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/40 pressable text-[14px]"
                >
                  <MapPin className="h-4 w-4 text-secondary-fg" />
                  <span className="flex-1">{tappedBlock.location}</span>
                </a>
              )}
              {tappedBlock.ai_reasoning && (
                <div className="px-3 py-3 rounded-lg bg-muted/40 text-[13px] text-secondary-fg leading-relaxed">
                  <div className="flex items-center gap-1.5 mb-1 text-foreground text-[12px] font-medium">
                    <Info className="h-3.5 w-3.5 text-primary" /> Why
                  </div>
                  {tappedBlock.ai_reasoning}
                </div>
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
        <SheetContent side="bottom" className="rounded-t-2xl border-border bg-popover">
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="text-[16px]">Plan options</SheetTitle>
          </SheetHeader>
          {!isFuture && firstUnfinishedTask && (
            <ActionRow
              onClick={replanRest}
              icon={<RefreshCw className={`h-4 w-4 ${replanning ? "animate-spin" : ""}`} />}
              label={replanning ? "Re-planning…" : "Re-plan rest of day"}
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
        <SheetContent side="bottom" className="rounded-t-2xl border-border bg-popover">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-[16px]">
              <Plus className="h-4 w-4 text-primary" /> Add to day
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setNewKind("task")}
                className={`flex-1 h-10 rounded-lg border text-[13px] font-medium pressable transition-colors ${newKind === "task" ? "bg-primary/8 border-primary/40 text-primary" : "bg-card border-border text-secondary-fg"}`}
              >Task</button>
              <button
                onClick={() => { setNewKind("break"); if (!newTitle) setNewTitle("Break"); }}
                className={`flex-1 h-10 rounded-lg border text-[13px] font-medium pressable inline-flex items-center justify-center gap-1.5 transition-colors ${newKind === "break" ? "bg-primary/8 border-primary/40 text-primary" : "bg-card border-border text-secondary-fg"}`}
              ><Coffee className="h-3.5 w-3.5" /> Break</button>
            </div>
            <input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder={newKind === "break" ? "Break name (optional)" : "What's the task?"}
              className="w-full h-11 px-3 rounded-lg bg-card border border-border text-[14px] text-foreground placeholder:text-secondary-fg/70 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            />
            <button
              onClick={() => setNewDurationOpen(true)}
              className="w-full flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2.5 pressable hover:border-primary/40 transition-colors"
            >
              <span className="text-[12px] text-secondary-fg">Duration</span>
              <span className="text-[13px] font-semibold tabular-nums">
                {newDuration < 60 ? `${newDuration}m` : `${Math.floor(newDuration/60)}h${newDuration%60 ? ` ${newDuration%60}m` : ""}`}
              </span>
            </button>
            <Button
              onClick={addInlineBlock}
              className="w-full h-11 rounded-lg bg-primary hover:bg-primary/92 text-primary-foreground font-medium pressable"
            >Add</Button>
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!plan) return;
                setConfirmDeletePlan(false);
                await supabase.from("blocks").delete().eq("plan_id", plan.id);
                await supabase.from("plans").delete().eq("id", plan.id);
                toast.success("Plan deleted");
                nav(isToday ? "/today" : `/today?date=${viewDate}`);
              }}
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={!!reminderBlockId} onOpenChange={(v) => !v && setReminderBlockId(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl border-border bg-surface-elevated">
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
                <div className="flex items-center justify-between rounded-xl bg-surface border border-border px-3 py-2.5">
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
                          className={`h-8 px-3 rounded-full text-[12px] font-medium pressable border ${on ? "bg-primary/10 border-primary/40 text-primary" : "bg-surface border-border text-secondary-fg"}`}
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
                        className={`h-8 px-3 rounded-full text-[12px] font-medium pressable border ${reminderCfg.repeats === n ? "bg-primary/10 border-primary/40 text-primary" : "bg-surface border-border text-secondary-fg"}`}
                      >{n === 0 ? "Don't repeat" : `${n}× every 5 min`}</button>
                    ))}
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

      <DurationPicker
        open={!!durationEditId}
        onClose={() => setDurationEditId(null)}
        value={blocks.find(b => b.id === durationEditId)?.duration_min || 30}
        onChange={async (v) => {
          const id = durationEditId;
          if (!id) return;
          setBlocks(bs => {
            const idx = bs.findIndex(b => b.id === id);
            if (idx < 0) return bs;
            const updated = [...bs];
            updated[idx] = { ...updated[idx], duration_min: v };
            return retime(updated);
          });
          await supabase.from("blocks").update({ duration_min: v }).eq("id", id);
          await persistOrder(blocks);
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
