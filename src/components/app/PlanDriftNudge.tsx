import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useTimeTracker } from "@/hooks/useTimeTracker";
import { supabase } from "@/integrations/supabase/client";
import { todayDateStr, isUserTask, inferScheduleBlockType, blockSlotEndHHMM } from "@/lib/daydraft";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { planDashboardQueryKey, planDayQueryKey } from "@/lib/planQueries";

type PlanBlock = {
  id: string;
  plan_id: string;
  start_time: string;
  duration_min: number;
  title: string;
  type: string;
  kind: string;
  completed: boolean;
  completed_at?: string | null;
  is_calendar_event?: boolean | null;
};

const IDLE_MIN = 40;

export function PlanDriftNudge() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { isPro } = useEntitlement();
  const { active } = useTimeTracker();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState<{ planId: string; blocks: PlanBlock[] } | null>(null);
  const pollingRef = useRef<number | null>(null);
  const checkingRef = useRef(false);
  const nudgeAnchorRef = useRef<string | null>(null);
  const today = todayDateStr();

  const remainingTasks = useMemo(
    () => (pending?.blocks || []).filter((b) => isUserTask(b) && !b.completed),
    [pending?.blocks],
  );

  useEffect(() => {
    if (!user || !isPro) return;
    const run = async () => {
      if (checkingRef.current) return;
      if (active) return; // user is already on track right now
      checkingRef.current = true;
      try {
        const { data: plan } = await supabase
          .from("plans")
          .select("id,created_at")
          .eq("user_id", user.id)
          .eq("date", today)
          .maybeSingle();
        if (!plan?.id) return;
        const { data: blocks } = await supabase
          .from("blocks")
          .select("id,plan_id,start_time,duration_min,title,type,kind,completed,completed_at,is_calendar_event")
          .eq("plan_id", plan.id)
          .order("position");
        const list = (blocks || []) as PlanBlock[];
        const remaining = list.filter((b) => isUserTask(b) && !b.completed);
        if (!remaining.length) return; // all complete or no tasks
        const blockIds = list.map((b) => b.id);
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const { data: recentTimer } = await supabase
          .from("time_entries")
          .select("started_at")
          .eq("user_id", user.id)
          .gte("started_at", dayStart.toISOString())
          .in("block_id", blockIds)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        let localProgress = 0;
        try {
          localProgress = new Date(localStorage.getItem(`dd_last_plan_progress_${today}`) || 0).getTime();
        } catch {
          localProgress = 0;
        }
        const completedAt = list
          .filter((b) => !!b.completed_at)
          .map((b) => new Date(String(b.completed_at)).getTime())
          .filter(Number.isFinite);
        const lastCompletedAt = completedAt.length ? Math.max(...completedAt) : 0;
        const lastTimerStartAt = recentTimer?.started_at ? new Date(recentTimer.started_at).getTime() : 0;
        const planCreatedAt = plan.created_at ? new Date(plan.created_at).getTime() : Date.now();
        const anchorMs = Math.max(planCreatedAt, lastCompletedAt, lastTimerStartAt, localProgress);
        const idleMin = (Date.now() - anchorMs) / 60000;
        if (idleMin < IDLE_MIN) return;
        const anchorKey = `${plan.id}:${anchorMs}`;
        const sessionSeen = sessionStorage.getItem("dd_drift_nudge_anchor");
        if (sessionSeen === anchorKey || nudgeAnchorRef.current === anchorKey) return;
        nudgeAnchorRef.current = anchorKey;
        sessionStorage.setItem("dd_drift_nudge_anchor", anchorKey);
        setPending({ planId: plan.id, blocks: list });
        toast("Looks like you drifted from your plan. Want to rebuild the rest of your day?", {
          duration: 8000,
          action: {
            label: "Review",
            onClick: () => setSheetOpen(true),
          },
        });
      } finally {
        checkingRef.current = false;
      }
    };
    void run();
    pollingRef.current = window.setInterval(() => void run(), 60_000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [user?.id, isPro, active?.id, today]);

  const rebuildFromNow = async () => {
    if (!user || !pending || !remainingTasks.length) return;
    try {
      const raw_input = remainingTasks.map((b) => `${b.title} (${b.duration_min}m)`).join("\n");
      const { data, error } = await supabase.functions.invoke("generate-plan", {
        body: {
          raw_input,
          energy_preference: profile?.energy_preference || "morning",
          name: profile?.display_name,
          mode: "replan",
          start_time: new Date().toTimeString().slice(0, 5),
          plan_date: today,
          now_iso: new Date().toISOString(),
          timezone: profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          active_hours_start: (profile as any)?.active_hours_start || "09:00",
          active_hours_end: (profile as any)?.active_hours_end || "22:00",
          ai_tone: (profile as any)?.ai_tone || "professional",
          ai_tone_custom: (profile as any)?.ai_tone_custom || null,
          ai_planning_rules: (profile as any)?.ai_planning_rules || "",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const toRemoveIds = pending.blocks
        .filter((b) => {
          if (b.is_calendar_event) return false;
          if (isUserTask(b) && !b.completed) return true;
          if ((b.kind === "break" || b.kind === "lunch") && !b.completed) return true;
          return false;
        })
        .map((b) => b.id);
      const keep = pending.blocks.filter((b) => !toRemoveIds.includes(b.id));
      if (toRemoveIds.length) await supabase.from("blocks").delete().in("id", toRemoveIds);
      const startPos = keep.length;
      const newBlocks = (data.blocks || []).map((b: any, i: number) => ({
        plan_id: pending.planId,
        user_id: user.id,
        start_time: b.start_time,
        duration_min: b.duration_min,
        estimated_minutes: b.estimated_minutes ?? b.duration_min,
        actual_minutes: null,
        title: b.title,
        type: b.type,
        kind: b.kind,
        block_type: inferScheduleBlockType(b),
        position: startPos + i,
        ai_reasoning: b.reasoning ?? null,
        overlap_ok: Boolean(b.overlap_ok),
        parallel_group_id: typeof b.parallel_group_id === "string" && b.parallel_group_id ? b.parallel_group_id : null,
        slot_end_time: blockSlotEndHHMM({
          start_time: b.start_time,
          duration_min: b.duration_min,
          slot_end_time: b.slot_end_time ?? null,
        } as any),
      }));
      if (newBlocks.length) await supabase.from("blocks").insert(newBlocks);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: planDashboardQueryKey(user.id, today) }),
        queryClient.invalidateQueries({ queryKey: planDayQueryKey(user.id, today) }),
      ]);
      setSheetOpen(false);
      setPending(null);
      toast.success("Rebuilt remaining day from now.");
    } catch (e: any) {
      toast.error(e?.message || "Unable to rebuild plan right now.");
    }
  };

  if (!isPro) return null;

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetContent side="bottom" className="rounded-t-2xl border-soft bg-popover">
        <SheetHeader className="text-left mb-3">
          <SheetTitle className="text-[16px]">Looks like you drifted from your plan.</SheetTitle>
        </SheetHeader>
        <div className="space-y-2">
          <Button onClick={rebuildFromNow} className="w-full h-11 rounded-xl">
            Rebuild from now
          </Button>
          <Button
            variant="outline"
            className="w-full h-11 rounded-xl border-soft"
            onClick={() => setSheetOpen(false)}
          >
            I&apos;m back on track
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

