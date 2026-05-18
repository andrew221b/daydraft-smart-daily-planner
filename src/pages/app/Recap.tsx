import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { Block, todayDateStr, parseDateStr, friendlyDateFor, dateStr, isUserTask, isUserTaskDone, isOpenUserTask } from "@/lib/daydraft";
import { Sparkles, Clock, RotateCcw, TrendingUp, Smile, Meh, Frown, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimeTracker, fmtHM } from "@/hooks/useTimeTracker";
import { toast } from "sonner";
import { effectiveDoneMinutes } from "@/lib/blockActualTime";
import { haptics } from "@/lib/haptics";
import { KpiCard } from "@/components/app/KpiCard";
import { weeklyProductScore } from "@/lib/productPolish";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";

export default function Recap() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const rawDate = searchParams.get("date");
  const viewDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayDateStr();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [insight, setInsight] = useState<string | null>(null);
  const { todayTotalSec, categories, refresh: refreshTracker } = useTimeTracker();
  const [backfilled, setBackfilled] = useState(false);
  const [carriedOver, setCarriedOver] = useState(false);
  const [mood, setMood] = useState<"good" | "ok" | "bad" | null>(null);
  const [lastWeekFocusMin, setLastWeekFocusMin] = useState<number | null>(null);
  const [weeklyScore, setWeeklyScore] = useState<{ score: number; tips: string[] } | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [actualTrackedSec, setActualTrackedSec] = useState(0);
  const { isPro } = useEntitlement();

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: p } = await supabase.from("plans").select("id").eq("user_id", user.id).eq("date", viewDate).maybeSingle();
      if (!p) {
        // Don't silently bounce — show empty state so the user can act intentionally.
        setBlocks([]);
        return;
      }
      const { data: bs } = await supabase.from("blocks").select("*").eq("plan_id", p.id).order("position");
      const list = (bs || []) as Block[];
      setBlocks(list);
      // Average completed deep_work min/day across last 7 days (excluding today).
      // Local date — UTC slice would shift a day in negative-UTC timezones.
      const sevenAgo = new Date();
      sevenAgo.setDate(sevenAgo.getDate() - 7);
      const { data: prev } = await supabase
        .from("blocks")
        .select("duration_min, plans!inner(date)")
        .eq("user_id", user.id)
        .eq("kind", "task")
        .eq("type", "deep_work")
        .eq("completed", true)
        .eq("is_calendar_event", false)
        .gte("plans.date", dateStr(sevenAgo))
        .lt("plans.date", todayDateStr());
      if (prev) {
        const total = (prev as any[]).reduce((s, r) => s + (r.duration_min || 0), 0);
        setLastWeekFocusMin(Math.round(total / 7));
      }
      try {
        const { data } = await supabase.functions.invoke("generate-insight", {
          body: {
            blocks: list,
            energy_preference: profile?.energy_preference || "morning",
            ai_tone: (profile as any)?.ai_tone || "professional",
            ai_tone_custom: (profile as any)?.ai_tone_custom || null,
          },
        });
        if (data?.insight) setInsight(data.insight);
      } catch {/* ignore */}
    })();
  }, [user?.id, profile?.energy_preference, viewDate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 6);
      const { data: plans } = await supabase
        .from("plans")
        .select("id,date")
        .eq("user_id", user.id)
        .gte("date", dateStr(since))
        .order("date", { ascending: true });
      const planIds = (plans || []).map((p: any) => p.id).filter(Boolean);
      if (!planIds.length) {
        setWeeklyScore(null);
        return;
      }
      const { data: weeklyBlocks } = await supabase
        .from("blocks")
        .select("*")
        .in("plan_id", planIds)
        .order("position", { ascending: true });
      const grouped = new Map<string, Block[]>();
      (weeklyBlocks || []).forEach((b: any) => {
        const list = grouped.get(b.plan_id) || [];
        list.push(b as Block);
        grouped.set(b.plan_id, list);
      });
      const days = planIds.map((id) => grouped.get(id) || []);
      setWeeklyScore(weeklyProductScore(days));
    })();
  }, [user?.id, viewDate]);
  useEffect(() => {
    if (!user) return;
    (async () => {
      const dayStart = new Date(parseDateStr(viewDate));
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const { data: entries } = await supabase
        .from("time_entries")
        .select("started_at,ended_at")
        .eq("user_id", user.id)
        .gte("started_at", dayStart.toISOString())
        .lt("started_at", dayEnd.toISOString());
      const sec = (entries || []).reduce((sum: number, row: any) => {
        const s = new Date(row.started_at).getTime();
        const e = row.ended_at ? new Date(row.ended_at).getTime() : Date.now();
        return sum + Math.max(0, (e - s) / 1000);
      }, 0);
      setActualTrackedSec(sec);
    })();
  }, [user?.id, viewDate]);

  const tasks = blocks.filter(isUserTask);
  const done = tasks.filter((b) => isUserTaskDone(b)).length;
  const focusMin = tasks.filter((b) => isUserTaskDone(b) && b.type === "deep_work").reduce((s, b) => s + effectiveDoneMinutes(b), 0);
  const plannedMin = tasks.reduce((s, b) => s + b.duration_min, 0);
  const completedMin = tasks.filter((b) => isUserTaskDone(b)).reduce((s, b) => s + effectiveDoneMinutes(b), 0);
  const eff = plannedMin ? Math.round((completedMin / plannedMin) * 100) : 0;
  const trackingCoverage = completedMin > 0 ? Math.round((actualTrackedSec / (completedMin * 60)) * 100) : 0;
  const fh = Math.floor(focusMin / 60), fm = focusMin % 60;

  // Tiny haptic when the day reaches 100% — quiet, no confetti.
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (viewDate !== todayDateStr()) return;
    if (tasks.length > 0 && tasks.every((b) => !isOpenUserTask(b)) && !celebratedRef.current) {
      celebratedRef.current = true;
      haptics.notify("success");
    }
  }, [tasks.length, done, viewDate]);

  // Restore previously recorded mood for this day (local-only).
  useEffect(() => {
    try {
      const m = localStorage.getItem(`dd_mood_${viewDate}`);
      if (m === "good" || m === "ok" || m === "bad") setMood(m);
      else setMood(null);
    } catch {/* ignore */}
  }, [viewDate]);

  const weekDelta = lastWeekFocusMin != null && lastWeekFocusMin > 0
    ? Math.round(((focusMin - lastWeekFocusMin) / lastWeekFocusMin) * 100)
    : null;

  const recordMood = (m: "good" | "ok" | "bad") => {
    haptics.selection();
    setMood(m);
    // Mood is intentionally local-only: storing it as a `quick_capture` polluted
    // the inbox with `[mood:*]` pseudo-tasks. Until there's a dedicated table,
    // keep moods on-device — they're used for nothing on the backend yet.
    try { localStorage.setItem(`dd_mood_${viewDate}`, m); } catch {/* ignore */}
    toast.success("Thanks — that helps tune your plans");
  };

  // "Forgot to track?" — completed focus minutes vs tracked seconds today.
  // Only ever offered for TODAY's recap. On a past day we can't sensibly
  // backfill (the timer source-of-truth is `now`), and crediting hours dated
  // "today" for work that happened yesterday would corrupt the tracker.
  const isTodayRecap = viewDate === todayDateStr();
  const completedFocusSec = tasks.filter((b) => isUserTaskDone(b)).reduce((s, b) => s + effectiveDoneMinutes(b) * 60, 0);
  const showRecover = isTodayRecap && !backfilled && completedFocusSec >= 30 * 60 && todayTotalSec < completedFocusSec * 0.5;

  const backfill = async () => {
    if (!user) return;
    if (!isTodayRecap) { toast.error("Backfill is only available for today"); return; }
    const cat = categories.find(c => c.is_default) || categories[0];
    if (!cat) { toast.error("No category found"); return; }
    const completed = tasks.filter((b) => isUserTaskDone(b));
    const now = new Date();
    // Sequentially place blocks ending now, going backwards
    let cursor = now.getTime();
    const rows = completed.map((b) => {
      const end = new Date(cursor);
      const mins = effectiveDoneMinutes(b);
      cursor -= mins * 60 * 1000;
      const start = new Date(cursor);
      return {
        user_id: user.id,
        category_id: cat.id,
        started_at: start.toISOString(),
        ended_at: end.toISOString(),
        source: "recap",
        block_id: b.id,
        note: b.title,
      };
    });
    if (!rows.length) return;
    const { error } = await supabase.from("time_entries").insert(rows);
    if (error) { toast.error(error.message); return; }
    setBackfilled(true);
    await refreshTracker();
    toast.success("Tracked time recorded");
  };

  // Carry unfinished tasks to tomorrow's quick_captures inbox so they're
  // pre-loaded into the next plan. One-tap shortcut for the 80% case.
  const unfinished = tasks.filter((b) => isOpenUserTask(b));

  const carryOver = async () => {
    if (!user || unfinished.length === 0) return;
    // Tag with the target date so Today.tsx only consumes captures meant for
    // the day being planned — prevents leaking into unrelated future plans.
    const next = new Date(parseDateStr(viewDate)); next.setDate(next.getDate() + 1);
    const targetDate = dateStr(next);
    const rows = unfinished.map(b => ({
      user_id: user.id,
      content: `[for:${targetDate}] ${b.title}`,
      consumed: false,
    }));
    const { data: inserted, error } = await supabase
      .from("quick_captures")
      .insert(rows as any)
      .select("id");
    if (error) { toast.error(error.message); return; }
    haptics.notify("success");
    setCarriedOver(true);
    const ids = (inserted || []).map((r: any) => r.id).filter(Boolean);
    // Universal undo — easy to mis-fire from the recap.
    toast.success(`Moved ${unfinished.length} to ${friendlyDateFor(next).toLowerCase()}'s inbox`, {
      action: {
        label: "Undo",
        onClick: async () => {
          if (!ids.length) return;
          await supabase.from("quick_captures").delete().in("id", ids);
          setCarriedOver(false);
          toast("Carry-forward reverted");
        },
      },
      duration: 6000,
    });
  };

  return (
    <Shell>
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-52 pointer-events-none" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative px-5 pt-10">
          <div className="hero-glass panel-luxe px-5 py-5 md:px-6 py-5">
            <h1 className="font-display text-[30px] font-semibold leading-[1.07] text-balance">
              {viewDate === todayDateStr() ? "Day complete." : `Recap · ${friendlyDateFor(parseDateStr(viewDate))}`}
            </h1>
            <p className="mt-2 text-secondary-fg">
              {parseDateStr(viewDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>

          {tasks.length === 0 && (
            <div className="mt-8 app-card px-6 py-5 text-center">
              <div className="text-sm font-medium">No recap available yet</div>
              <p className="text-xs text-secondary-fg mt-1">No plan exists for this day.</p>
              <Button onClick={() => nav(viewDate === todayDateStr() ? "/today" : `/today?date=${viewDate}`)}
                className="mt-4 h-10 px-5 rounded-xl text-primary-foreground text-sm font-medium pressable"
               >
                Open planner
              </Button>
            </div>
          )}

          {tasks.length > 0 && (
          <>

          <div className="grid grid-cols-3 gap-2.5 mt-6 section-switch-stagger">
            <KpiCard label="Tasks done" value={`${done}/${tasks.length}`} tone="primary" />
            <KpiCard label="Planned done" value={fmtHM(completedMin * 60)} />
            <KpiCard label="Actual tracked" value={fmtHM(actualTrackedSec)} tone={trackingCoverage >= 70 ? "success" : "neutral"} />
          </div>

          {/* Negative-delta callouts removed — recap should encourage, not
              shame. We only celebrate gains; deeper trends live in History. */}
          {weekDelta != null && weekDelta > 0 && (
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-secondary-fg">
              <TrendingUp className="h-3.5 w-3.5 text-success" />
              <span><span className="text-success font-semibold">+{weekDelta}%</span> deep work vs last week's daily avg — keep it going.</span>
            </div>
          )}
          {weekDelta != null && weekDelta <= 0 && focusMin > 0 && (
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-secondary-fg">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Focused {fmtHM(focusMin * 60)} today. Tomorrow's a fresh shot.</span>
            </div>
          )}

          {isTodayRecap && (
          <div className="mt-6 app-card px-4 py-5">
            <div className="eyebrow mb-3">How did today feel?</div>
            <div className="flex gap-2">
              {([
                { k: "good" as const, Icon: Smile, label: "Great" },
                { k: "ok" as const, Icon: Meh, label: "OK" },
                { k: "bad" as const, Icon: Frown, label: "Rough" },
              ]).map(({ k, Icon, label }) => (
                <button
                  key={k}
                  onClick={() => recordMood(k)}
                  className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border pressable ${
                    mood === k ? "surface-accent border-accent text-primary" : "bg-background border-soft text-secondary-fg"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[11px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>
          )}

          {showRecover && (
            <button
              onClick={backfill}
              className="mt-6 w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-accent surface-accent text-left pressable"
            >
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">Forgot to track today?</div>
                <div className="text-xs text-secondary-fg">You only tracked {fmtHM(todayTotalSec)} but completed {fh}h {fm}m of focus. Tap to credit it.</div>
              </div>
              <span className="text-xs font-semibold text-primary shrink-0">Credit →</span>
            </button>
          )}

          {isTodayRecap && unfinished.length > 0 && !carriedOver && (
            <button
              onClick={carryOver}
              className="mt-3 w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-soft surface-card text-left pressable hover:border-primary/30"
            >
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <RotateCcw className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">Carry {unfinished.length} unfinished to tomorrow</div>
                <div className="text-xs text-secondary-fg truncate">{unfinished.map(b => b.title).join(", ")}</div>
              </div>
              <span className="text-xs font-semibold text-primary shrink-0">Move →</span>
            </button>
          )}

          <div className="mt-5 app-card px-4 py-5">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <span className="eyebrow">Today&apos;s insight</span>
            </div>
            <p className="text-[14.5px] leading-[1.55] mt-2.5 text-subtle">
              {insight || "Reflecting on your day..."}
            </p>
          </div>

          {weeklyScore && (
            <div className="mt-3 app-card px-4 py-5">
              <div className="flex items-center gap-2 text-primary">
                <Gauge className="h-4 w-4" />
                <span className="eyebrow">Weekly score</span>
              </div>
              <div className="mt-2 text-[26px] font-semibold font-display">{weeklyScore.score}<span className="text-[14px] text-secondary-fg">/100</span></div>
              <div className="mt-2 space-y-1.5">
                {weeklyScore.tips.map((tip) => (
                  <p key={tip} className="text-[12.5px] text-secondary-fg leading-relaxed">
                    {tip}
                  </p>
                ))}
              </div>
            </div>
          )}
          {!isPro && weeklyScore && weeklyScore.score >= 65 && isTodayRecap && (
            <button
              type="button"
              onClick={() => setUpgradeOpen(true)}
              className="mt-3 w-full h-10 rounded-xl border border-accent surface-accent text-[12px] text-primary font-medium pressable"
            >
              Unlock Pro coaching from this momentum
            </button>
          )}

          {/* "Tomorrow looks like" was a static placeholder — removed. The
              insight card above and the carry-over button cover what users
              actually act on. */}

          <div className="mt-10 space-y-3">
            {viewDate === todayDateStr() ? (
              <>
                <Button
                  onClick={() => {
                    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
                    nav(`/today?date=${dateStr(tomorrow)}`);
                  }}
                  className="w-full h-13 py-3.5 rounded-xl bg-primary hover:bg-primary/92 text-primary-foreground text-[15px] font-medium pressable shadow-card"
                 >
                  Plan tomorrow
                </Button>
                <button onClick={() => nav("/recap/week")} className="w-full text-primary text-sm hover:underline">
                  See your week →
                </button>
              </>
            ) : (
              // History recap is read-only: no action that re-opens past work.
              <button onClick={() => nav("/history")} className="w-full text-secondary-fg text-sm hover:text-foreground transition-colors">
                ← Back to history
              </button>
            )}
          </div>
          </>
          )}
        </div>
      </div>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="momentum" />
    </Shell>
  );
}
