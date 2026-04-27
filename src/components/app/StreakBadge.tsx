import { Flame } from "lucide-react";
import { useStreak } from "@/hooks/useStreak";
import { useState } from "react";
import { StreakSheet } from "./StreakSheet";
import { todayDateStr } from "@/lib/daydraft";

export const StreakBadge = () => {
  const { streak } = useStreak();
  const [open, setOpen] = useState(false);
  const count = streak?.current_streak ?? 0;
  const active = count > 0;
  // At-risk: user has a streak, hasn't planned today yet, and it's getting late.
  // Pulses an amber dot so they notice before the streak burns at midnight.
  const atRisk = (() => {
    if (!active) return false;
    if (streak?.last_planned_date === todayDateStr()) return false;
    return new Date().getHours() >= 18;
  })();
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border pressable ${
          active ? "bg-primary/10 border-primary/30" : "bg-surface border-border"
        }`}
        aria-label={`Streak ${count} days${atRisk ? " — at risk" : ""}`}
      >
        <Flame className={`h-3.5 w-3.5 ${active ? "text-primary" : "text-secondary-fg"}`} fill={active ? "currentColor" : "none"} />
        <span className={`text-xs font-semibold ${active ? "text-primary" : "text-secondary-fg"}`}>{count}</span>
        {atRisk && (
          <span
            className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-background animate-pulse bg-destructive"
            aria-hidden="true"
          />
        )}
      </button>
      <StreakSheet open={open} onOpenChange={setOpen} />
    </>
  );
};