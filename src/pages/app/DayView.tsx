import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Block, fmtTime, todayDateStr, typeColor, typeLabel } from "@/lib/daydraft";
import { ChevronLeft, Sparkles, Play, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DayView() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [plan, setPlan] = useState<{ id: string; ai_summary: string | null; ai_subtext: string | null } | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(new Date());

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
      setBlocks((bs || []) as Block[]);
    })();
  }, [user?.id]);

  const removeBlock = async (id: string) => {
    setBlocks(b => b.filter(x => x.id !== id));
    await supabase.from("blocks").delete().eq("id", id);
  };

  const firstUnfinishedTask = blocks.find(b => b.kind === "task" && !b.completed);
  const totalTasks = blocks.filter(b => b.kind === "task").length;
  const doneTasks = blocks.filter(b => b.kind === "task" && b.completed).length;

  // now indicator: minutes since 6am mapped against block timeline
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

      <div className="px-5 mt-6 space-y-3">
        {blocks.map((b, i) => {
          const [h, m] = b.start_time.split(":").map(Number);
          const blockMin = h * 60 + m;
          const showNowLine = i === 0 ? nowMinutes < blockMin && nowMinutes > 6 * 60 :
            nowMinutes >= (() => { const [ph, pm] = blocks[i-1].start_time.split(":").map(Number); return ph*60+pm; })()
            && nowMinutes < blockMin;

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
              <div className="flex gap-3">
                <div className="w-12 pt-3 text-right text-secondary-fg text-[13px] font-mono-sf">{fmtTime(b.start_time)}</div>
                <div className="w-[3px] rounded-full" style={{ background: typeColor(b.type) }} />
                <div className={`flex-1 rounded-2xl bg-surface border border-border shadow-card p-4 pressable ${b.completed ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="font-medium text-[15px] leading-snug">{b.title}</div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-surface-elevated text-secondary-fg">{b.duration_min} min</span>
                        <span className="text-xs font-medium" style={{ color: typeColor(b.type) }}>{typeLabel(b.type)}</span>
                      </div>
                    </div>
                    {editing ? (
                      <button onClick={() => removeBlock(b.id)} className="text-destructive p-1 pressable">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : b.completed ? (
                      <div className="h-6 w-6 rounded-full bg-success flex items-center justify-center">
                        <Check className="h-3.5 w-3.5 text-success-foreground" strokeWidth={3} />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {blocks.length === 0 && <div className="text-center text-secondary-fg py-12">No blocks yet.</div>}
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
