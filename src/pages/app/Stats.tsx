import { useEffect, useState } from "react";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useTimeTracker, fmtHM } from "@/hooks/useTimeTracker";
import { dateStr, isUserTask } from "@/lib/daydraft";

export default function Stats() {
  const { user } = useAuth();
  const { categories, todayTotalSec, weekTotalSec } = useTimeTracker();
  const [days, setDays] = useState<{ date: string; focusMin: number; done: number; total: number }[]>([]);
  const [breakdown, setBreakdown] = useState({ deep_work: 0, communication: 0, routine: 0 });
  const [trackedDays, setTrackedDays] = useState<{ date: string; sec: number }[]>([]);
  const [byCategory, setByCategory] = useState<{ id: string; name: string; color: string; sec: number }[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const since = new Date(); since.setDate(since.getDate() - 6);
      // Local date — UTC would shift the window in negative-offset timezones.
      const { data: ps } = await supabase.from("plans").select("id,date").eq("user_id", user.id)
        .gte("date", dateStr(since)).order("date");
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
        const tasks = items.filter((b: any) => isUserTask(b));
        out.push({
          date: p.date,
          focusMin: tasks.filter((b: any) => b.completed && b.type === "deep_work").reduce((s: number, b: any) => s + b.duration_min, 0),
          done: tasks.filter((b: any) => b.completed).length,
          total: tasks.length,
        });
        tasks
          .filter((b: any) => b.completed)
          .forEach((b: any) => { counts[b.type] = (counts[b.type] || 0) + b.duration_min; });
      });
      setDays(out);
      setBreakdown(counts);

      // Tracked time over last 7 days
      const sinceTracked = new Date(); sinceTracked.setDate(sinceTracked.getDate() - 6); sinceTracked.setHours(0,0,0,0);
      const { data: ents } = await supabase
        .from("time_entries")
        .select("category_id,started_at,ended_at")
        .eq("user_id", user.id)
        .gte("started_at", sinceTracked.toISOString());
      // Use LOCAL ymd, not toISOString().slice(0,10) which produces UTC keys.
      // Otherwise an evening session in a UTC- timezone gets bucketed into the
      // following day, and the bars don't match the user's lived experience.
      const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const dayMap: Record<string, number> = {};
      const now = Date.now();
      (ents || []).forEach((e: any) => {
        // Distribute durations across day boundaries so a session that crosses
        // midnight is split between both days correctly.
        let cursor = new Date(e.started_at).getTime();
        const end = e.ended_at ? new Date(e.ended_at).getTime() : now;
        while (cursor < end) {
          const d = new Date(cursor);
          const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
          const dayEnd = dayStart + 86_400_000;
          const slice = Math.min(end, dayEnd) - cursor;
          if (slice > 0) dayMap[ymd(d)] = (dayMap[ymd(d)] || 0) + slice / 1000;
          cursor = dayEnd;
        }
      });
      const arr: { date: string; sec: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        arr.push({ date: ymd(d), sec: dayMap[ymd(d)] || 0 });
      }
      setTrackedDays(arr);
    })();
  }, [user?.id]);

  useEffect(() => {
    // recompute category breakdown when entries-derived weekTotalSec changes or categories load
    if (!user || !categories.length) return;
    (async () => {
      const sinceCat = new Date(); sinceCat.setDate(sinceCat.getDate() - 6); sinceCat.setHours(0,0,0,0);
      const { data: ents } = await supabase
        .from("time_entries")
        .select("category_id,started_at,ended_at")
        .eq("user_id", user.id)
        .gte("started_at", sinceCat.toISOString());
      const catMap: Record<string, number> = {};
      const now = Date.now();
      (ents || []).forEach((e: any) => {
        if (!e.category_id) return;
        const s = new Date(e.started_at).getTime();
        const en = e.ended_at ? new Date(e.ended_at).getTime() : now;
        catMap[e.category_id] = (catMap[e.category_id] || 0) + Math.max(0, (en - s) / 1000);
      });
      setByCategory(categories.map(c => ({ id: c.id, name: c.name, color: c.color, sec: catMap[c.id] || 0 })).filter(x => x.sec > 0).sort((a, b) => b.sec - a.sec));
    })();
  }, [user?.id, categories.length, weekTotalSec]);

  const maxFocus = Math.max(60, ...days.map(d => d.focusMin));
  const totalBreak = breakdown.deep_work + breakdown.communication + breakdown.routine || 1;
  const maxTracked = Math.max(3600, ...trackedDays.map(d => d.sec));
  const totalCatSec = byCategory.reduce((s, c) => s + c.sec, 0) || 1;

  return (
    <Shell>
      <div className="px-6 pt-12">
        <div className="flex items-end justify-between">
          <div>
            <p className="eyebrow">Last 7 days</p>
            <h1 className="font-display text-[26px] font-semibold mt-2 tracking-tight text-balance">Stats</h1>
          </div>
          <a href="/recap/week" className="text-[12px] text-primary hover:underline font-medium">Week recap →</a>
        </div>

        <div className="mt-8 app-card p-5">
          <div className="eyebrow mb-4">Focus minutes</div>
          <div className="flex items-end gap-2 h-32">
            {days.length === 0 ? <div className="text-secondary-fg text-sm">No data yet.</div> :
              days.map(d => {
                // parse YYYY-MM-DD as LOCAL — `new Date("YYYY-MM-DD")` is UTC.
                const [y, mo, da] = d.date.split("-").map(Number);
                const localDate = new Date(y, (mo || 1) - 1, da || 1);
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full bg-primary rounded-md" style={{ height: `${(d.focusMin / maxFocus) * 100}%`, minHeight: 2 }} />
                    <div className="text-[10px] text-secondary-fg font-medium">{localDate.toLocaleDateString(undefined, { weekday: "short" })[0]}</div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="mt-3 app-card p-5">
          <div className="eyebrow mb-3">Completed time by type</div>
          <div className="h-2 rounded-full overflow-hidden bg-muted flex">
            <div style={{ width: `${(breakdown.deep_work/totalBreak)*100}%`, background: "hsl(var(--type-deep))" }} />
            <div style={{ width: `${(breakdown.communication/totalBreak)*100}%`, background: "hsl(var(--type-comm))" }} />
            <div style={{ width: `${(breakdown.routine/totalBreak)*100}%`, background: "hsl(var(--type-routine))" }} />
          </div>
          <div className="flex justify-between text-[11px] text-secondary-fg mt-3">
            <Legend color="hsl(var(--type-deep))" label="Deep" />
            <Legend color="hsl(var(--type-comm))" label="Comms" />
            <Legend color="hsl(var(--type-routine))" label="Routine" />
          </div>
        </div>

        <div className="mt-3 app-card p-5">
          <div className="flex items-end justify-between mb-3">
            <div className="eyebrow">Tracked hours</div>
            <div className="text-right">
              <div className="font-display text-[20px] font-semibold tabular-nums">{fmtHM(todayTotalSec)}</div>
              <div className="text-[10px] text-secondary-fg leading-none">today</div>
            </div>
          </div>
          <div className="flex items-end gap-2 h-24">
            {trackedDays.length === 0 ? (
              <div className="text-secondary-fg text-sm">No tracked time yet.</div>
            ) : (
              trackedDays.map(d => {
                const [y, mo, da] = d.date.split("-").map(Number);
                const localDate = new Date(y, (mo || 1) - 1, da || 1);
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full rounded-md" style={{ height: `${(d.sec / maxTracked) * 100}%`, minHeight: 2, background: "hsl(var(--primary))" }} />
                    <div className="text-[10px] text-secondary-fg font-medium">{localDate.toLocaleDateString(undefined, { weekday: "short" })[0]}</div>
                  </div>
                );
              })
            )}
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-secondary-fg">
            <span>Last 7 days</span>
            <span className="text-foreground font-medium tabular-nums">{fmtHM(weekTotalSec)} total</span>
          </div>

          {byCategory.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border space-y-2">
              <div className="eyebrow">By category</div>
              {byCategory.map(c => (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: c.color }} />
                      <span className="truncate">{c.name}</span>
                    </div>
                    <span className="tabular-nums text-foreground font-medium ml-2 shrink-0">{fmtHM(c.sec)}</span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(c.sec / totalCatSec) * 100}%`, background: c.color }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

const Legend = ({ color, label }: { color: string; label: string }) => (
  <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</div>
);
