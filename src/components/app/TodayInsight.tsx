import { useEffect, useMemo, useState } from "react";
import { Sparkles, Quote } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { getTone, type Tone } from "@/lib/tone";
import { isUserTask, isUserTaskDone } from "@/lib/daydraft";

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
    "Today's vibe: focused and calm. ✨",
    "Let's turn this list into visible progress.",
    "Coffee in, priorities clear, let's go. ☕",
    "Small wins first, momentum follows.",
  ],
  motivational: [
    "You don't rise to goals, you fall to systems.",
    "Small daily improvements compound quickly.",
    "The day is yours. Make it count.",
    "Action reduces anxiety. Start the next block.",
  ],
  tough_love: [
    "Start the first block now.",
    "Own the day before it owns you.",
    "Output beats intention.",
    "Do the hard task first.",
  ],
  philosophical: [
    "Small choices today become tomorrow's default.",
    "Attention is the scarce resource — spend it on purpose.",
    "A clear plan quiets the noise in your head.",
    "Finish one meaningful thing; let the rest follow.",
  ],
};

const ctxMessages = (h: number, tone: CoreTone, doneRatio: number | null): string | null => {
  const ctx: string[] = [];
  if (doneRatio != null && doneRatio >= 0.8) {
    ctx.push(
      tone === "tough_love"
        ? "You closed most of yesterday. Keep the bar there."
        : tone === "playful"
          ? "Yesterday went well — same energy today?"
          : tone === "philosophical"
            ? "Yesterday's momentum is a head start, not a guarantee."
            : "You finished most of yesterday — build on that today.",
    );
  }
  if (doneRatio != null && doneRatio < 0.3 && doneRatio >= 0) {
    ctx.push(
      tone === "tough_love"
        ? "Yesterday was light on completions. Today: fewer tasks, sharper execution."
        : tone === "coach"
          ? "Clean slate. Pick a small number of wins and protect them."
          : "Fresh start: shorter list, clearer priorities.",
    );
  }
  if (h < 11) {
    ctx.push(
      tone === "professional"
        ? "Mornings are usually the best window for hard thinking."
        : "Mornings reward the hardest task first.",
    );
  } else if (h < 14) ctx.push("Midday: block one uninterrupted hour if you can.");
  else if (h < 17) ctx.push("Afternoon: good time to batch quick tasks and messages.");
  else if (h < 20) ctx.push("Evening: note what should roll to tomorrow so you can switch off.");
  else ctx.push("Late day: a light plan for tomorrow saves morning friction.");
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
        .select("completed, kind, is_calendar_event, resolution")
        .eq("plan_id", p.id);
      const tasks = (bs || []).filter((b: any) => isUserTask(b));
      setYesterdayPlanned(tasks.length);
      setYesterdayDone(tasks.filter((b: any) => isUserTaskDone(b)).length);
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
      className="flex items-start gap-3 px-4 app-card py-5"
      aria-label="Today's insight"
    >
      {isQuote
        ? <Quote className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" strokeWidth={2} />
        : <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />}
      <span className="text-[12.5px] leading-snug text-subtle">{text}</span>
    </div>
  );
};