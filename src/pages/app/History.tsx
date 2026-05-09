import { useEffect, useMemo, useState } from "react";
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

interface BlockLite {
  id: string;
  plan_id: string;
  kind: string;
  completed: boolean;
  title: string;
  block_type?: "work" | "personal" | "rest" | string | null;
  is_calendar_event?: boolean | null;
  duration_min?: number | null;
}
interface PlanRow {
  id: string;
  date: string;
  total: number;
  done: number;
  plannedTaskMin: number;
  doneByLabel: string | null;
  plannedDoneMin: number;
  trackedSec: number;
}
type WeeklyCategoryRow = { name: string; sec: number; type: "work" | "personal" | "rest" };

export default function History() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { weekTotalSec, todayTotalSec } = useTimeTracker();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [weekCategoryRows, setWeekCategoryRows] = useState<WeeklyCategoryRow[]>([]);
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
        .select("id,plan_id,kind,completed,title,position,is_calendar_event,duration_min,block_type,completed_at")
        .in("plan_id", ids)
        .order("position"),
      supabase
        .from("time_entries")
        .select("started_at,ended_at,block_id")
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
    const blockById = new Map<string, BlockLite>();
    (blocks || []).forEach((b: any) => {
      if (!byPlan.has(b.plan_id)) byPlan.set(b.plan_id, []);
      const row = b as BlockLite;
      byPlan.get(b.plan_id)!.push(row);
      blockById.set(row.id, row);
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
        const plannedTaskMin = tasks.reduce((s, b) => s + (((b as any).duration_min as number) || 0), 0);
        const plannedDoneMin = tasks
          .filter((b) => b.completed)
          .reduce((s, b) => s + (((b as any).duration_min as number) || 0), 0);
        const latestCompletedAt = tasks
          .map((b) => (b as any).completed_at as string | null | undefined)
          .filter(Boolean)
          .sort()
          .pop();
        const doneByLabel = latestCompletedAt
          ? new Date(latestCompletedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : null;
        return {
          id: p.id,
          date: p.date,
          total: tasks.length,
          done,
          plannedTaskMin,
          doneByLabel,
          plannedDoneMin,
          trackedSec: trackedByDate.get(p.date) || 0,
        };
      });
    const since7 = new Date();
    since7.setDate(since7.getDate() - 6);
    since7.setHours(0, 0, 0, 0);
    const weeklyByCategory = new Map<string, WeeklyCategoryRow>();
    (entries || []).forEach((e: any) => {
      const s = new Date(e.started_at).getTime();
      const en = e.ended_at ? new Date(e.ended_at).getTime() : Date.now();
      if (!Number.isFinite(s) || !Number.isFinite(en) || en <= s) return;
      if (en < since7.getTime()) return;
      const clippedStart = Math.max(s, since7.getTime());
      const sec = Math.max(0, (en - clippedStart) / 1000);
      if (!sec) return;
      const b = e.block_id ? blockById.get(e.block_id) : null;
      const name = (b?.title || "Other tracked").trim();
      const type: "work" | "personal" | "rest" =
        b?.block_type === "personal" || b?.block_type === "rest" || b?.block_type === "work"
          ? b.block_type
          : b?.kind === "break" || b?.kind === "lunch"
            ? "rest"
            : "work";
      const cur = weeklyByCategory.get(name) || { name, sec: 0, type };
      cur.sec += sec;
      weeklyByCategory.set(name, cur);
    });
    const sortedWeekly = Array.from(weeklyByCategory.values()).sort((a, b) => b.sec - a.sec);
    const top = sortedWeekly.slice(0, 5);
    if (sortedWeekly.length > 5) {
      const otherSec = sortedWeekly.slice(5).reduce((s, r) => s + r.sec, 0);
      if (otherSec > 0) top.push({ name: "Other", sec: otherSec, type: "work" });
    }
    setWeekCategoryRows(top);
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
  const weekMaxCategorySec = useMemo(() => Math.max(1, ...weekCategoryRows.map((r) => r.sec)), [weekCategoryRows]);
  const mostTracked = weekCategoryRows[0] || null;
  const leastTracked = weekCategoryRows.length ? [...weekCategoryRows].sort((a, b) => a.sec - b.sec)[0] : null;
  const toneFor = (t: "work" | "personal" | "rest") =>
    t === "work" ? "bg-cyan-400/90" : t === "personal" ? "bg-violet-400/90" : "bg-slate-400/85";

  return (
    <Shell>
      <PullToRefresh onRefresh={async () => { await load(); }}>
      <div className="px-5 pt-10">
        <div className="hero-glass px-4.5 pt-4.5 pb-4 md:px-5 md:pt-5 md:pb-4.5 py-5">
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

        <div className="mt-8 eyebrow">Recent days</div>
        {!loading && weekCategoryRows.length > 0 && (
          <div className="mt-4 app-card px-3.5 py-5">
            <div className="text-[11px] uppercase tracking-[0.12em] text-secondary-fg mb-3">Last 7 days by category</div>
            <div className="space-y-2.5">
              {weekCategoryRows.map((row) => (
                <div key={row.name} className="flex items-center gap-2">
                  <div className="w-24 truncate text-[12px] text-foreground">{row.name}</div>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${toneFor(row.type)} transition-all duration-500`}
                      style={{ width: `${Math.max(8, (row.sec / weekMaxCategorySec) * 100)}%` }}
                    />
                  </div>
                  <div className="w-14 text-right text-[11px] text-secondary-fg font-mono tabular-nums">
                    {(row.sec / 3600).toFixed(1)}h
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[11px] text-secondary-fg">
              Most time: <span className="text-foreground font-medium">{mostTracked?.name || "—"}</span> · {(mostTracked ? mostTracked.sec / 3600 : 0).toFixed(1)}h
            </div>
            <div className="mt-1 text-[11px] text-secondary-fg">
              Least tracked: <span className="text-foreground font-medium">{leastTracked?.name || "—"}</span>
            </div>
          </div>
        )}

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
                        className="app-card px-0 py-5 flex overflow-hidden hover:border-primary/25 transition-colors border-soft rounded-xl"
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
                            {p.total} task{p.total === 1 ? "" : "s"} · {Math.round((p.plannedTaskMin || 0) / 6) / 10}h planned
                            {p.doneByLabel ? ` · Done by ${p.doneByLabel}` : ""}
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
                            Actual tracked: {fmtHM(p.trackedSec)} · Planned done: {Math.round(p.plannedDoneMin)}m
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
