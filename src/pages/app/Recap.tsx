import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { Block, todayDateStr } from "@/lib/daydraft";
import { Sparkles, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimeTracker, fmtHM } from "@/hooks/useTimeTracker";
import { toast } from "sonner";

export default function Recap() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const nav = useNavigate();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [insight, setInsight] = useState<string | null>(null);
  const { todayTotalSec, categories, refresh: refreshTracker } = useTimeTracker();
  const [backfilled, setBackfilled] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("plans").select("id").eq("user_id", user.id).eq("date", todayDateStr()).maybeSingle();
      if (!p) { nav("/today"); return; }
      const { data: bs } = await supabase.from("blocks").select("*").eq("plan_id", p.id).order("position");
      const list = (bs || []) as Block[];
      setBlocks(list);
      try {
        const { data } = await supabase.functions.invoke("generate-insight", {
          body: { blocks: list, energy_preference: profile?.energy_preference || "morning" },
        });
        if (data?.insight) setInsight(data.insight);
      } catch {/* ignore */}
    })();
  }, [user?.id, profile?.energy_preference]);

  const tasks = blocks.filter(b => b.kind === "task");
  const done = tasks.filter(b => b.completed).length;
  const focusMin = tasks.filter(b => b.completed && b.type === "deep_work").reduce((s, b) => s + b.duration_min, 0);
  const plannedMin = tasks.reduce((s, b) => s + b.duration_min, 0);
  const completedMin = tasks.filter(b => b.completed).reduce((s, b) => s + b.duration_min, 0);
  const eff = plannedMin ? Math.round((completedMin / plannedMin) * 100) : 0;
  const fh = Math.floor(focusMin / 60), fm = focusMin % 60;

  // "Forgot to track?" — completed focus minutes vs tracked seconds today
  const completedFocusSec = tasks.filter(b => b.completed).reduce((s, b) => s + b.duration_min * 60, 0);
  const showRecover = !backfilled && completedFocusSec >= 30 * 60 && todayTotalSec < completedFocusSec * 0.5;

  const backfill = async () => {
    if (!user) return;
    const cat = categories.find(c => c.is_default) || categories[0];
    if (!cat) { toast.error("No category found"); return; }
    const completed = tasks.filter(b => b.completed);
    const now = new Date();
    // Sequentially place blocks ending now, going backwards
    let cursor = now.getTime();
    const rows = completed.map((b) => {
      const end = new Date(cursor);
      cursor -= b.duration_min * 60 * 1000;
      const start = new Date(cursor);
      return {
        user_id: user.id,
        category_id: cat.id,
        started_at: start.toISOString(),
        ended_at: end.toISOString(),
        source: "recap",
        block_id: b.id,
        note: b.title,
      };
    });
    if (!rows.length) return;
    const { error } = await supabase.from("time_entries").insert(rows);
    if (error) { toast.error(error.message); return; }
    setBackfilled(true);
    await refreshTracker();
    toast.success("Tracked time recorded");
  };

  return (
    <Shell>
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-72 pointer-events-none" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative px-6 pt-16">
          <h1 className="text-[34px] font-semibold leading-tight">Day complete.</h1>
          <p className="text-secondary-fg mt-1">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>

          <div className="grid grid-cols-3 gap-3 mt-8">
            <Stat label="Tasks done" value={`${done}/${tasks.length}`} />
            <Stat label="Focus time" value={`${fh}h ${fm}m`} />
            <Stat label="Efficiency" value={`${eff}%`} />
          </div>

          {showRecover && (
            <button
              onClick={backfill}
              className="mt-6 w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-primary/30 bg-primary/5 text-left pressable"
            >
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">Forgot to track today?</div>
                <div className="text-xs text-secondary-fg">You only tracked {fmtHM(todayTotalSec)} but completed {fh}h {fm}m of focus. Tap to credit it.</div>
              </div>
              <span className="text-xs font-semibold text-primary shrink-0">Credit →</span>
            </button>
          )}

          <div className="mt-6 rounded-2xl bg-surface-elevated border border-border shadow-card p-4">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Today's insight</span>
            </div>
            <p className="text-[15px] leading-relaxed mt-2">
              {insight || "Reflecting on your day..."}
            </p>
          </div>

          <div className="mt-8">
            <div className="text-sm text-secondary-fg mb-2">Tomorrow looks like →</div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {["Plan tomorrow's top tasks", "Protect your peak hours", "Batch your comms"].map(t => (
                <div key={t} className="shrink-0 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg">{t}</div>
              ))}
            </div>
          </div>

          <div className="mt-10 space-y-3">
            <Button onClick={() => nav("/today")} className="w-full h-13 py-3.5 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
              style={{ background: "var(--gradient-primary)" }}>
              Plan Tomorrow
            </Button>
            <button onClick={() => nav("/recap/week")} className="w-full text-primary text-sm hover:underline">
              See your week →
            </button>
            <button onClick={() => nav("/today")} className="w-full text-secondary-fg text-sm hover:text-foreground transition-colors">
              Done for today
            </button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl bg-surface border border-border p-3 text-center shadow-card">
    <div className="text-xl font-semibold">{value}</div>
    <div className="text-[11px] text-secondary-fg mt-1 leading-tight">{label}</div>
  </div>
);
