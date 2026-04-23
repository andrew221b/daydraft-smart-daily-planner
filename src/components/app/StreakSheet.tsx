import { forwardRef, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useStreak } from "@/hooks/useStreak";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Flame, Snowflake, Trophy, Share2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { todayDateStr } from "@/lib/daydraft";
import { haptics } from "@/lib/haptics";

const WEEKS = 12;

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export const StreakSheet = ({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) => {
  const { streak, restoreWithFreeze } = useStreak();
  const { user } = useAuth();
  const [planned, setPlanned] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    const since = new Date(); since.setDate(since.getDate() - WEEKS * 7);
    supabase.from("plans").select("date").eq("user_id", user.id).gte("date", dateKey(since))
      .then(({ data }) => setPlanned(new Set((data || []).map((r: any) => r.date))));
  }, [open, user?.id]);

  // Build columns of weeks (Mon → Sun), oldest left
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - (WEEKS * 7 - 1));
  // Align start to Monday
  const dow = (start.getDay() + 6) % 7; start.setDate(start.getDate() - dow);
  const weeks: Date[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const col: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
      col.push(day);
    }
    weeks.push(col);
  }

  const milestones = [
    { n: 7, label: "Week one" },
    { n: 30, label: "One month" },
    { n: 100, label: "Centurion" },
  ];
  const current = streak?.current_streak ?? 0;
  const longest = streak?.longest_streak ?? 0;
  const freezes = streak?.freezes_remaining ?? 0;

  // Recovery is offered when the user planned exactly two days ago (yesterday was missed)
  // and they still have a freeze available.
  const canRestore = (() => {
    if (!streak?.last_planned_date || freezes < 1) return false;
    const t = new Date(todayDateStr() + "T00:00:00").getTime();
    const lp = new Date(streak.last_planned_date + "T00:00:00").getTime();
    return Math.round((t - lp) / 86400000) === 2;
  })();

  const restore = async () => {
    const ok = await restoreWithFreeze();
    if (ok) { haptics.notify("success"); toast.success("Streak restored 🔥"); }
    else toast.error("Couldn't restore");
  };

  const share = async () => {
    setSharing(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-share-card", {
        body: { current, longest },
      });
      if (error) throw error;
      const dataUrl: string = data?.image;
      if (!dataUrl) throw new Error("No image returned");
      // Convert data URL → blob
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `daydraft-streak-${current}.png`, { type: "image/png" });
      const navAny = navigator as any;
      if (navAny.canShare && navAny.canShare({ files: [file] })) {
        await navAny.share({ files: [file], title: "DayDraft streak", text: `${current}-day streak on DayDraft 🔥` });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl; a.download = file.name; a.click();
        toast.success("Streak card downloaded");
      }
    } catch (e: any) {
      toast.error(e.message || "Couldn't generate card");
    } finally { setSharing(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl border-border bg-surface-elevated max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-primary" fill="currentColor" />
            <span>Your streak</span>
          </SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <Stat label="Current" value={`${current}`} sub="days" highlight />
          <Stat label="Longest" value={`${longest}`} sub="days" />
          <Stat label="Freezes" value={`${freezes}`} sub="left this week" />
        </div>

        <div className="mt-6">
          <div className="text-xs text-secondary-fg mb-2 uppercase tracking-wide">Last {WEEKS} weeks</div>
          <div className="flex gap-1">
            {weeks.map((col, i) => (
              <div key={i} className="flex flex-col gap-1">
                {col.map((day) => {
                  const k = dateKey(day);
                  const isFuture = day > today;
                  const isPlanned = planned.has(k);
                  return (
                    <div
                      key={k}
                      title={k}
                      className={`h-3 w-3 rounded-[3px] ${
                        isFuture ? "bg-surface border border-border/50"
                          : isPlanned ? "bg-primary shadow-glow"
                          : "bg-surface border border-border"
                      }`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <div className="text-xs text-secondary-fg mb-2 uppercase tracking-wide">Milestones</div>
          <div className="grid grid-cols-3 gap-2">
            {milestones.map(m => {
              const reached = longest >= m.n;
              return (
                <div key={m.n} className={`rounded-2xl border p-3 text-center ${reached ? "border-primary/40 bg-primary/5" : "border-border bg-surface"}`}>
                  <Trophy className={`h-4 w-4 mx-auto ${reached ? "text-primary" : "text-secondary-fg/50"}`} />
                  <div className={`text-sm font-semibold mt-1 ${reached ? "text-primary" : "text-foreground"}`}>{m.n}</div>
                  <div className="text-[10px] text-secondary-fg leading-tight">{m.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-secondary-fg">
          <Snowflake className="h-3.5 w-3.5" />
          <span>One freeze auto-saves your streak if you miss a single day. Refills weekly.</span>
        </div>

        {canRestore && (
          <button onClick={restore}
            className="w-full mt-4 flex items-center gap-3 px-4 py-3 rounded-2xl border border-primary/30 bg-primary/5 text-left pressable">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <RotateCcw className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground">Missed yesterday?</div>
              <div className="text-xs text-secondary-fg">Use a freeze to keep your {current}-day streak alive.</div>
            </div>
            <span className="text-xs font-semibold text-primary shrink-0">Restore →</span>
          </button>
        )}

        <Button onClick={share} disabled={sharing || current === 0} className="w-full mt-6 h-12 rounded-xl text-primary-foreground font-medium pressable shadow-glow"
          style={{ background: "var(--gradient-primary)" }}>
          <Share2 className="h-4 w-4 mr-2" /> {sharing ? "Generating..." : "Share streak"}
        </Button>
      </SheetContent>
    </Sheet>
  );
};

const Stat = forwardRef<HTMLDivElement, { label: string; value: string; sub: string; highlight?: boolean }>(
  ({ label, value, sub, highlight }, ref) => (
    <div ref={ref} className={`rounded-2xl border p-3 text-center ${highlight ? "border-primary/40 bg-primary/5 shadow-glow" : "border-border bg-surface"}`}>
      <div className={`text-2xl font-semibold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
      <div className="text-[10px] text-secondary-fg uppercase tracking-wide mt-1">{label}</div>
      <div className="text-[10px] text-secondary-fg/70">{sub}</div>
    </div>
  )
);
Stat.displayName = "Stat";