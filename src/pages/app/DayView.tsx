import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Block, fmtTime, todayDateStr } from "@/lib/daydraft";
import { ChevronLeft, Sparkles, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableBlock } from "@/components/app/SortableBlock";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useProfile } from "@/hooks/useProfile";
import { toast } from "sonner";

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
  const [plan, setPlan] = useState<{ id: string; ai_summary: string | null; ai_subtext: string | null } | null>(null);
  const [blocks, setBlocks] = useState<ExBlock[]>([]);
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(new Date());
  const [reasoningBlock, setReasoningBlock] = useState<ExBlock | null>(null);
  const [replanning, setReplanning] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("plans").select("id, ai_summary, ai_subtext")
        .eq("user_id", user.id).eq("date", todayDateStr()).maybeSingle();
      if (!p) { nav("/today"); return; }
      setPlan(p);
      const { data: bs } = await supabase.from("blocks").select("*").eq("plan_id", p.id).order("position");
      setBlocks((bs || []) as ExBlock[]);
    })();
  }, [user?.id]);

  const removeBlock = async (id: string) => {
    const next = retime(blocks.filter(x => x.id !== id));
    setBlocks(next);
    await supabase.from("blocks").delete().eq("id", id);
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

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowLabel = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  return (
    <Shell>
      <div className="px-5 pt-12 flex items-center justify-between">
        <button onClick={() => nav("/today")} className="h-9 w-9 -ml-2 rounded-full flex items-center justify-center text-secondary-fg hover:text-foreground pressable">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[22px] font-semibold">Today's Plan</h1>
        <button onClick={() => setEditing(e => !e)} className="text-sm text-primary font-medium px-2">
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      <div className="px-5 mt-5">
        <div className="rounded-2xl bg-surface-elevated border border-border shadow-card p-4 relative overflow-hidden">
          <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-primary" />
          <div className="pl-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{plan?.ai_summary || `${doneTasks}/${totalTasks} tasks`}</span>
            </div>
            <p className="text-secondary-fg text-sm mt-1.5 leading-relaxed">{plan?.ai_subtext}</p>
          </div>
        </div>
      </div>

      {firstUnfinishedTask && (
        <div className="px-5 mt-3">
          <button onClick={replanRest} disabled={replanning}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg pressable hover:text-primary hover:border-primary/30">
            <RefreshCw className={`h-3.5 w-3.5 ${replanning ? "animate-spin" : ""}`} />
            {replanning ? "Re-planning..." : "Re-plan rest of day"}
          </button>
        </div>
      )}

      <div className="px-5 mt-6">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {blocks.map((b, i) => {
                const [h, m] = b.start_time.split(":").map(Number);
                const blockMin = h * 60 + m;
                const showNowLine = !editing && (i === 0
                  ? nowMinutes < blockMin && nowMinutes > 6 * 60
                  : nowMinutes >= (() => { const [ph, pm] = blocks[i-1].start_time.split(":").map(Number); return ph*60+pm; })()
                    && nowMinutes < blockMin);

                if (b.kind !== "task") {
                  return (
                    <div key={b.id}>
                      {showNowLine && <NowLine label={nowLabel} />}
                      <div className="text-center text-xs text-secondary-fg py-2 tracking-wide uppercase">
                        {b.kind === "lunch" ? "Lunch" : "Break"} · {fmtTime(b.start_time)}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={b.id}>
                    {showNowLine && <NowLine label={nowLabel} />}
                    <SortableBlock block={b} editing={editing} onRemove={removeBlock} onInfo={setReasoningBlock} />
                  </div>
                );
              })}
              {blocks.length === 0 && <div className="text-center text-secondary-fg py-12">No blocks yet.</div>}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {firstUnfinishedTask && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[390px] px-5 z-30">
          <Button onClick={() => nav(`/focus/${firstUnfinishedTask.id}`)}
            className="w-full h-13 py-3.5 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
            style={{ background: "var(--gradient-primary)" }}>
            <Play className="h-4 w-4" fill="currentColor" /> Start {doneTasks === 0 ? "First" : "Next"} Block
          </Button>
        </div>
      )}
      {!firstUnfinishedTask && totalTasks > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[390px] px-5 z-30">
          <Button onClick={() => nav("/recap")} className="w-full h-13 py-3.5 rounded-xl bg-success text-success-foreground hover:bg-success/90 text-base font-medium pressable">
            See Today's Recap →
          </Button>
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
