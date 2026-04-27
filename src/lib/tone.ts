import type { Profile } from "@/hooks/useProfile";

export type Tone =
  | "professional"
  | "coach"
  | "playful"
  | "motivational"
  | "tough_love"
  | "philosophical"
  | "custom";

export const TONE_OPTIONS: { key: Tone; emoji: string; title: string; sub: string }[] = [
  { key: "professional", emoji: "🎯", title: "Professional", sub: "Crisp, no fluff" },
  { key: "coach",        emoji: "🤝", title: "Coach",        sub: "Warm, supportive nudges" },
  { key: "playful",      emoji: "✨", title: "Playful",      sub: "Light, a little cheeky" },
  { key: "motivational", emoji: "🚀", title: "Motivational", sub: "High-energy, push mode" },
  { key: "tough_love",   emoji: "🥊", title: "Tough love",   sub: "Direct, no excuses" },
  { key: "philosophical",emoji: "🪶", title: "Philosophical", sub: "Quotes, perspective" },
];

export const getTone = (profile: Pick<Profile, "ai_tone"> | null | undefined): Tone => {
  const t = (profile?.ai_tone as Tone | undefined) || (() => {
    try { return (localStorage.getItem("dd_ai_tone") as Tone) || undefined; } catch { return undefined; }
  })();
  if (t && ["professional","coach","playful","motivational","tough_love","philosophical","custom"].includes(t)) return t;
  return "professional";
};

/** Tone-localized UI copy. Keep keys terse; values short and on-brand. */
const COPY: Record<Tone, Record<string, string>> = {
  professional: {
    plan_cta: "Plan my day",
    plan_hint: "Confirm estimates · pin meetings · auto-schedule",
    start_first: "Start first block",
    start_next: "Start next block",
    recap_cta: "Open recap",
    track_label: "Track time on this",
  },
  coach: {
    plan_cta: "Let's plan today",
    plan_hint: "We'll size things up, then build a calm flow",
    start_first: "Let's begin",
    start_next: "Keep going",
    recap_cta: "How did today go?",
    track_label: "Track this with me",
  },
  playful: {
    plan_cta: "Make today happen ✨",
    plan_hint: "Quick estimates, then we orchestrate the chaos",
    start_first: "Go go go",
    start_next: "Next one →",
    recap_cta: "See the damage 😎",
    track_label: "Stopwatch this one",
  },
  motivational: {
    plan_cta: "Build today 🚀",
    plan_hint: "Lock in estimates · pin meetings · ship the day",
    start_first: "Start strong",
    start_next: "Keep momentum",
    recap_cta: "See today's wins",
    track_label: "Track the work",
  },
  tough_love: {
    plan_cta: "Cut the noise. Plan it.",
    plan_hint: "Estimate. Commit. Execute.",
    start_first: "Start. Now.",
    start_next: "Next. Move.",
    recap_cta: "Face today",
    track_label: "Track. No hiding.",
  },
  philosophical: {
    plan_cta: "Compose your day",
    plan_hint: "First the estimate. Then the rhythm.",
    start_first: "Begin",
    start_next: "Continue",
    recap_cta: "Reflect on today",
    track_label: "Witness this work",
  },
  custom: {
    plan_cta: "Plan my day",
    plan_hint: "Confirm estimates · pin meetings · auto-schedule",
    start_first: "Start first block",
    start_next: "Start next block",
    recap_cta: "Open recap",
    track_label: "Track time on this",
  },
};

export const t = (tone: Tone, key: keyof (typeof COPY)["professional"]) =>
  COPY[tone]?.[key] || COPY.professional[key];

/** Greeting line tuned for the chosen tone. */
export const greetingFor = (tone: Tone, name?: string | null) => {
  const h = new Date().getHours();
  const part = h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 21 ? "Good evening" : "Tonight";
  const who = name ? `, ${name}` : "";
  if (tone === "tough_love") return `${h < 12 ? "Up." : "Heads up."}${who}`;
  if (tone === "playful") return `${part}${who} ✨`;
  if (tone === "philosophical") return `${part}${who}.`;
  return `${part}${who}`;
};