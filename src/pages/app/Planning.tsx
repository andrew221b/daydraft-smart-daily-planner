import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { todayDateStr } from "@/lib/daydraft";

const SLOW_MS = 75_000;

export default function Planning() {
  const nav = useNavigate();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, []);

  const bail = () => {
    const d = sessionStorage.getItem("dd_planning_plan_date") || todayDateStr();
    const base = d === todayDateStr() ? "/today" : `/today?date=${d}`;
    nav(`${base}?composer=1`, { replace: true });
  };

  return (
    <Shell hideTabBar hideQuickCapture>
      <div className="px-6 pt-14">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="h-4 w-4" />
          <span className="text-[13px] font-medium">Working</span>
          <span className="dot-bounce inline-flex"><span/><span/><span/></span>
        </div>
        <h1 className="font-display text-[26px] font-semibold mt-3 tracking-tight text-balance">Designing your day</h1>
        <p className="text-[13px] text-secondary-fg mt-2 leading-[1.55] max-w-sm">
          Estimating durations and arranging your blocks. Sit tight — you&apos;ll review and tweak on the next screen.
        </p>

        {slow && (
          <div className="mt-6 app-card p-4 border-primary/20">
            <p className="text-[13px] text-foreground leading-snug">
              Still waiting? Your task list was saved — you can go back, edit, and try generating again.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="w-full mt-3 h-11 rounded-xl text-[13px] font-medium"
              onClick={bail}
            >
              Back to planner
            </Button>
          </div>
        )}

        <div className="mt-9 space-y-2.5">
          {[80, 64, 72, 56, 80].map((w, i) => (
            <div key={i} className="app-card p-4">
              <div className="h-3 shimmer rounded-full" style={{ width: `${w}%` }} />
              <div className="h-2.5 shimmer rounded-full mt-3 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
