import { useEffect, useMemo, useState } from "react";
import { Sparkles, Quote } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { getTone, type Tone } from "@/lib/tone";

type CoreTone = Exclude<Tone, "custom">;

const QUOTES: Record<CoreTone, string[]> = {
  professional: [
    "Plan deliberately. Execute with focus.",
    "Discipline equals freedom. — Jocko Willink",
    "What gets scheduled gets done.",
    "Quality of attention determines quality of output.",
  ],
  coach: [
    "One block at a time. You've got this.",
    "Show up for the version of you that planned this.",
    "Progress > perfection. Move.",
    "The only bad plan is the one you don't start.",
  ],
  playful: [
    "Today's vibe: focused chaos. ✨",
    "Let's make today's to-do list jealous.",
    "Coffee in. Plans out. Let's roll. ☕",
    "Plot twist: you crush this list.",
  ],
  motivational: [
    "🔥 You don't rise to the level of your goals — you fall to the level of your systems.",
    "🚀 Small daily improvements compound into stunning results.",
    "💪 The day is yours. Make it count.",
    "⚡ Action is the antidote to anxiety.",
  ],
  tough_love: [
    "Stop scrolling. Start the first block.",
    "Nobody's coming to save your day. You are.",
    "Excuses don't ship. Tasks do.",
    "Discomfort is the price of growth. Pay it.",
  ],
  philosophical: [
    "\"We are what we repeatedly do.\" — Aristotle",
    "\"The two most powerful warriors are patience and time.\" — Tolstoy",
    "\"He who has a why can bear almost any how.\" — Nietzsche",
    "\"The obstacle is the way.\" — Marcus Aurelius",
  ],
};

const ctxMessages = (h: number, tone: CoreTone, doneRatio: number | null): string | null => {
  // Context-aware overlay only ~30% of the time so cycling through quotes still happens.
  const ctx: string[] = [];
  if (doneRatio != null && doneRatio >= 0.8) {
    ctx.push(tone === "tough_love" ? "Yesterday was solid. Don't coast." :
             tone === "playful" ? "Yesterday slapped. Let's encore. 🎯" :
             tone === "philosophical" ? "Momentum is a debt the present owes the past." :
             "Yesterday's win is today's fuel.");
  }
  if (doneRatio != null && doneRatio < 0.3 && doneRatio >= 0) {
    ctx.push(tone === "tough_love" ? "Yesterday underperformed. Reset. Move." :
             tone === "coach" ? "Reset day. Pick three wins, no more." :
             "Fresh start. Fewer, sharper tasks.");
  }
  if (h < 11) ctx.push(tone === "professional" ? "Mornings: highest cognitive ROI." : "Mornings are made for the hard thing first.");
  else if (h < 14) ctx.push("Midday — protect one hour for deep work.");
  else if (h < 17) ctx.push("Afternoon energy dips. Batch the small stuff.");
  else if (h < 20) ctx.push("Wrap-up time. What deserves tomorrow?");
  else ctx.push("Plan tonight, win the morning.");
  return ctx[0] || null;
};

export const TodayInsight = () => {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [yesterdayDone, setYesterdayDone] = useState<number | null>(null);
  const [yesterdayPlanned, setYesterdayPlanned] = useState<number | null>(null);
  const [tickHour, setTickHour] = useState(() => new Date().getHours());

  useEffect(() => {
    const t = setInterval(() => setTickHour(new Date().getHours()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Insight is intentionally static per session — the user said the
  // tap-to-rotate flicker felt unstable. Keep it calm.

  useEffect(() => {
    if (!user) return;
    (async () => {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const ymd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
      const { data: p } = await supabase
        .from("plans")
        .select("id")
        .eq("user_id", user.id)
        .eq("date", ymd)
        .maybeSingle();
      if (!p) { setYesterdayDone(0); setYesterdayPlanned(0); return; }
      const { data: bs } = await supabase
        .from("blocks")
        .select("completed, kind")
        .eq("plan_id", p.id);
      const tasks = (bs || []).filter((b: any) => b.kind === "task");
      setYesterdayPlanned(tasks.length);
      setYesterdayDone(tasks.filter((b: any) => b.completed).length);
    })();
  }, [user?.id]);

  const rawTone = getTone(profile as any);
  const safeTone: CoreTone = rawTone === "custom" ? "professional" : rawTone;

  const { text, isQuote } = useMemo(() => {
    const ratio = yesterdayPlanned ? (yesterdayDone || 0) / yesterdayPlanned : null;
    // Pick ONE thing for the whole session: context line if we have a strong
    // signal (great/poor yesterday or specific time-of-day), otherwise a quote
    // pinned for the day so it doesn't flicker.
    const ctx = ctxMessages(tickHour, safeTone, ratio);
    if (ctx && (ratio == null || ratio >= 0.8 || ratio < 0.3)) {
      return { text: ctx, isQuote: false };
    }
    const pool = QUOTES[safeTone];
    // Same quote across the whole calendar day per tone.
    const dayKey = Math.floor(Date.now() / 86_400_000);
    return { text: pool[dayKey % pool.length], isQuote: true };
  }, [tickHour, yesterdayDone, yesterdayPlanned, safeTone]);

  return (
    <div
      className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 shadow-glow max-w-full"
      aria-label="Today's insight"
    >
      {isQuote
        ? <Quote className="h-3.5 w-3.5 text-primary shrink-0" />
        : <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" fill="currentColor" />}
      <span className="text-xs font-medium text-primary truncate">{text}</span>
    </div>
  );
};