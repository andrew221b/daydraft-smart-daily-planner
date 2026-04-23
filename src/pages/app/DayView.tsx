import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Block, fmtTime, todayDateStr, parseDateStr, friendlyDateFor, isFutureDateStr } from "@/lib/daydraft";
import { ChevronLeft, Sparkles, Play, RefreshCw, Plus, Minus, Coffee, ChevronDown, Zap, CalendarDays, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableBlock } from "@/components/app/SortableBlock";
import { SwipeableBlock } from "@/components/app/SwipeableBlock";
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
import { toast } from "sonner";
import { useTour, TOUR_DAYVIEW } from "@/components/app/Tour";
import { haptics } from "@/lib/haptics";
import { ContextStrip } from "@/components/app/ContextStrip";
import { SkeletonBlock } from "@/components/app/SkeletonBlock";
import { peakWindow } from "@/lib/daydraft";

type ExBlock = Block & {
  ai_reasoning?: string | null;
  location?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  is_calendar_event?: boolean;
};

// Re-time blocks sequentially using the first block's start time
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
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(new Date());
  const [reasoningBlock, setReasoningBlock] = useState<ExBlock | null>(null);
  const [replanning, setReplanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [collapseDone, setCollapseDone] = useState(true);
  const [addAtIdx, setAddAtIdx] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<"task" | "break">("task");
  const [newDuration, setNewDuration] = useState(30);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  // First-time tour for DayView
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
        // No silent redirect — show an empty state so the user understands what happened.
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

  const removeBlock = async (id: string) => {
    // Universal undo: snapshot, delete, offer 5s undo.
    const snapshot = blocks;
    const removed = blocks.find(b => b.id === id);
    if (!removed) return;
    const next = retime(blocks.filter(x => x.id !== id));
    setBlocks(next);
    haptics.impact("light");
    let undone = false;
    toast("Block removed", {
      action: {
        label: "Undo",
        onClick: () => { undone = true; setBlocks(snapshot); },
      },
      duration: 5000,
    });
    setTimeout(async () => {
      if (undone) return;
      await supabase.from("blocks").delete().eq("id", id);
      await persistOrder(next);
    }, 5200);
  };

  const completeBlock = async (id: string) => {
    const snapshot = blocks;
    setBlocks(bs => bs.map(b => b.id === id ? { ...b, completed: true } : b));
    haptics.notify("success");
    let undone = false;
    toast.success("Marked complete", {
      action: {
        label: "Undo",
        onClick: () => { undone = true; setBlocks(snapshot); },
      },
      duration: 5000,
    });
    setTimeout(async () => {
      if (undone) {
        await supabase.from("blocks").update({ completed: false }).eq("id", id);
        return;
      }
      await supabase.from("blocks").update({ completed: true }).eq("id", id);
    }, 5200);
  };

  const adjustDuration = async (id: string, delta: number) => {
    setBlocks(bs => {
      const idx = bs.findIndex(b => b.id === id);
      if (idx < 0) return bs;
      const cur = bs[idx];
      const next = Math.max(5, Math.min(240, cur.duration_min + delta));
      const updated = [...bs];
      updated[idx] = { ...cur, duration_min: next };
      return retime(updated);
    });
    haptics.selection();
  };

  const persistDuration = async (id: string) => {
    const b = blocks.find(x => x.id === id);
    if (!b) return;
    await supabase.from("blocks").update({ duration_min: b.duration_min }).eq("id", id);
    await persistOrder(blocks);
  };

  const addInlineBlock = async () => {
    if (!plan || !user || addAtIdx == null) return;
    if (!newTitle.trim() && newKind === "task") { toast.error("Add a title"); return; }
    const insertAt = addAtIdx;
    // Compute start time from previous block (or first block if at top)
    const newId = crypto.randomUUID();
    const item: ExBlock = {
      id: newId,
      plan_id: plan.id,
      user_id: user.id,
      start_time: blocks[insertAt - 1]?.start_time || blocks[0]?.start_time || "09:00",
      duration_min: newDuration,
      title: newKind === "break" ? (newTitle.trim() || "Break") : newTitle.trim(),
      type: newKind === "break" ? "routine" : "deep_work",
      kind: newKind,
      completed: false,
      position: insertAt,
    };
    const next = retime([...blocks.slice(0, insertAt), item, ...blocks.slice(insertAt)]);
    setBlocks(next);
    setAddAtIdx(null); setNewTitle(""); setNewDuration(30); setNewKind("task");
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
    toast.success("Added");
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
    setReplanning(true);
    try {
      const remaining = blocks.filter(b => b.kind === "task" && !b.completed);
      const nowHM = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      const { data, error } = await supabase.functions.invoke("generate-plan", {
        body: {
          raw_input: remaining.map(b => `${b.title} (${b.duration_min}m)`).join("\n"),
          energy_preference: profile?.energy_preference || "morning",
          name: profile?.display_name,
          mode: "replan",
          start_time: nowHM,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // keep already-completed blocks; drop unfinished tasks; insert new ones after completed
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
      toast.success("Re-planned the rest of your day");
    } catch (e: any) {
      toast.error(e.message || "Couldn't re-plan");
    } finally { setReplanning(false); }
  };

  const firstUnfinishedTask = blocks.find(b => b.kind === "task" && !b.completed && !b.is_calendar_event);
  const totalTasks = blocks.filter(b => b.kind === "task").length;
  const doneTasks = blocks.filter(b => b.kind === "task" && b.completed).length;
  const meetings = blocks.filter(b => b.is_calendar_event).length;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowLabel = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  // Time-until-next-block / time-left-in-active-block
  const activeBlock = blocks.find((b, i) => {
    if (b.completed) return false;
    const [h, m] = b.start_time.split(":").map(Number);
    const start = h * 60 + m;
    const end = start + b.duration_min;
    return nowMinutes >= start && nowMinutes < end;
  });
  const upcomingBlock = !activeBlock ? blocks.find(b => {
    if (b.completed) return false;
    const [h, m] = b.start_time.split(":").map(Number);
    return h * 60 + m > nowMinutes;
  }) : null;
  const minutesUntilNext = (() => {
    if (activeBlock) {
      const [h, m] = activeBlock.start_time.split(":").map(Number);
      return (h * 60 + m + activeBlock.duration_min) - nowMinutes;
    }
    if (upcomingBlock) {
      const [h, m] = upcomingBlock.start_time.split(":").map(Number);
      return (h * 60 + m) - nowMinutes;
    }
    return null;
  })();

  // Energy peak window → minute range, used for the colored band on the timeline
  const energyRange = (() => {
    const e = profile?.energy_preference || "morning";
    if (e === "morning") return [9 * 60, 13 * 60];
    if (e === "midday") return [11 * 60, 15 * 60];
    return [19 * 60, 23 * 60];
  })();

  // Split blocks into upcoming and completed for the collapsible done section.
  const upcomingBlocks = blocks.filter(b => !(b.kind === "task" && b.completed));
  const completedBlocks = blocks.filter(b => b.kind === "task" && b.completed);

  return (
    <Shell>
      <div className="px-5 pt-12 flex items-center justify-between">
        <button onClick={() => nav("/today")} className="h-9 w-9 -ml-2 rounded-full flex items-center justify-center text-secondary-fg hover:text-foreground pressable">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <h1 className="text-[22px] font-semibold leading-tight">
            {isToday ? "Today's Plan" : `Plan · ${friendlyDateFor(parseDateStr(viewDate))}`}
          </h1>
          <div className="mt-0.5"><ContextStrip meetings={meetings} /></div>
        </div>
        <button onClick={() => setEditing(e => !e)} disabled={planMissing} className="text-sm text-primary font-medium px-2 disabled:opacity-30">
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      <div className="px-5 mt-5">
        {planMissing && (
          <div className="rounded-2xl bg-surface-elevated border border-border shadow-card p-6 text-center">
            <CalendarDays className="h-6 w-6 mx-auto text-secondary-fg mb-2" />
            <div className="text-sm font-medium">
              {isFuture ? `No plan for ${friendlyDateFor(parseDateStr(viewDate))} yet`
                : isToday ? "No plan for today yet"
                : `No plan for ${friendlyDateFor(parseDateStr(viewDate))}`}
            </div>
            <p className="text-xs text-secondary-fg mt-1">
              {isToday || isFuture ? "Head back to the planner to draft one." : "This day was never planned."}
            </p>
            <Button onClick={() => nav(isToday ? "/today" : `/today?date=${viewDate}`)}
              className="mt-4 h-10 px-5 rounded-xl text-primary-foreground text-sm font-medium pressable shadow-glow"
              style={{ background: "var(--gradient-primary)" }}>
              Open planner
            </Button>
          </div>
        )}
        {!planMissing && (
        <div className="rounded-2xl bg-surface-elevated border border-border shadow-card p-4 relative overflow-hidden">
          <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-primary" />
          <div className="pl-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{plan?.ai_summary || `${doneTasks}/${totalTasks} tasks`}</span>
            </div>
            <p className="text-secondary-fg text-sm mt-1.5 leading-relaxed">{plan?.ai_subtext}</p>
            {minutesUntilNext != null && (
              <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-[11px] font-medium text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                {activeBlock
                  ? `${minutesUntilNext} min left in current block`
                  : `Starts in ${minutesUntilNext} min`}
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {!planMissing && !isFuture && firstUnfinishedTask && (
        <div className="px-5 mt-3">
          <button onClick={replanRest} disabled={replanning}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg pressable hover:text-primary hover:border-primary/30">
            <RefreshCw className={`h-3.5 w-3.5 ${replanning ? "animate-spin" : ""}`} />
            {replanning ? "Re-planning..." : "Re-plan rest of day"}
          </button>
        </div>
      )}

      {!planMissing && plan && (
        <div className="px-5 mt-2">
          <button
            onClick={() => setConfirmDeletePlan(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg pressable hover:text-destructive hover:border-destructive/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete plan
          </button>
        </div>
      )}

      {!planMissing && (
      <div className="px-5 mt-6">
        {loading && <SkeletonBlock count={4} />}
        {!loading && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={upcomingBlocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3 relative">
              {/* Energy peak band (subtle vertical highlight) */}
              <div
                className="absolute left-12 right-0 rounded-2xl pointer-events-none"
                style={{
                  background: "linear-gradient(180deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.0))",
                  top: 0,
                  // approx — visual only
                  height: "100%",
                  opacity: 0.0,
                }}
              />
              {upcomingBlocks.map((b, i) => {
                const [h, m] = b.start_time.split(":").map(Number);
                const blockMin = h * 60 + m;
                const inEnergyZone = b.kind === "task" && b.type === "deep_work" &&
                  blockMin >= energyRange[0] && blockMin < energyRange[1];
                const showNowLine = !editing && (i === 0
                  ? nowMinutes < blockMin && nowMinutes > 6 * 60
                  : nowMinutes >= (() => { const [ph, pm] = upcomingBlocks[i-1].start_time.split(":").map(Number); return ph*60+pm; })()
                    && nowMinutes < blockMin);
                const realIdx = blocks.findIndex(x => x.id === b.id);

                if (b.kind !== "task") {
                  return (
                    <div key={b.id}>
                      {showNowLine && <NowLine label={nowLabel} />}
                      <div className="text-center text-xs text-secondary-fg py-2 tracking-wide uppercase">
                        {b.kind === "lunch" ? "Lunch" : "Break"} · {fmtTime(b.start_time)}
                      </div>
                      {editing && <InlineAdd onClick={() => setAddAtIdx(realIdx + 1)} />}
                    </div>
                  );
                }
                return (
                  <div key={b.id}>
                    {showNowLine && <NowLine label={nowLabel} />}
                    {inEnergyZone && (
                      <div className="ml-12 mb-1 inline-flex items-center gap-1 text-[10px] text-primary uppercase tracking-wider font-medium">
                        <Zap className="h-2.5 w-2.5" fill="currentColor" /> Peak energy
                      </div>
                    )}
                    <SwipeableBlock
                      disabled={editing || b.is_calendar_event}
                      showComplete={!b.completed}
                      showDelete={!b.is_calendar_event}
                      onComplete={() => completeBlock(b.id)}
                      onDelete={() => removeBlock(b.id)}
                    >
                      <SortableBlock block={b} editing={editing} onRemove={(id) => setConfirmRemoveId(id)} onInfo={setReasoningBlock} />
                    </SwipeableBlock>
                    {editing && !b.is_calendar_event && (
                      <div className="ml-12 mt-1.5 flex items-center gap-2 text-[11px] text-secondary-fg">
                        <span>Duration:</span>
                        <button
                          onClick={() => adjustDuration(b.id, -5)}
                          onPointerUp={() => persistDuration(b.id)}
                          className="h-6 w-6 rounded-md bg-surface border border-border pressable inline-flex items-center justify-center"
                          aria-label="Shorten"
                        ><Minus className="h-3 w-3" /></button>
                        <span className="tabular-nums text-foreground font-medium min-w-[40px] text-center">{b.duration_min}m</span>
                        <button
                          onClick={() => adjustDuration(b.id, 5)}
                          onPointerUp={() => persistDuration(b.id)}
                          className="h-6 w-6 rounded-md bg-surface border border-border pressable inline-flex items-center justify-center"
                          aria-label="Lengthen"
                        ><Plus className="h-3 w-3" /></button>
                      </div>
                    )}
                    {editing && <InlineAdd onClick={() => setAddAtIdx(realIdx + 1)} />}
                  </div>
                );
              })}
              {upcomingBlocks.length === 0 && completedBlocks.length === 0 && (
                <div className="text-center text-secondary-fg py-12">No blocks yet.</div>
              )}
              {editing && upcomingBlocks.length === 0 && (
                <InlineAdd onClick={() => setAddAtIdx(0)} />
              )}
            </div>
          </SortableContext>
        </DndContext>
        )}

        {/* Collapsed completed section */}
        {completedBlocks.length > 0 && !editing && (
          <div className="mt-6">
            <button
              onClick={() => setCollapseDone(c => !c)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-surface/60 border border-border/60 text-xs text-secondary-fg pressable hover:text-foreground"
            >
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {completedBlocks.length} completed
              </span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapseDone ? "" : "rotate-180"}`} />
            </button>
            {!collapseDone && (
              <div className="space-y-3 mt-3 opacity-70">
                {completedBlocks.map(b => (
                  <SortableBlock key={b.id} block={b} editing={false} onRemove={(id) => setConfirmRemoveId(id)} onInfo={setReasoningBlock} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {!planMissing && !isFuture && firstUnfinishedTask && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[390px] px-5 z-30">
          <Button onClick={() => nav(`/focus/${firstUnfinishedTask.id}`)}
            className="w-full h-13 py-3.5 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
            style={{ background: "var(--gradient-primary)" }}>
            <Play className="h-4 w-4" fill="currentColor" /> Start {doneTasks === 0 ? "First" : "Next"} Block
          </Button>
        </div>
      )}
      {!planMissing && !isFuture && !firstUnfinishedTask && totalTasks > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[390px] px-5 z-30">
          <Button onClick={() => nav(isToday ? "/recap" : `/recap?date=${viewDate}`)} className="w-full h-13 py-3.5 rounded-xl bg-success text-success-foreground hover:bg-success/90 text-base font-medium pressable">
            See Today's Recap →
          </Button>
        </div>
      )}
      {!planMissing && isFuture && totalTasks > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[390px] px-5 z-30">
          <div className="w-full h-13 py-3.5 rounded-xl bg-surface border border-border text-center text-xs text-secondary-fg flex items-center justify-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            Preview · starts {friendlyDateFor(parseDateStr(viewDate))}
          </div>
        </div>
      )}

      <Sheet open={!!reasoningBlock} onOpenChange={(v) => !v && setReasoningBlock(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl border-border bg-surface-elevated">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Why this block?
            </SheetTitle>
          </SheetHeader>
          <div className="text-sm font-medium mt-3">{reasoningBlock?.title}</div>
          <p className="text-[15px] leading-relaxed text-secondary-fg mt-2">{reasoningBlock?.ai_reasoning}</p>
        </SheetContent>
      </Sheet>

      {/* Inline add sheet */}
      <Sheet open={addAtIdx != null} onOpenChange={(v) => !v && setAddAtIdx(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl border-border bg-surface-elevated">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              Add to your day
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setNewKind("task")}
                className={`flex-1 h-10 rounded-xl border text-sm font-medium pressable ${newKind === "task" ? "bg-primary/10 border-primary/40 text-primary" : "bg-surface border-border text-secondary-fg"}`}
              >Task</button>
              <button
                onClick={() => { setNewKind("break"); if (!newTitle) setNewTitle("Break"); }}
                className={`flex-1 h-10 rounded-xl border text-sm font-medium pressable inline-flex items-center justify-center gap-1.5 ${newKind === "break" ? "bg-primary/10 border-primary/40 text-primary" : "bg-surface border-border text-secondary-fg"}`}
              ><Coffee className="h-3.5 w-3.5" /> Break</button>
            </div>
            <input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder={newKind === "break" ? "Break name (optional)" : "What's the task?"}
              className="w-full h-11 px-3 rounded-xl bg-surface border border-border text-sm text-foreground"
            />
            <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-3 py-2">
              <span className="text-xs text-secondary-fg">Duration</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setNewDuration(d => Math.max(5, d - 5))} className="h-7 w-7 rounded-md bg-background border border-border pressable">−</button>
                <span className="text-sm font-semibold tabular-nums min-w-[44px] text-center">{newDuration}m</span>
                <button onClick={() => setNewDuration(d => Math.min(240, d + 5))} className="h-7 w-7 rounded-md bg-background border border-border pressable">+</button>
              </div>
            </div>
            <Button
              onClick={addInlineBlock}
              className="w-full h-11 rounded-xl text-primary-foreground font-medium pressable shadow-glow"
              style={{ background: "var(--gradient-primary)" }}
            >Add</Button>
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={!!confirmRemoveId} onOpenChange={(v) => { if (!v) setConfirmRemoveId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this block?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const t = blocks.find(b => b.id === confirmRemoveId)?.title;
                return t ? `"${t}" will be removed from today's plan. You'll have a few seconds to undo.` : "This block will be removed from today's plan.";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = confirmRemoveId;
                setConfirmRemoveId(null);
                if (id) removeBlock(id);
              }}
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmDeletePlan} onOpenChange={setConfirmDeletePlan}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entire plan?</AlertDialogTitle>
            <AlertDialogDescription>
              The plan for {friendlyDateFor(parseDateStr(viewDate))} and all its blocks will be removed. You can re-plan from scratch afterwards.
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
            >Delete plan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}

const NowLine = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2 my-2 px-3">
    <div className="text-[10px] text-primary font-mono-sf font-medium">{label}</div>
    <div className="flex-1 h-px bg-primary/40" />
    <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-glow" />
  </div>
);

const InlineAdd = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="ml-12 mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-dashed border-border text-[11px] text-secondary-fg pressable hover:border-primary/40 hover:text-primary"
  >
    <Plus className="h-3 w-3" /> Add here
  </button>
);
