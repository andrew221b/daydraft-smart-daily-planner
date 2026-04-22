import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { useStreak } from "@/hooks/useStreak";
import { supabase } from "@/integrations/supabase/client";
import { Block } from "@/lib/daydraft";
import { Flame, Target, Clock, Trophy, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export default function RecapWeek() {
  const { user } = useAuth();
  const { streak } = useStreak();
  const nav = useNavigate();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [planDays, setPlanDays] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const since = new Date(); since.setDate(since.getDate() - 6);
      const { data: plans } = await supabase.from("plans").select("id, date").eq("user_id", user.id).gte("date", dateKey(since));
      const ids = (plans || []).map((p: any) => p.id);
      setPlanDays((plans || []).map((p: any) => p.date));
      if (!ids.length) { setBlocks([]); return; }
      const { data: bs } = await supabase.from("blocks").select("*").in("plan_id", ids);
      setBlocks((bs || []) as Block[]);
    })();
  }, [user?.id]);

  const stats = useMemo(() => {
    const tasks = blocks.filter(b => b.kind === "task");
    const completed = tasks.filter(b => b.completed);
    const focusMin = completed.filter(b => b.type === "deep_work").reduce((s, b) => s + b.duration_min, 0);
    const completionPct = tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0;
    const typeMin: Record<string, number> = { deep_work: 0, communication: 0, routine: 0 };
    completed.forEach(b => { typeMin[b.type] = (typeMin[b.type] || 0) + b.duration_min; });
    const top = Object.entries(typeMin).sort((a, b) => b[1] - a[1])[0];
    const topLabel = top && top[1] > 0
      ? (top[0] === "deep_work" ? "Deep Work" : top[0] === "communication" ? "Communication" : "Routine")
      : "—";
    return { focusMin, completionPct, topLabel, planned: tasks.length, done: completed.length };
  }, [blocks]);

  const fh = Math.floor(stats.focusMin / 60), fm = stats.focusMin % 60;

  return (
    <Shell>
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-72 pointer-events-none" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative px-6 pt-16">
          <h1 className="text-[34px] font-semibold leading-tight">Your week.</h1>
          <p className="text-secondary-fg mt-1">Last 7 days at a glance</p>

          <div className="grid grid-cols-2 gap-3 mt-8">
            <Card icon={<Clock className="h-4 w-4" />} label="Focus time" value={`${fh}h ${fm}m`} />
            <Card icon={<Target className="h-4 w-4" />} label="Completion" value={`${stats.completionPct}%`} sub={`${stats.done}/${stats.planned}`} />
            <Card icon={<Trophy className="h-4 w-4" />} label="Top category" value={stats.topLabel} />
            <Card icon={<Flame className="h-4 w-4" />} label="Streak" value={`${streak?.current_streak ?? 0} days`} sub={`Best ${streak?.longest_streak ?? 0}`} />
          </div>

          <div className="mt-8">
            <div className="text-xs text-secondary-fg uppercase tracking-wide mb-2">Days you planned</div>
            <div className="flex gap-1.5">
              {Array.from({ length: 7 }).map((_, i) => {
                const d = new Date(); d.setDate(d.getDate() - (6 - i));
                const k = dateKey(d);
                const planned = planDays.includes(k);
                const label = d.toLocaleDateString(undefined, { weekday: "short" })[0];
                return (
                  <div key={k} className="flex-1 flex flex-col items-center gap-1">
                    <div className={`h-10 w-full rounded-lg ${planned ? "bg-primary shadow-glow" : "bg-surface border border-border"}`} />
                    <span className="text-[10px] text-secondary-fg">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <Button onClick={() => nav("/today")} className="w-full mt-10 h-13 py-3.5 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
            style={{ background: "var(--gradient-primary)" }}>
            Plan today <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </Shell>
  );
}

const Card = ({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) => (
  <div className="rounded-2xl bg-surface border border-border p-4 shadow-card">
    <div className="flex items-center gap-1.5 text-secondary-fg text-[11px] uppercase tracking-wide">
      {icon}<span>{label}</span>
    </div>
    <div className="text-2xl font-semibold mt-2">{value}</div>
    {sub && <div className="text-xs text-secondary-fg mt-0.5">{sub}</div>}
  </div>
);