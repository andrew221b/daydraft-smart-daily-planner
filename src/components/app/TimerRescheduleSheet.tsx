import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronRight, Clock, Coffee, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlement } from "@/hooks/useEntitlement";
import { supabase } from "@/integrations/supabase/client";
import { invokeAiCached } from "@/lib/aiCache";
import { isUserTask, isOpenUserTask, todayDateStr } from "@/lib/daydraft";
import type { TablesInsert } from "@/integrations/supabase/types";
import { useQueryClient } from "@tanstack/react-query";
import { planDashboardQueryKey, planDayQueryKey } from "@/lib/planQueries";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";

type BlockLite = {
  id: string;
  plan_id: string;
  position: number;
  title: string;
  kind: string;
  type: string;
  completed: boolean;
  duration_min: number;
  estimated_minutes?: number;
  actual_minutes?: number | null;
  start_time: string;
  is_calendar_event?: boolean | null;
  resolution?: string | null;
};
type Action = { type: "shift_later"; minutes?: number } | { type: "shorten_next_break"; target_minutes?: number };
type Opt = { label: string; action: Action };

const hhmmToMin = (hhmm: string) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};
const minToHHMM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.max(0, mins % 60)).padStart(2, "0")}`;

export function TimerRescheduleSheet() {
  const { user } = useAuth();
  const { isPro } = useEntitlement();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<Opt[]>([]);
  const [ended, setEnded] = useState<BlockLite | null>(null);
  const [remaining, setRemaining] = useState<BlockLite[]>([]);
  const today = todayDateStr();

  const hasData = useMemo(() => !!ended && remaining.length > 0 && options.length > 0, [ended, remaining.length, options.length]);

  useEffect(() => {
    const onStopped = async (evt: Event) => {
      if (!isPro || !user) return;
      const detail = (evt as CustomEvent).detail as { blockId?: string } | undefined;
      const blockId = detail?.blockId;
      if (!blockId) return;
      setLoading(true);
      try {
        const { data: b } = await supabase
          .from("blocks")
          .select("id,plan_id,position,title,kind,type,completed,duration_min,estimated_minutes,actual_minutes,start_time,is_calendar_event,resolution")
          .eq("id", blockId)
          .maybeSingle();
        const endedBlock = b as BlockLite | null;
        if (!endedBlock || !isUserTask(endedBlock)) return;
        const { data: plan } = await supabase
          .from("plans")
          .select("date")
          .eq("id", endedBlock.plan_id)
          .maybeSingle();
        if (!plan || (plan).date !== today) return;
        const { data: bs } = await supabase
          .from("blocks")
          .select("id,plan_id,position,title,kind,type,completed,duration_min,estimated_minutes,actual_minutes,start_time,is_calendar_event,resolution")
          .eq("plan_id", endedBlock.plan_id)
          .order("position");
        const all = (bs || []) as BlockLite[];
        const rem = all.filter((x) => {
          if (x.position <= endedBlock.position || x.is_calendar_event) return false;
          return isUserTask(x) ? isOpenUserTask(x as Parameters<typeof isOpenUserTask>[0]) : !x.completed;
        });
        if (!rem.length) return;
        const payload = {
          ended_block: {
            title: endedBlock.title,
            estimated_minutes: endedBlock.estimated_minutes ?? endedBlock.duration_min,
            actual_minutes: endedBlock.actual_minutes ?? 0,
          },
          remaining_blocks: rem
            .filter((x) => isUserTask(x))
            .map((x) => ({ title: x.title, estimated_minutes: x.estimated_minutes ?? x.duration_min })),
          current_time: new Date().toTimeString().slice(0, 5),
        };
        const { data, error } = await invokeAiCached<{ options?: Opt[] }>(
          "micro-reschedule-options",
          payload,
          { ttlMs: 0, timeoutMs: 30_000 },
        );
        if (error || !data?.options?.length) return;
        setEnded(endedBlock);
        setRemaining(rem);
        setOptions((data.options as Opt[]).slice(0, 2));
        setOpen(true);
      } finally {
        setLoading(false);
      }
    };
    window.addEventListener("dd-block-timer-stopped", onStopped);
    return () => window.removeEventListener("dd-block-timer-stopped", onStopped);
  }, [isPro, user?.id, today]);

  const applyOption = async (opt: Opt) => {
    if (!user || !ended || !remaining.length) return;
    try {
      if (opt.action.type === "shift_later") {
        const delta = Math.max(5, Math.min(20, Number(opt.action.minutes || 10)));
        const updates = remaining.map((b) => ({
          id: b.id,
          start_time: minToHHMM(hhmmToMin(b.start_time) + delta),
        }));
        await supabase.from("blocks").upsert(updates as TablesInsert<"blocks">[], { onConflict: "id" });
      } else if (opt.action.type === "shorten_next_break") {
        const target = Math.max(3, Math.min(10, Number(opt.action.target_minutes || 5)));
        const nextBreak = remaining.find((b) => (b.kind === "break" || b.kind === "lunch") && !b.completed);
        if (!nextBreak) {
          toast("No upcoming break to shorten.");
          setOpen(false);
          return;
        }
        const old = nextBreak.duration_min;
        if (old <= target) {
          toast("Next break is already short.");
          setOpen(false);
          return;
        }
        const delta = old - target;
        const updates: Array<{ id: string; start_time?: string; duration_min?: number }> = [{ id: nextBreak.id, duration_min: target }];
        remaining
          .filter((b) => b.position > nextBreak.position)
          .forEach((b) => updates.push({ id: b.id, start_time: minToHHMM(hhmmToMin(b.start_time) - delta) }));
        await supabase.from("blocks").upsert(updates as TablesInsert<"blocks">[], { onConflict: "id" });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, today) }),
        queryClient.invalidateQueries({ queryKey: planDayQueryKey(user.id, today) }),
      ]);
      setOpen(false);
      toast.success("Plan updated.");
    } catch (e) {
      toast.error(e?.message || "Unable to apply adjustment.");
    }
  };

  if (!isPro || !hasData) return null;

  const endedTitle = ended?.title?.trim() || "your last task";
  const shortTitle = endedTitle.length > 40 ? `${endedTitle.slice(0, 37)}…` : endedTitle;
  const overByMin = ended
    ? Math.round((ended.actual_minutes ?? 0) - (ended.estimated_minutes ?? ended.duration_min))
    : 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/45 bg-popover px-5 pt-5 pb-7 max-h-[92vh] overflow-y-auto"
      >
        <SheetHeader className="text-left mb-1 space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/85">
            <Sparkles className="h-3 w-3" /> AI suggestion
          </div>
          <SheetTitle className="text-[18px] font-semibold tracking-tight">
            Adjust the rest of your day?
          </SheetTitle>
          <p className="text-[13px] leading-snug text-secondary-fg">
            "{shortTitle}" ran {overByMin > 0 ? `${overByMin}m over` : "long"}. Pick a fix
            or keep the plan as it was.
          </p>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {options.slice(0, 2).map((opt, i) => {
            const Icon = opt.action.type === "shorten_next_break" ? Coffee : Clock;
            return (
              <button
                key={i}
                type="button"
                onClick={() => { haptics.selection(); void applyOption(opt); }}
                className="group w-full text-left flex items-start gap-3 rounded-[18px] border border-border/40 bg-surface-card/70 hover:border-primary/35 hover:bg-primary/[0.04] pressable px-4 py-3.5 transition-colors"
              >
                <span className="mt-0.5 grid place-items-center h-9 w-9 rounded-full bg-primary/10 text-primary shrink-0">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1 text-[14px] leading-[1.45] text-foreground/95 whitespace-normal break-words">
                  {opt.label}
                </span>
                <ChevronRight className="h-4 w-4 text-secondary-fg/55 shrink-0 mt-2.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => { haptics.selection(); setOpen(false); }}
            className="w-full h-11 mt-1 text-[13px] text-secondary-fg hover:text-foreground transition-colors pressable rounded-[14px]"
          >
            Keep original plan
          </button>
        </div>
        {loading && (
          <div className="mt-3 text-[11px] text-secondary-fg text-center">Preparing options…</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

