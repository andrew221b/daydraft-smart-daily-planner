import { Play, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Block, fmtTime, typeColor, isUserTask } from "@/lib/daydraft";
import { Link } from "react-router-dom";

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Surfaces the next actionable task on today's plan — the fastest path back into Focus.
 */
export function NextUpCard({
  blocks,
  nowHHMM,
  onOpenPlan,
}: {
  blocks: Block[];
  nowHHMM: string;
  onOpenPlan: () => void;
}) {
  const tasks = blocks.filter(isUserTask);
  const pending = tasks.filter((b) => !b.completed);
  if (tasks.length === 0) return null;

  if (pending.length === 0) {
    return (
      <div className="rounded-[20px] border border-success/22 bg-success/[0.055] backdrop-blur-md px-4 py-3.5 shadow-card flex items-center gap-3">
        <PartyPopper className="h-5 w-5 text-success shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground">All tasks done</div>
          <p className="text-[11.5px] text-secondary-fg mt-0.5">Close the loop with a quick recap — it keeps tomorrow sharper.</p>
        </div>
        <Button asChild size="sm" className="shrink-0 rounded-xl bg-success text-success-foreground hover:bg-success/90">
          <Link to="/recap">Recap</Link>
        </Button>
      </div>
    );
  }

  const nowM = timeToMin(nowHHMM);
  const ordered = [...pending].sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));
  const next = ordered[0]!;
  const startM = timeToMin(next.start_time);
  const endM = startM + next.duration_min;
  const status =
    nowM < startM ? "Coming up" : nowM <= endM ? "Now" : "Still open";

  return (
    <div className="rounded-[20px] border border-primary/14 bg-primary/[0.035] backdrop-blur-md px-4 py-3.5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">{status}</span>
            <span className="text-[11px] text-secondary-fg font-mono-sf tabular-nums">{fmtTime(next.start_time)}</span>
            <span className="h-1 w-1 rounded-full bg-border shrink-0" />
            <span className="text-[11px] text-secondary-fg">{next.duration_min} min</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: typeColor(next.type) }} />
            <span className="text-[15px] font-medium leading-snug truncate">{next.title}</span>
          </div>
        </div>
        <Button
          asChild
          size="sm"
          className="shrink-0 h-9 rounded-xl bg-primary text-primary-foreground hover:bg-primary/92 px-3"
        >
          <Link to={`/focus/${next.id}`} className="inline-flex items-center gap-1.5">
            <Play className="h-3.5 w-3.5" fill="currentColor" />
            Focus
          </Link>
        </Button>
      </div>
      <button
        type="button"
        onClick={onOpenPlan}
        className="mt-2.5 text-[11.5px] text-secondary-fg hover:text-primary transition-colors"
      >
        View full day →
      </button>
    </div>
  );
}
