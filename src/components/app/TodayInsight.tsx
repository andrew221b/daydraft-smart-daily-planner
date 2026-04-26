import { useEffect, useMemo, useState } from "react";
import { Sparkles, Quote } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";

type Tone = "professional" | "coach" | "playful" | "motivational" | "tough_love" | "philosophical";

const QUOTES: Record<Tone, string[]> = {
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

const ctxMessages = (h: number, tone: Tone, doneRatio: number | null): string | null => {
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
  const [rotateTick, setRotateTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTickHour(new Date().getHours()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Tap to rotate to the next quote.
  const onTap = () => setRotateTick(t => t + 1);

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

  const tone = ((): Tone => {
    try {
      const t = (profile as any)?.ai_tone || localStorage.getItem("dd_ai_tone");
      if (t && ["professional","coach","playful","motivational","tough_love","philosophical"].includes(t)) return t as Tone;
    } catch {/* ignore */}
    return "motivational";
  })();

  const { text, isQuote } = useMemo(() => {
    const ratio = yesterdayPlanned ? (yesterdayDone || 0) / yesterdayPlanned : null;
    // Alternate context line and quote so users see both signal and inspiration.
    const showQuote = rotateTick % 2 === 1;
    if (showQuote) {
      const pool = QUOTES[tone];
      const idx = (Math.floor(Date.now() / 3_600_000) + Math.floor(rotateTick / 2)) % pool.length;
      return { text: pool[idx], isQuote: true };
    }
    return { text: ctxMessages(tickHour, tone, ratio) || QUOTES[tone][0], isQuote: false };
  }, [tickHour, yesterdayDone, yesterdayPlanned, tone, rotateTick]);

  return (
    <button
      onClick={onTap}
      className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 shadow-glow max-w-full pressable hover:bg-primary/15 transition-colors"
      aria-label="Tap for another insight"
    >
      {isQuote
        ? <Quote className="h-3.5 w-3.5 text-primary shrink-0" />
        : <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" fill="currentColor" />}
      <span className="text-xs font-medium text-primary truncate">{text}</span>
    </button>
  );
};