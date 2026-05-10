import { Play, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Block, fmtTime, typeColor, isUserTask, blockSlotEndHHMM } from "@/lib/daydraft";
import { Link } from "react-router-dom";

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Next task — restrained card, echoes DayView timing (until end of slot).
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
      <div className="rounded-[18px] border border-success/20 bg-success/[0.04] px-5 py-4 flex items-center gap-4">
        <PartyPopper className="h-5 w-5 text-success shrink-0 opacity-90" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-foreground/95 tracking-tight">All clear</div>
          <p className="text-[12px] text-secondary-fg/75 mt-1 leading-snug">
            Brief recap seals the rhythm for tomorrow.
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0 h-9 rounded-xl bg-success/90 text-success-foreground hover:bg-success">
          <Link to="/recap">Recap</Link>
        </Button>
      </div>
    );
  }

  const nowM = timeToMin(nowHHMM);
  const ordered = [...pending].sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));
  const next = ordered[0]!;
  const startM = timeToMin(next.start_time);
  const endM = timeToMin(blockSlotEndHHMM(next));
  const status =
    nowM < startM ? "Soon" : nowM <= endM ? "Now" : "Open";

  return (
    <div className="rounded-[18px] px-5 py-4 border border-transparent">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-secondary-fg/75">
            <span className="font-medium uppercase tracking-[0.12em] text-primary/85">{status}</span>
            <span className="tabular-nums font-mono-sf">{fmtTime(next.start_time)}</span>
            <span className="opacity-40">→</span>
            <span className="tabular-nums font-mono-sf">{fmtTime(blockSlotEndHHMM(next))}</span>
          </div>
          <div className="flex items-start gap-2.5 min-w-0 pt-0.5">
            <span className="h-1.5 w-1.5 rounded-full shrink-0 mt-1.5 opacity-85" style={{ background: typeColor(next.type) }} />
            <span className="text-[16px] font-medium leading-snug line-clamp-3 text-foreground/92 tracking-tight break-words">{next.title}</span>
          </div>
          <p className="text-[11px] text-secondary-fg/65 pl-4">{next.duration_min} min window</p>
        </div>
        <Button
          asChild
          size="sm"
          className="shrink-0 h-10 rounded-xl px-4 bg-primary/92 text-primary-foreground hover:bg-primary shadow-none"
        >
          <Link to={`/focus/${next.id}`} className="inline-flex items-center gap-2 font-medium">
            <Play className="h-3.5 w-3.5" fill="currentColor" />
            Focus
          </Link>
        </Button>
      </div>
      <button
        type="button"
        onClick={onOpenPlan}
        className="mt-4 text-[11.5px] text-secondary-fg/70 hover:text-primary/90 transition-colors font-medium pressable ml-4"
      >
        Full day →
      </button>
    </div>
  );
}
