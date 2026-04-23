import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { Block, todayDateStr, parseDateStr, friendlyDateFor, dateStr } from "@/lib/daydraft";
import { Sparkles, Clock, RotateCcw, TrendingUp, Smile, Meh, Frown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTimeTracker, fmtHM } from "@/hooks/useTimeTracker";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import { Confetti } from "@/components/app/Confetti";

export default function Recap() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const viewDate = searchParams.get("date") || todayDateStr();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [insight, setInsight] = useState<string | null>(null);
  const { todayTotalSec, categories, refresh: refreshTracker } = useTimeTracker();
  const [backfilled, setBackfilled] = useState(false);
  const [carriedOver, setCarriedOver] = useState(false);
  const [mood, setMood] = useState<"good" | "ok" | "bad" | null>(null);
  const [lastWeekFocusMin, setLastWeekFocusMin] = useState<number | null>(null);
  const [confettiFired, setConfettiFired] = useState(false);

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
      // Average completed deep_work min/day across last 7 days (excluding today)
      const sevenAgo = new Date();
      sevenAgo.setDate(sevenAgo.getDate() - 7);
      const { data: prev } = await supabase
        .from("blocks")
        .select("duration_min, plans!inner(date)")
        .eq("user_id", user.id)
        .eq("kind", "task")
        .eq("type", "deep_work")
        .eq("completed", true)
        .gte("plans.date", sevenAgo.toISOString().slice(0, 10))
        .lt("plans.date", todayDateStr());
      if (prev) {
        const total = (prev as any[]).reduce((s, r) => s + (r.duration_min || 0), 0);
        setLastWeekFocusMin(Math.round(total / 7));
      }
      try {
        const { data } = await supabase.functions.invoke("generate-insight", {
          body: { blocks: list, energy_preference: profile?.energy_preference || "morning" },
        });
        if (data?.insight) setInsight(data.insight);
      } catch {/* ignore */}
    })();
  }, [user?.id, profile?.energy_preference, viewDate]);

  const tasks = blocks.filter(b => b.kind === "task");
  const done = tasks.filter(b => b.completed).length;
  const focusMin = tasks.filter(b => b.completed && b.type === "deep_work").reduce((s, b) => s + b.duration_min, 0);
  const plannedMin = tasks.reduce((s, b) => s + b.duration_min, 0);
  const completedMin = tasks.filter(b => b.completed).reduce((s, b) => s + b.duration_min, 0);
  const eff = plannedMin ? Math.round((completedMin / plannedMin) * 100) : 0;
  const fh = Math.floor(focusMin / 60), fm = focusMin % 60;

  // Fire confetti once when 100% of tasks are done — only on today's recap.
  // Past days are always "100% done in retrospect"; we don't want a celebration
  // every time the user browses history.
  useEffect(() => {
    if (viewDate !== todayDateStr()) return;
    if (tasks.length > 0 && done === tasks.length && !confettiFired) {
      setConfettiFired(true);
      haptics.notify("success");
    }
  }, [tasks.length, done, confettiFired, viewDate]);

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

  // "Forgot to track?" — completed focus minutes vs tracked seconds today
  const completedFocusSec = tasks.filter(b => b.completed).reduce((s, b) => s + b.duration_min * 60, 0);
  const showRecover = !backfilled && completedFocusSec >= 30 * 60 && todayTotalSec < completedFocusSec * 0.5;

  const backfill = async () => {
    if (!user) return;
    const cat = categories.find(c => c.is_default) || categories[0];
    if (!cat) { toast.error("No category found"); return; }
    const completed = tasks.filter(b => b.completed);
    const now = new Date();
    // Sequentially place blocks ending now, going backwards
    let cursor = now.getTime();
    const rows = completed.map((b) => {
      const end = new Date(cursor);
      cursor -= b.duration_min * 60 * 1000;
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
  const unfinished = tasks.filter(b => !b.completed);
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
          toast("Carry-over undone");
        },
      },
      duration: 6000,
    });
  };

  return (
    <Shell>
      <Confetti fire={confettiFired} />
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-72 pointer-events-none" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative px-6 pt-16">
          <h1 className="text-[34px] font-semibold leading-tight">
            {viewDate === todayDateStr() ? "Day complete." : `Recap · ${friendlyDateFor(parseDateStr(viewDate))}`}
          </h1>
          <p className="text-secondary-fg mt-1">{parseDateStr(viewDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>

          {tasks.length === 0 && (
            <div className="mt-8 rounded-2xl bg-surface-elevated border border-border shadow-card p-6 text-center">
              <div className="text-sm font-medium">Nothing to recap yet</div>
              <p className="text-xs text-secondary-fg mt-1">No plan exists for this day.</p>
              <Button onClick={() => nav(viewDate === todayDateStr() ? "/today" : `/today?date=${viewDate}`)}
                className="mt-4 h-10 px-5 rounded-xl text-primary-foreground text-sm font-medium pressable shadow-glow"
                style={{ background: "var(--gradient-primary)" }}>
                Open planner
              </Button>
            </div>
          )}

          {tasks.length > 0 && (
          <>

          <div className="grid grid-cols-3 gap-3 mt-8">
            <Stat label="Tasks done" value={`${done}/${tasks.length}`} />
            <Stat label="Focus time" value={`${fh}h ${fm}m`} />
            <Stat label="Efficiency" value={`${eff}%`} />
          </div>

          {weekDelta != null && (
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-secondary-fg">
              <TrendingUp className={`h-3.5 w-3.5 ${weekDelta >= 0 ? "text-success" : "text-destructive"}`} />
              {weekDelta >= 0
                ? <span><span className="text-success font-semibold">+{weekDelta}%</span> deep work vs last week's daily avg</span>
                : <span><span className="text-destructive font-semibold">{weekDelta}%</span> vs last week's daily avg</span>}
            </div>
          )}

          <div className="mt-6 rounded-2xl bg-surface border border-border p-4">
            <div className="text-[11px] uppercase tracking-wider text-secondary-fg mb-2">How did today feel?</div>
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
                    mood === k ? "bg-primary/10 border-primary/40 text-primary" : "bg-background border-border text-secondary-fg"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[11px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {showRecover && (
            <button
              onClick={backfill}
              className="mt-6 w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-primary/30 bg-primary/5 text-left pressable"
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

          {unfinished.length > 0 && !carriedOver && (
            <button
              onClick={carryOver}
              className="mt-3 w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-border bg-surface text-left pressable hover:border-primary/30"
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

          <div className="mt-6 rounded-2xl bg-surface-elevated border border-border shadow-card p-4">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Today's insight</span>
            </div>
            <p className="text-[15px] leading-relaxed mt-2">
              {insight || "Reflecting on your day..."}
            </p>
          </div>

          {/* "Tomorrow looks like" was a static placeholder — removed. The
              insight card above and the carry-over button cover what users
              actually act on. */}

          <div className="mt-10 space-y-3">
            <Button
              onClick={() => {
                // Send the user to plan the day AFTER the one they're recapping,
                // not blindly to today's planner. This makes "Plan Tomorrow" do
                // the obvious thing whether they're on today's recap or browsing
                // a past day's recap.
                const base = new Date(parseDateStr(viewDate));
                base.setDate(base.getDate() + 1);
                const target = dateStr(base);
                nav(target === todayDateStr() ? "/today" : `/today?date=${target}`);
              }}
              className="w-full h-13 py-3.5 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
              style={{ background: "var(--gradient-primary)" }}>
              Plan {(() => {
                const base = new Date(parseDateStr(viewDate));
                base.setDate(base.getDate() + 1);
                return friendlyDateFor(base);
              })()}
            </Button>
            <button onClick={() => nav("/recap/week")} className="w-full text-primary text-sm hover:underline">
              See your week →
            </button>
            <button onClick={() => nav("/today")} className="w-full text-secondary-fg text-sm hover:text-foreground transition-colors">
              Done for today
            </button>
          </div>
          </>
          )}
        </div>
      </div>
    </Shell>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl bg-surface border border-border p-3 text-center shadow-card">
    <div className="text-xl font-semibold">{value}</div>
    <div className="text-[11px] text-secondary-fg mt-1 leading-tight">{label}</div>
  </div>
);
