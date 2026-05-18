import type { KeyboardEvent } from "react";
import { PartyPopper, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Block, fmtTime, typeColor, isUserTask, isOpenUserTask, blockSlotEndHHMM } from "@/lib/daydraft";
import { Link } from "react-router-dom";

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Next task — glance card; optionally whole preview is tappable to open the timeline.
 */
export function NextUpCard({
  blocks,
  nowHHMM,
  onOpenPlan,
  navigatePlanOnCardPress,
}: {
  blocks: Block[];
  nowHHMM: string;
  onOpenPlan: () => void;
  /** When true (e.g. Home), tapping the preview opens the timeline; Focus stays its own control. */
  navigatePlanOnCardPress?: boolean;
}) {
  const tasks = blocks.filter(isUserTask);
  const pending = tasks.filter((b) => isOpenUserTask(b));
  if (tasks.length === 0) return null;

  if (pending.length === 0) {
    return (
      <div className="rounded-[18px] border border-success/20 bg-success/[0.04] px-5 py-4 flex items-center gap-4">
        <PartyPopper className="h-5 w-5 text-success shrink-0 opacity-90" />
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold text-foreground/95 tracking-tight">All done</div>
          <p className="text-[13px] text-secondary-fg/80 mt-1 leading-snug">
            Review how the day went before closing out.
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0 h-10 rounded-xl bg-success/90 text-success-foreground hover:bg-success">
          <Link to="/recap">Recap</Link>
        </Button>
      </div>
    );
  }

  const nowM = timeToMin(nowHHMM);
  const ordered = [...pending].sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));
  const next = ordered[0]!;
  const endM = timeToMin(blockSlotEndHHMM(next));
  const status = nowM < timeToMin(next.start_time) ? "Soon" : nowM <= endM ? "Now" : "Open";

  const cardPressProps = navigatePlanOnCardPress
    ? ({
        role: "button" as const,
        tabIndex: 0,
        onClick: () => onOpenPlan(),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenPlan();
          }
        },
      } as const)
    : {};

  return (
    <div
      className={`rounded-[18px] border border-transparent px-4 py-3 sm:px-5 sm:py-4 ${
        navigatePlanOnCardPress ? "cursor-pointer" : ""
      }`}
      {...cardPressProps}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-secondary-fg/85">
            <span className="uppercase tracking-[0.14em] text-primary/90">{status}</span>
            <span className="tabular-nums font-mono-sf">{fmtTime(next.start_time)}</span>
            <span className="opacity-40">→</span>
            <span className="tabular-nums font-mono-sf">{fmtTime(blockSlotEndHHMM(next))}</span>
          </div>
          <div className="flex items-start gap-2.5 min-w-0 pt-0.5">
            <span
              className="h-2 w-2 rounded-full shrink-0 mt-2 opacity-90"
              style={{ background: typeColor(next.type) }}
            />
            <span className="text-[18px] font-semibold leading-snug line-clamp-3 text-foreground/95 tracking-tight break-words">
              {next.title}
            </span>
          </div>
          <p className="text-[13px] font-medium text-secondary-fg/75 pl-[18px] tabular-nums">{next.duration_min} min slot</p>
          {navigatePlanOnCardPress && (
            <p className="text-[13px] font-semibold text-primary pt-1 pl-[18px]">Open timeline →</p>
          )}
        </div>
        <Button
          type="button"
          asChild
          size="sm"
          className="shrink-0 h-11 rounded-xl px-4 text-[14px] font-semibold bg-primary/92 text-primary-foreground hover:bg-primary shadow-none"
          onClick={(e) => e.stopPropagation()}
        >
          <Link to={`/focus/${next.id}`} className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Play className="h-4 w-4" fill="currentColor" />
            Focus
          </Link>
        </Button>
      </div>
      {!navigatePlanOnCardPress && (
        <button
          type="button"
          onClick={onOpenPlan}
          className="mt-4 text-[13px] font-semibold text-primary/85 hover:text-primary transition-colors pressable ml-4"
        >
          Full day →
        </button>
      )}
    </div>
  );
}
