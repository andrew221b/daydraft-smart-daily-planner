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

export const todayDateStr = () => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
};

export const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
};

export const friendlyDate = () =>
  new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
