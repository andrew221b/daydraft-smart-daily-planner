import { useEffect, useState } from "react";
import { Shell } from "@/components/app/Shell";
import { PageHeader } from "@/components/app/PageHeader";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { parseDateStr, todayDateStr, isUserTask, dateStr } from "@/lib/daydraft";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, CalendarDays, Timer as TimerIcon, Target } from "lucide-react";
import { useTimeTracker, fmtHM } from "@/hooks/useTimeTracker";
import { KpiCard } from "@/components/app/KpiCard";

interface BlockLite { plan_id: string; kind: string; completed: boolean; title: string; is_calendar_event?: boolean | null; }
interface PlanRow {
  id: string;
  date: string;
  ai_summary: string | null;
  total: number;
  done: number;
  preview: string;
  plannedDoneMin: number;
  trackedSec: number;
}

export default function History() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { weekTotalSec, todayTotalSec } = useTimeTracker();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: rawPlans } = await supabase
      .from("plans")
      .select("id,date,ai_summary")
      .eq("user_id", user.id)
      .lte("date", todayDateStr())  // Hide future "drafts" from history — they belong on the planner.
      .order("date", { ascending: false })
      .limit(60);
    const list = (rawPlans || []) as { id: string; date: string; ai_summary: string | null }[];
    if (!list.length) { setPlans([]); setLoading(false); return; }
    const ids = list.map(p => p.id);
    const since = parseDateStr(list[list.length - 1]?.date || todayDateStr());
    since.setHours(0, 0, 0, 0);
    const [{ data: blocks }, { data: entries }] = await Promise.all([
      supabase
        .from("blocks")
        .select("plan_id,kind,completed,title,position,is_calendar_event,duration_min")
        .in("plan_id", ids)
        .order("position"),
      supabase
        .from("time_entries")
        .select("started_at,ended_at")
        .eq("user_id", user.id)
        .gte("started_at", since.toISOString()),
    ]);
    const trackedByDate = new Map<string, number>();
    (entries || []).forEach((e: any) => {
      const s = new Date(e.started_at).getTime();
      const en = e.ended_at ? new Date(e.ended_at).getTime() : Date.now();
      if (!Number.isFinite(s) || !Number.isFinite(en) || en <= s) return;
      let cursor = s;
      while (cursor < en) {
        const d = new Date(cursor);
        d.setHours(0, 0, 0, 0);
        const dayStart = d.getTime();
        const dayEnd = dayStart + 86_400_000;
        const clippedEnd = Math.min(en, dayEnd);
        const sec = Math.max(0, (clippedEnd - cursor) / 1000);
        const key = dateStr(new Date(dayStart));
        trackedByDate.set(key, (trackedByDate.get(key) || 0) + sec);
        cursor = clippedEnd;
      }
    });
    const byPlan = new Map<string, BlockLite[]>();
    (blocks || []).forEach((b: any) => {
      if (!byPlan.has(b.plan_id)) byPlan.set(b.plan_id, []);
      byPlan.get(b.plan_id)!.push(b as BlockLite);
    });
    // Hide orphaned plans in UI only.
    // Read-path must never mutate user data from a client screen.
    const orphans = list.filter(p => !(byPlan.get(p.id) || []).length).map(p => p.id);
    const enriched: PlanRow[] = list
      .filter(p => !orphans.includes(p.id))
      .map(p => {
        const bs = byPlan.get(p.id) || [];
        const tasks = bs.filter(b => isUserTask(b));
        const done = tasks.filter(b => b.completed).length;
        const plannedDoneMin = tasks
          .filter((b) => b.completed)
          .reduce((s, b) => s + (((b as any).duration_min as number) || 0), 0);
        const preview = tasks.slice(0, 3).map(t => t.title).filter(Boolean).join(" · ");
        return {
          id: p.id,
          date: p.date,
          ai_summary: p.ai_summary,
          total: tasks.length,
          done,
          preview,
          plannedDoneMin,
          trackedSec: trackedByDate.get(p.date) || 0,
        };
      });
    setPlans(enriched);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  // Group by ISO week (Mon–Sun), labeled by the Monday of that week.
  const groups: Record<string, PlanRow[]> = {};
  plans.forEach(p => {
    const d = parseDateStr(p.date);
    // Mon=0..Sun=6 — align week start to Monday for international consistency.
    const monOffset = (d.getDay() + 6) % 7;
    const start = new Date(d); start.setDate(d.getDate() - monOffset);
    const key = `Week of ${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    (groups[key] ||= []).push(p);
  });

  const todayKey = todayDateStr();

  // Roll-up across the last 7 plan rows (recent activity)
  const last7 = plans.slice(0, 7);
  const totalTasks = last7.reduce((s, p) => s + p.total, 0);
  const totalDone = last7.reduce((s, p) => s + p.done, 0);
  const completionPct = totalTasks ? Math.round((totalDone / totalTasks) * 100) : 0;

  return (
    <Shell>
      <PullToRefresh onRefresh={async () => { await load(); }}>
      <div className="px-5 pt-10">
        <div className="hero-glass p-5 md:p-6">
          <PageHeader
            eyebrow="Your week"
            title="History"
            hint="Planned days and tracked time. Tap a day for recap — only tasks you mark done count toward completion; open items stay open."
          />
        </div>

        {/* At-a-glance — the only numbers a busy person actually needs */}
        <div className="mt-6 grid grid-cols-3 gap-3 section-switch-stagger">
          <KpiCard
            icon={<TimerIcon className="h-3.5 w-3.5" />}
            label="Tracked this week"
            value={fmtHM(weekTotalSec)}
            sub={`${fmtHM(todayTotalSec)} today`}
            tone="primary"
            onClick={() => nav("/tracker")}
          />
          <KpiCard
            icon={<Target className="h-3.5 w-3.5" />}
            label="Tasks done"
            value={`${completionPct}%`}
            sub={`${totalDone} of ${totalTasks} planned`}
          />
          <KpiCard
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            label="Days planned"
            value={`${plans.length}`}
            sub="Last 60 days"
          />
        </div>

        <div className="mt-10 eyebrow">Recent days</div>

        {loading && (
          <div className="mt-3 space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-[88px] rounded-2xl surface-card border border-soft animate-pulse" />
            ))}
          </div>
        )}
        {!loading && (
          <div className="mt-4 space-y-8">
            {Object.entries(groups).map(([w, items]) => (
              <div key={w}>
                <div className="eyebrow mb-2.5">{w}</div>
                <div className="space-y-2">
                  {items.map(p => {
                    const isToday = p.date === todayKey;
                    const completionPct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                    const allDone = p.total > 0 && p.done === p.total;
                    // ALL day rows route to Recap (read-only reflection +
                    // AI insight). History is for looking back, never for
                    // resuming work — that path is on the Today screen.
                    const goTo = `/recap?date=${p.date}`;
                    return (
                      <div
                        key={p.id}
                        className="app-card p-0 flex overflow-hidden hover:border-primary/25 transition-colors border-soft"
                      >
                        <button
                          type="button"
                          onClick={() => nav(goTo)}
                          className="flex-1 text-left p-4 pressable min-w-0"
                        >
                          <div className="flex items-center gap-2">
                            {allDone ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 text-faint shrink-0" />
                            )}
                            <div className="text-[11.5px] text-secondary-fg font-medium">
                              {parseDateStr(p.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                              {isToday && <span className="ml-2 eyebrow text-primary">Today</span>}
                            </div>
                          </div>
                          <div className="mt-1.5 text-[14px] line-clamp-2 leading-snug font-display">
                            {p.ai_summary || p.preview || `${p.total} task${p.total === 1 ? "" : "s"}`}
                          </div>
                          <div className="mt-3 flex items-center justify-between text-[11px] text-secondary-fg">
                            <span>
                              <span className="text-foreground font-medium">{p.done}</span>
                              <span className="text-secondary-fg">/{p.total}</span>
                              {" tasks done"}
                            </span>
                            <span className={`tabular-nums ${allDone ? "text-success font-medium" : ""}`}>{completionPct}%</span>
                          </div>
                          <div className="mt-1 text-[10.5px] text-secondary-fg">
                            Planned done: {Math.round(p.plannedDoneMin)}m · Actual tracked: {fmtHM(p.trackedSec)}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {plans.length === 0 && (
              <div className="text-center py-20">
                <CalendarDays className="h-8 w-8 text-faint mx-auto mb-3" />
                <div className="font-display text-[16px] font-medium">No plans yet</div>
                <p className="text-[12.5px] text-secondary-fg mt-1.5">Plan a day and your insights will appear here.</p>
                <button
                  onClick={() => nav("/today")}
                  className="mt-5 text-[13px] text-primary font-medium hover:underline"
                >
                  Design today →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      </PullToRefresh>
    </Shell>
  );
}
