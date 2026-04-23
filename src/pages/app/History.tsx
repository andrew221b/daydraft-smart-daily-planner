import { useEffect, useState } from "react";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { parseDateStr } from "@/lib/daydraft";
import { useNavigate } from "react-router-dom";

interface PlanRow { id: string; date: string; ai_summary: string | null; }

export default function History() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  useEffect(() => {
    if (!user) return;
    supabase.from("plans").select("id,date,ai_summary").eq("user_id", user.id).order("date", { ascending: false }).limit(60)
      .then(({ data }) => setPlans((data || []) as PlanRow[]));
  }, [user?.id]);

  const groups: Record<string, PlanRow[]> = {};
  plans.forEach(p => {
    // Parse YYYY-MM-DD as a LOCAL date — `new Date("2026-04-23")` is UTC and
    // drifts a day in negative timezones.
    const d = parseDateStr(p.date);
    const start = new Date(d); start.setDate(d.getDate() - d.getDay());
    const key = `Week of ${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    (groups[key] ||= []).push(p);
  });

  return (
    <Shell>
      <div className="px-6 pt-14">
        <h1 className="text-[28px] font-semibold">History</h1>
        <p className="text-secondary-fg text-sm mt-1">Every day you've designed.</p>
        <div className="mt-8 space-y-7">
          {Object.entries(groups).map(([w, items]) => (
            <div key={w}>
              <div className="text-[11px] text-secondary-fg uppercase tracking-wider mb-2">{w}</div>
              <div className="space-y-2">
                {items.map(p => (
                  <button
                    key={p.id}
                    onClick={() => nav(`/today/plan?date=${p.date}`)}
                    className="w-full text-left rounded-2xl bg-surface border border-border p-4 shadow-card pressable hover:border-primary/30"
                  >
                    <div className="text-xs text-secondary-fg">{parseDateStr(p.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
                    <div className="mt-1 text-[15px]">{p.ai_summary || "Untitled day"}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {plans.length === 0 && <div className="text-secondary-fg text-center py-12">No plans yet. Design today.</div>}
        </div>
      </div>
    </Shell>
  );
}
