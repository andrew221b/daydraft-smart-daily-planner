import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { dateStr, parseDateStr } from "@/lib/daydraft";
import { X, RotateCcw } from "lucide-react";

interface SpilloverProps {
  onCarryOver: (titles: string[]) => void;
  /** The date being planned (YYYY-MM-DD). Spillover always pulls from the
   *  most recent plan strictly BEFORE this date — not "yesterday from now". */
  planDate: string;
}

export const SpilloverChips = ({ onCarryOver, planDate }: SpilloverProps) => {
  const { user } = useAuth();
  const [titles, setTitles] = useState<string[]>([]);
  const [sourceLabel, setSourceLabel] = useState<string>("yesterday");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    setDismissed(false);
    (async () => {
      const { data: plan } = await supabase
        .from("plans").select("id, date")
        .eq("user_id", user.id).lt("date", planDate)
        .order("date", { ascending: false }).limit(1).maybeSingle();
      if (!plan) { setTitles([]); return; }
      const { data: blocks } = await supabase
        .from("blocks").select("title, kind, completed")
        .eq("plan_id", plan.id).eq("completed", false).eq("kind", "task");
      const list = (blocks || []).map(b => b.title).filter(Boolean);
      setTitles(list);
      // Compute a friendly label: "yesterday" only if the previous plan was
      // literally the day before; otherwise show its date so the user knows
      // those tasks are stale (e.g. from last week).
      try {
        const prev = parseDateStr(plan.date);
        const target = parseDateStr(planDate);
        const dayBefore = new Date(target); dayBefore.setDate(dayBefore.getDate() - 1);
        if (dateStr(prev) === dateStr(dayBefore)) setSourceLabel("yesterday");
        else setSourceLabel(prev.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
      } catch { setSourceLabel("a previous day"); }
    })();
  }, [user?.id, planDate]);

  if (dismissed || titles.length === 0) return null;

  return (
    <div className="mb-3 rounded-xl bg-surface border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-secondary-fg">
          <span className="text-foreground font-medium">{titles.length} unfinished</span> from {sourceLabel}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onCarryOver(titles)}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-primary/15 text-primary border border-primary/30 pressable hover:bg-primary/20">
            <RotateCcw className="h-3 w-3" /> Carry over all
          </button>
          <button onClick={() => setDismissed(true)} className="text-secondary-fg hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {titles.slice(0, 6).map((t, i) => (
          <button key={i} onClick={() => onCarryOver([t])}
            className="text-[11px] px-2 py-1 rounded-full bg-surface-elevated border border-border text-secondary-fg pressable hover:text-foreground hover:border-primary/30">
            {t.length > 28 ? t.slice(0, 28) + "…" : t}
          </button>
        ))}
        {titles.length > 6 && (
          <span className="text-[11px] px-2 py-1 text-secondary-fg">+{titles.length - 6} more</span>
        )}
      </div>
    </div>
  );
};