import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlement } from "@/hooks/useEntitlement";
import { supabase } from "@/integrations/supabase/client";
import { isUserTask, todayDateStr } from "@/lib/daydraft";
import { useQueryClient } from "@tanstack/react-query";
import { planDashboardQueryKey, planDayQueryKey } from "@/lib/planQueries";
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
          .select("id,plan_id,position,title,kind,type,completed,duration_min,estimated_minutes,actual_minutes,start_time,is_calendar_event")
          .eq("id", blockId)
          .maybeSingle();
        const endedBlock = b as BlockLite | null;
        if (!endedBlock || !isUserTask(endedBlock)) return;
        const { data: plan } = await supabase
          .from("plans")
          .select("date")
          .eq("id", endedBlock.plan_id)
          .maybeSingle();
        if (!plan || (plan as any).date !== today) return;
        const { data: bs } = await supabase
          .from("blocks")
          .select("id,plan_id,position,title,kind,type,completed,duration_min,estimated_minutes,actual_minutes,start_time,is_calendar_event")
          .eq("plan_id", endedBlock.plan_id)
          .order("position");
        const all = (bs || []) as BlockLite[];
        const rem = all.filter((x) => x.position > endedBlock.position && !x.completed && !x.is_calendar_event);
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
        const { data, error } = await supabase.functions.invoke("micro-reschedule-options", { body: payload });
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
        await supabase.from("blocks").upsert(updates as any, { onConflict: "id" });
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
        await supabase.from("blocks").upsert(updates as any, { onConflict: "id" });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, today) }),
        queryClient.invalidateQueries({ queryKey: planDayQueryKey(user.id, today) }),
      ]);
      setOpen(false);
      toast.success("Plan updated.");
    } catch (e: any) {
      toast.error(e?.message || "Unable to apply adjustment.");
    }
  };

  if (!isPro || !hasData) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="bottom" className="rounded-t-2xl border-soft bg-popover">
        <SheetHeader className="text-left mb-3">
          <SheetTitle className="text-[16px]">Quick reschedule?</SheetTitle>
        </SheetHeader>
        <div className="space-y-2">
          {options.slice(0, 2).map((opt, i) => (
            <Button key={i} variant="outline" className="w-full h-11 rounded-xl border-soft justify-start" onClick={() => void applyOption(opt)}>
              {opt.label}
            </Button>
          ))}
          <Button variant="ghost" className="w-full h-10 text-secondary-fg" onClick={() => setOpen(false)}>
            Keep original plan
          </Button>
        </div>
        {loading && <div className="mt-2 text-[11px] text-secondary-fg">Preparing options…</div>}
      </SheetContent>
    </Sheet>
  );
}

