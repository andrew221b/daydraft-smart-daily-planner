export type EnergyPref = "morning" | "midday" | "night";
export type BlockType = "deep_work" | "communication" | "routine";
export type BlockKind = "task" | "break" | "lunch";

export interface Block {
  id: string;
  plan_id: string;
  user_id: string;
  start_time: string;
  duration_min: number;
  title: string;
  type: BlockType;
  kind: BlockKind;
  completed: boolean;
  position: number;
}

export const peakWindow = (e: EnergyPref) =>
  e === "morning" ? "9am – 1pm" : e === "midday" ? "11am – 3pm" : "7pm – 11pm";

export const typeColor = (t: BlockType) =>
  t === "deep_work" ? "hsl(var(--type-deep))" : t === "communication" ? "hsl(var(--type-comm))" : "hsl(var(--type-routine))";

export const typeLabel = (t: BlockType) =>
  t === "deep_work" ? "Deep Work" : t === "communication" ? "Communication" : "Routine";

export const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hr = ((h + 11) % 12) + 1;
  return m === 0 ? `${hr}${period}` : `${hr}:${String(m).padStart(2, "0")}${period}`;
};

// Local-date YYYY-MM-DD (avoid UTC drift around midnight).
export const dateStr = (d: Date = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const todayDateStr = () => dateStr(new Date());

export const parseDateStr = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export const isFutureDateStr = (s: string) => {
  return parseDateStr(s).getTime() > parseDateStr(todayDateStr()).getTime();
};

export const friendlyDateFor = (d: Date) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(d); target.setHours(0,0,0,0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

export const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
};

export const friendlyDate = () =>
  new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
