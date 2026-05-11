import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/app/Shell";
import { PageHeader } from "@/components/app/PageHeader";
import { PullToRefresh } from "@/components/app/PullToRefresh";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { parseDateStr, todayDateStr, isUserTask, isUserTaskDone, dateStr } from "@/lib/daydraft";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronRight, CalendarDays } from "lucide-react";
import { useTimeTracker, fmtHM } from "@/hooks/useTimeTracker";

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
function DayProgressGlyph({ pct, allDone }: { pct: number; allDone: boolean }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const dash = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  if (allDone) {
    return <CheckCircle2 className="h-9 w-9 shrink-0 text-success opacity-95" strokeWidth={1.75} />;
  }
  return (
    <svg className="h-9 w-9 shrink-0 -rotate-90 text-primary" viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-border/55" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={dash}
      />
    </svg>
  );
}

function weekHeadingLabel(d: Date): string {
  const monOff = (d.getDay() + 6) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - monOff);
  return `Week of ${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
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
        .select("id,plan_id,kind,completed,title,position,is_calendar_event,duration_min,block_type,completed_at,resolution")
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
    (blocks || []).forEach((b: any) => {
      if (!byPlan.has(b.plan_id)) byPlan.set(b.plan_id, []);
      const row = b as BlockLite;
      byPlan.get(b.plan_id)!.push(row);
    });
    // Hide orphaned plans in UI only.
    // Read-path must never mutate user data from a client screen.
    const orphans = list.filter(p => !(byPlan.get(p.id) || []).length).map(p => p.id);
    const enriched: PlanRow[] = list
      .filter(p => !orphans.includes(p.id))
      .map(p => {
        const bs = byPlan.get(p.id) || [];
        const tasks = bs.filter(b => isUserTask(b));
        const done = tasks.filter((b) => isUserTaskDone(b as any)).length;
        const plannedTaskMin = tasks.reduce((s, b) => s + (((b as any).duration_min as number) || 0), 0);
        const plannedDoneMin = tasks
          .filter((b) => isUserTaskDone(b as any))
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
    setPlans(enriched);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const todayKey = todayDateStr();

  const last7 = plans.slice(0, 7);
  const totalTasks = last7.reduce((s, p) => s + p.total, 0);
  const totalDone = last7.reduce((s, p) => s + p.done, 0);
  const completionPct = totalTasks ? Math.round((totalDone / totalTasks) * 100) : 0;

  const planRows = useMemo(() => {
    let prev: string | null = null;
    return plans.map((p) => {
      const dt = parseDateStr(p.date);
      const wk = weekHeadingLabel(dt);
      const showWeek = prev !== wk;
      prev = wk;
      return { p, dt, wk, showWeek };
    });
  }, [plans]);

  return (
    <Shell>
      <PullToRefresh onRefresh={async () => { await load(); }}>
      <div className="px-6 pt-10 pb-12">
          <PageHeader
            eyebrow="Past plans"
            title="History"
            hint="Tap a row for recap. Done tasks only bump your score."
          />

        <div className="mt-6 rounded-[22px] border border-border/40 bg-background/25 px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/80">
            Last 7 listed days
          </p>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
            <p className="font-display text-[28px] font-semibold tabular-nums leading-none text-foreground/95">{completionPct}%</p>
            <button
              type="button"
              onClick={() => nav("/home?tracker=1")}
              className="text-[13px] font-semibold text-primary pressable hover:underline"
            >
              {fmtHM(weekTotalSec)} tracked · timer
            </button>
          </div>
          <p className="mt-2 text-[14px] font-medium leading-snug text-secondary-fg/88">
            {totalDone}/{totalTasks} tasks closed · <span className="tabular-nums">{fmtHM(todayTotalSec)}</span> today ·{" "}
            <span className="tabular-nums">{plans.length}</span> days on file
          </p>
        </div>

        <p className="mt-10 text-[11px] font-semibold uppercase tracking-[0.18em] text-secondary-fg/75">Days</p>

        {loading && (
          <div className="mt-4 space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-20 rounded-2xl surface-card border border-soft animate-pulse" />
            ))}
          </div>
        )}
        {!loading && (
          <div className="mt-3 space-y-2">
            {planRows.map(({ p, dt, wk, showWeek }, idx) => {
                    const isToday = p.date === todayKey;
                    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                    const allDone = p.total > 0 && p.done === p.total;
                    const goTo = `/recap?date=${p.date}`;
                    return (
                <div key={p.id}>
                  {showWeek ? (
                    <p
                      className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/70 ${idx > 0 ? "mt-6" : "mt-1"}`}
                    >
                      {wk}
                    </p>
                  ) : null}
                  <button
                          type="button"
                          onClick={() => nav(goTo)}
                    className="flex w-full items-center gap-4 rounded-2xl border border-border/45 bg-muted/[0.04] px-4 py-4 text-left transition-colors hover:border-primary/35 pressable"
                        >
                          <DayProgressGlyph pct={pct} allDone={allDone} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-display text-[17px] font-semibold tracking-tight text-foreground/95">
                                {dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                              </span>
                        {isToday ? (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                            Today
                          </span>
                        ) : null}
                            </div>
                      <p className="mt-1.5 font-display text-[20px] font-semibold tabular-nums text-foreground/95 leading-none">
                              {p.done}/{p.total} <span className="text-[15px] font-medium text-secondary-fg/80">done</span>
                            </p>
                      <p className="mt-2 text-[13px] leading-snug text-secondary-fg/85">
                              {fmtHM(p.trackedSec)} logged · {(p.plannedTaskMin / 60).toFixed(1)}h planned
                            </p>
                      <p className={`mt-0.5 text-[13px] font-semibold tabular-nums ${allDone ? "text-success" : "text-secondary-fg/80"}`}>{pct}%</p>
                          </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-secondary-fg/50" aria-hidden />
                        </button>
                </div>
                    );
                  })}
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
