import { useEffect, useState } from "react";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export default function Stats() {
  const { user } = useAuth();
  const [days, setDays] = useState<{ date: string; focusMin: number; done: number; total: number }[]>([]);
  const [breakdown, setBreakdown] = useState({ deep_work: 0, communication: 0, routine: 0 });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const since = new Date(); since.setDate(since.getDate() - 6);
      const { data: ps } = await supabase.from("plans").select("id,date").eq("user_id", user.id)
        .gte("date", since.toISOString().slice(0,10)).order("date");
      const planIds = (ps || []).map(p => p.id);
      const { data: bs } = planIds.length
        ? await supabase.from("blocks").select("*").in("plan_id", planIds)
        : { data: [] as any[] };
      const byPlan: Record<string, any[]> = {};
      (bs || []).forEach((b: any) => { (byPlan[b.plan_id] ||= []).push(b); });
      const out: typeof days = [];
      const counts = { deep_work: 0, communication: 0, routine: 0 } as any;
      (ps || []).forEach(p => {
        const items = byPlan[p.id] || [];
        const tasks = items.filter((b: any) => b.kind === "task");
        out.push({
          date: p.date,
          focusMin: tasks.filter((b: any) => b.completed && b.type === "deep_work").reduce((s: number, b: any) => s + b.duration_min, 0),
          done: tasks.filter((b: any) => b.completed).length,
          total: tasks.length,
        });
        tasks.forEach((b: any) => { counts[b.type] = (counts[b.type] || 0) + b.duration_min; });
      });
      setDays(out);
      setBreakdown(counts);
    })();
  }, [user?.id]);

  const maxFocus = Math.max(60, ...days.map(d => d.focusMin));
  const totalBreak = breakdown.deep_work + breakdown.communication + breakdown.routine || 1;

  return (
    <Shell>
      <div className="px-6 pt-14">
        <h1 className="text-[28px] font-semibold">Stats</h1>
        <p className="text-secondary-fg text-sm mt-1">Last 7 days.</p>

        <div className="mt-8 rounded-2xl bg-surface border border-border shadow-card p-5">
          <div className="text-xs text-secondary-fg uppercase tracking-wider mb-4">Focus minutes</div>
          <div className="flex items-end gap-2 h-32">
            {days.length === 0 ? <div className="text-secondary-fg text-sm">No data yet.</div> :
              days.map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
                  <div className="w-full bg-primary/80 rounded-t-md" style={{ height: `${(d.focusMin / maxFocus) * 100}%`, minHeight: 2 }} />
                  <div className="text-[10px] text-secondary-fg">{new Date(d.date).toLocaleDateString(undefined, { weekday: "short" })[0]}</div>
                </div>
              ))}
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-surface border border-border shadow-card p-5">
          <div className="text-xs text-secondary-fg uppercase tracking-wider mb-4">Type breakdown</div>
          <div className="h-3 rounded-full overflow-hidden bg-surface-elevated flex">
            <div style={{ width: `${(breakdown.deep_work/totalBreak)*100}%`, background: "hsl(var(--type-deep))" }} />
            <div style={{ width: `${(breakdown.communication/totalBreak)*100}%`, background: "hsl(var(--type-comm))" }} />
            <div style={{ width: `${(breakdown.routine/totalBreak)*100}%`, background: "hsl(var(--type-routine))" }} />
          </div>
          <div className="flex justify-between text-xs text-secondary-fg mt-3">
            <Legend color="hsl(var(--type-deep))" label="Deep" />
            <Legend color="hsl(var(--type-comm))" label="Comms" />
            <Legend color="hsl(var(--type-routine))" label="Routine" />
          </div>
        </div>
      </div>
    </Shell>
  );
}

const Legend = ({ color, label }: { color: string; label: string }) => (
  <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</div>
);
