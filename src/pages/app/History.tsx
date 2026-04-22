import { useEffect, useState } from "react";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface PlanRow { id: string; date: string; ai_summary: string | null; }

export default function History() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  useEffect(() => {
    if (!user) return;
    supabase.from("plans").select("id,date,ai_summary").eq("user_id", user.id).order("date", { ascending: false }).limit(60)
      .then(({ data }) => setPlans((data || []) as PlanRow[]));
  }, [user?.id]);

  const groups: Record<string, PlanRow[]> = {};
  plans.forEach(p => {
    const d = new Date(p.date);
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
                  <div key={p.id} className="rounded-2xl bg-surface border border-border p-4 shadow-card">
                    <div className="text-xs text-secondary-fg">{new Date(p.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
                    <div className="mt-1 text-[15px]">{p.ai_summary || "Untitled day"}</div>
                  </div>
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
