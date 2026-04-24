import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { todayDateStr } from "@/lib/daydraft";

/**
 * Replaces the old "Peak hours: …" chip on the Today header.
 *
 * Shows a small, dynamic insight that changes with context — what the user
 * actually did yesterday, time-of-day greeting energy, or a gentle nudge
 * if their previous plan was unfinished. Cheap and snackable; no AI call.
 */
export const TodayInsight = () => {
  const { user } = useAuth();
  const [yesterdayDone, setYesterdayDone] = useState<number | null>(null);
  const [yesterdayPlanned, setYesterdayPlanned] = useState<number | null>(null);
  const [tickHour, setTickHour] = useState(() => new Date().getHours());

  // Re-compute hourly so the message refreshes through the day without remount.
  useEffect(() => {
    const t = setInterval(() => setTickHour(new Date().getHours()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const ymd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
      const { data: p } = await supabase
        .from("plans")
        .select("id")
        .eq("user_id", user.id)
        .eq("date", ymd)
        .maybeSingle();
      if (!p) { setYesterdayDone(0); setYesterdayPlanned(0); return; }
      const { data: bs } = await supabase
        .from("blocks")
        .select("completed, kind")
        .eq("plan_id", p.id);
      const tasks = (bs || []).filter((b: any) => b.kind === "task");
      setYesterdayPlanned(tasks.length);
      setYesterdayDone(tasks.filter((b: any) => b.completed).length);
    })();
  }, [user?.id]);

  const message = useMemo(() => {
    const h = tickHour;
    // Morning + strong yesterday → momentum.
    if (h < 11 && yesterdayDone != null && yesterdayPlanned && yesterdayDone === yesterdayPlanned && yesterdayPlanned > 0) {
      return `🔥 Yesterday you finished all ${yesterdayPlanned}. Keep the streak alive.`;
    }
    if (h < 11 && yesterdayDone != null && yesterdayPlanned && yesterdayDone >= Math.ceil(yesterdayPlanned * 0.6)) {
      return `Strong start — ${yesterdayDone}/${yesterdayPlanned} done yesterday.`;
    }
    if (h < 11) return "Mornings are made for the hard thing first.";
    if (h < 14) return "Midday — protect one hour for deep work.";
    if (h < 17) return "Afternoon energy dips. Batch the small stuff now.";
    if (h < 20) return "Wrap-up time. What deserves tomorrow?";
    return "Plan tonight, win the morning.";
  }, [tickHour, yesterdayDone, yesterdayPlanned]);

  return (
    <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 shadow-glow max-w-full">
      <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" fill="currentColor" />
      <span className="text-xs font-medium text-primary truncate">{message}</span>
    </div>
  );
};