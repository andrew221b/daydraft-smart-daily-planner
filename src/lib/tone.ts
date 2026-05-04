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
  { key: "professional", emoji: "🎯", title: "Professional", sub: "Clear, concise, practical" },
  { key: "coach",        emoji: "🤝", title: "Coach",        sub: "Supportive and action-oriented" },
  { key: "playful",      emoji: "✨", title: "Playful",      sub: "Light and friendly, still clear" },
  { key: "motivational", emoji: "🚀", title: "Motivational", sub: "Energetic and momentum-focused" },
  { key: "tough_love",   emoji: "🥊", title: "Tough love",   sub: "Direct accountability, no sugarcoating" },
  { key: "philosophical",emoji: "🪶", title: "Philosophical", sub: "Reflective and perspective-driven" },
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
    plan_hint: "Confirm estimates, anchor meetings, and build a realistic schedule",
    start_first: "Start first block",
    start_next: "Start next block",
    recap_cta: "Open recap",
    track_label: "Track time on this",
  },
  coach: {
    plan_cta: "Let's plan your day",
    plan_hint: "We'll size each task and shape a steady flow",
    start_first: "Let's begin",
    start_next: "You're doing great, continue",
    recap_cta: "Review today together",
    track_label: "Track this block",
  },
  playful: {
    plan_cta: "Let's make today click ✨",
    plan_hint: "Quick estimates, clean structure, smooth execution",
    start_first: "Let's roll",
    start_next: "Next block",
    recap_cta: "See today's progress",
    track_label: "Track this",
  },
  motivational: {
    plan_cta: "Build today's momentum 🚀",
    plan_hint: "Set clear estimates, prioritize hard work, finish strong",
    start_first: "Start strong",
    start_next: "Keep momentum",
    recap_cta: "Review today's progress",
    track_label: "Track the work",
  },
  tough_love: {
    plan_cta: "Plan it. Then execute.",
    plan_hint: "Prioritize, commit, and finish what matters",
    start_first: "Start. Now.",
    start_next: "Next. Move.",
    recap_cta: "Face today",
    track_label: "Track. No hiding.",
  },
  philosophical: {
    plan_cta: "Compose your day",
    plan_hint: "Set intention, then translate it into rhythm",
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