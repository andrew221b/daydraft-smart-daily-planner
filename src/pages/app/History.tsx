import { useEffect, useState } from "react";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { parseDateStr, todayDateStr, isFutureDateStr } from "@/lib/daydraft";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, CalendarDays } from "lucide-react";
import { toast } from "sonner";

interface BlockLite { plan_id: string; kind: string; completed: boolean; title: string; }
interface PlanRow {
  id: string;
  date: string;
  ai_summary: string | null;
  total: number;
  done: number;
  preview: string;
}

export default function History() {
  const { user } = useAuth();
  const nav = useNavigate();
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
    const { data: blocks } = await supabase
      .from("blocks")
      .select("plan_id,kind,completed,title,position")
      .in("plan_id", ids)
      .order("position");
    const byPlan = new Map<string, BlockLite[]>();
    (blocks || []).forEach((b: any) => {
      if (!byPlan.has(b.plan_id)) byPlan.set(b.plan_id, []);
      byPlan.get(b.plan_id)!.push(b as BlockLite);
    });
    // Quietly clean up orphaned plans (created but no blocks were ever saved).
    // These are usually leftovers from a failed `generate-plan` invocation and
    // serve no purpose to the user — they confuse history and lead to dead-end
    // empty DayViews.
    const orphans = list.filter(p => !(byPlan.get(p.id) || []).length).map(p => p.id);
    if (orphans.length) {
      try { await supabase.from("plans").delete().in("id", orphans); } catch {/* ignore */}
    }
    const enriched: PlanRow[] = list
      .filter(p => !orphans.includes(p.id))
      .map(p => {
        const bs = byPlan.get(p.id) || [];
        const tasks = bs.filter(b => b.kind === "task");
        const done = tasks.filter(b => b.completed).length;
        const preview = tasks.slice(0, 3).map(t => t.title).filter(Boolean).join(" · ");
        return {
          id: p.id,
          date: p.date,
          ai_summary: p.ai_summary,
          total: tasks.length,
          done,
          preview,
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

  return (
    <Shell>
      <div className="px-5 pt-10">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-secondary-fg">Reflection</p>
        <h1 className="text-[22px] font-semibold tracking-tight mt-1">History</h1>
        {loading && (
          <div className="mt-6 space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-[78px] rounded-xl bg-card border border-border shadow-card animate-pulse" />
            ))}
          </div>
        )}
        {!loading && (
          <div className="mt-6 space-y-6">
            {Object.entries(groups).map(([w, items]) => (
              <div key={w}>
                <div className="text-[10px] text-secondary-fg uppercase tracking-[0.14em] mb-2 font-medium">{w}</div>
                <div className="space-y-1.5">
                  {items.map(p => {
                    const isToday = p.date === todayKey;
                    const completionPct = p.total ? Math.round((p.done / p.total) * 100) : 0;
                    const allDone = p.total > 0 && p.done === p.total;
                    // ALL day rows route to Recap (read-only reflection +
                    // AI insight). History is for looking back, never for
                    // resuming work — that path is on the Today screen.
                    const goTo = `/recap?date=${p.date}`;
                    return (
                      <button
                        key={p.id}
                        onClick={() => nav(goTo)}
                        className="w-full text-left rounded-xl bg-card border border-border p-3.5 shadow-card pressable hover:border-foreground/20 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {allDone ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                          ) : (
                            <Circle className="h-3.5 w-3.5 text-secondary-fg/60 shrink-0" />
                          )}
                          <div className="text-[11px] text-secondary-fg font-medium">
                            {parseDateStr(p.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                            {isToday && <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-primary font-semibold">Today</span>}
                          </div>
                        </div>
                        <div className="mt-1 text-[13.5px] line-clamp-2 leading-snug">
                          {p.ai_summary || p.preview || `${p.total} task${p.total === 1 ? "" : "s"}`}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10.5px] text-secondary-fg">
                          <span>
                            <span className="text-foreground font-medium">{p.done}</span>
                            <span className="text-secondary-fg">/{p.total}</span>
                            {" tasks done"}
                          </span>
                          <span className={`tabular-nums ${allDone ? "text-success font-medium" : ""}`}>{completionPct}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {plans.length === 0 && (
              <div className="text-center py-16">
                <CalendarDays className="h-8 w-8 text-secondary-fg/40 mx-auto mb-3" />
                <div className="text-sm font-medium">No plans yet</div>
                <p className="text-xs text-secondary-fg mt-1">Once you plan a day, it'll show up here.</p>
                <button
                  onClick={() => nav("/today")}
                  className="mt-4 text-sm text-primary font-medium hover:underline"
                >
                  Design today →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
