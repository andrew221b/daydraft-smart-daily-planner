import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Block, dateStr, isUserTask } from "@/lib/daydraft";
import { CalendarDays, Target, Clock, Trophy, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isAiFlagEnabled, writeAiWeeklyMemory } from "@/lib/aiRuntime";

// Local date key — UTC slice would shift bars a day in negative offsets.
const dateKey = (d: Date) => dateStr(d);

export default function RecapWeek() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [planDays, setPlanDays] = useState<string[]>([]);
  const [trackedSec, setTrackedSec] = useState(0);

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
      const { data: entries } = await supabase
        .from("time_entries")
        .select("started_at,ended_at")
        .eq("user_id", user.id)
        .gte("started_at", since.toISOString());
      const sec = (entries || []).reduce((sum: number, row: any) => {
        const s = new Date(row.started_at).getTime();
        const e = row.ended_at ? new Date(row.ended_at).getTime() : Date.now();
        return sum + Math.max(0, (e - s) / 1000);
      }, 0);
      setTrackedSec(sec);
    })();
  }, [user?.id]);

  const stats = useMemo(() => {
    const tasks = blocks.filter(isUserTask);
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

  const plannedDoneSec = stats.focusMin * 60;
  const fh = Math.floor(stats.focusMin / 60), fm = stats.focusMin % 60;
  const aiWeeklyMemoryEnabled = isAiFlagEnabled("aiWeeklyMemory", user?.id);
  const memory = useMemo(() => {
    const tasks = blocks.filter(isUserTask);
    const completed = tasks.filter((b) => b.completed);
    const byHour = new Array(24).fill(0);
    completed.forEach((b) => {
      const h = Number((b.start_time || "00:00").slice(0, 2)) || 0;
      byHour[h] += b.duration_min || 0;
    });
    const bestHour = byHour.reduce((best, val, idx) => (val > byHour[best] ? idx : best), 0);
    const completedMins = completed.map((b) => b.duration_min || 0).filter((m) => m > 0);
    const realisticBlock = completedMins.length
      ? Math.round(completedMins.sort((a, b) => a - b)[Math.floor(completedMins.length / 2)])
      : 45;
    const unfinished = tasks.filter((b) => !b.completed);
    const commonSlip = unfinished.length
      ? unfinished.filter((b) => b.type === "deep_work").length >= unfinished.filter((b) => b.type !== "deep_work").length
        ? "Deep work blocks are over-ambitious late in the day."
        : "Lower-priority tasks are crowding your core work."
      : "No major slip pattern this week.";
    return {
      generated_at: new Date().toISOString(),
      best_focus_hours: `${String(bestHour).padStart(2, "0")}:00-${String((bestHour + 2) % 24).padStart(2, "0")}:00`,
      realistic_block_min: Math.max(25, Math.min(90, realisticBlock)),
      common_slip: commonSlip,
      recommendation:
        stats.completionPct < 65
          ? "Trim daily scope by 15-20% and keep first block high-priority."
          : "Keep your first focus block protected and batch communication later.",
    };
  }, [blocks, stats.completionPct]);

  useEffect(() => {
    if (!aiWeeklyMemoryEnabled) return;
    writeAiWeeklyMemory(memory);
  }, [aiWeeklyMemoryEnabled, memory]);

  return (
    <Shell>
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-52 pointer-events-none" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative px-6 pt-14">
          <h1 className="font-display text-[26px] font-semibold leading-tight text-balance">Your week</h1>
          <p className="text-[13px] text-secondary-fg mt-2 leading-relaxed">Last 7 days at a glance</p>

          <div className="grid grid-cols-2 gap-3 mt-9">
            <Card icon={<Clock className="h-4 w-4" />} label="Planned focus" value={`${fh}h ${fm}m`} />
            <Card icon={<Clock className="h-4 w-4" />} label="Actual tracked" value={trackedSec < 3600 ? `${Math.round(trackedSec / 60)}m` : `${Math.floor(trackedSec / 3600)}h ${Math.floor((trackedSec % 3600) / 60)}m`} />
            <Card icon={<Target className="h-4 w-4" />} label="Completion" value={`${stats.completionPct}%`} sub={`${stats.done}/${stats.planned}`} />
            <Card icon={<Trophy className="h-4 w-4" />} label="Top category" value={stats.topLabel} />
            <Card icon={<CalendarDays className="h-4 w-4" />} label="Days planned" value={`${planDays.length}/7`} sub={planDays.length === 7 ? "Every day" : "this week"} />
          </div>
          <p className="mt-3 text-[11px] text-secondary-fg">
            Planned completed focus: {Math.round(plannedDoneSec / 60)}m · Actual tracked: {Math.round(trackedSec / 60)}m.
          </p>

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
                    <div className={`h-10 w-full rounded-lg ${planned ? "bg-primary" : "surface-card border border-soft"}`} />
                    <span className="text-[10px] text-secondary-fg">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {aiWeeklyMemoryEnabled && (
            <div className="mt-7 app-card px-4 py-5">
              <div className="eyebrow text-primary">AI learned this week</div>
              <div className="mt-2 text-[14px] text-foreground">
                Best focus window: <span className="font-mono">{memory.best_focus_hours}</span>
              </div>
              <div className="mt-1 text-[13px] text-secondary-fg">
                Realistic block size: ~{memory.realistic_block_min}m
              </div>
              <div className="mt-1.5 text-[12px] text-secondary-fg">{memory.common_slip}</div>
              <div className="mt-2 text-[12px] text-foreground">{memory.recommendation}</div>
            </div>
          )}

          <Button onClick={() => nav("/today")} className="w-full mt-10 h-13 py-3.5 rounded-xl bg-primary hover:bg-primary/92 text-primary-foreground text-[15px] font-medium pressable shadow-card"
           >
            Plan today <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </Shell>
  );
}

const Card = ({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) => (
  <div className="app-card px-4 py-5">
    <div className="flex items-center gap-1.5 text-secondary-fg">
      <span className="text-primary/90">{icon}</span>
      <span className="eyebrow">{label}</span>
    </div>
    <div className="font-display text-[22px] font-semibold tabular-nums mt-2 leading-tight">{value}</div>
    {sub && <div className="text-[11px] text-secondary-fg mt-1">{sub}</div>}
  </div>
);