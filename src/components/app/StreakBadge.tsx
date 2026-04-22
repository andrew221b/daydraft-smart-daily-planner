import { Flame } from "lucide-react";
import { useStreak } from "@/hooks/useStreak";
import { useState } from "react";
import { StreakSheet } from "./StreakSheet";

export const StreakBadge = () => {
  const { streak } = useStreak();
  const [open, setOpen] = useState(false);
  const count = streak?.current_streak ?? 0;
  const active = count > 0;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border pressable ${
          active ? "bg-primary/10 border-primary/30 shadow-glow" : "bg-surface border-border"
        }`}
        aria-label={`Streak ${count} days`}
      >
        <Flame className={`h-3.5 w-3.5 ${active ? "text-primary" : "text-secondary-fg"}`} fill={active ? "currentColor" : "none"} />
        <span className={`text-xs font-semibold ${active ? "text-primary" : "text-secondary-fg"}`}>{count}</span>
      </button>
      <StreakSheet open={open} onOpenChange={setOpen} />
    </>
  );
};