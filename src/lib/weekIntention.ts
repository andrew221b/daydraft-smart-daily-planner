/** One-line weekly focus — local only (no migration). Resets each calendar week (Mon start). */

const STORAGE_KEY = "dd_week_intention_v1";

export function mondayKey(d = new Date()): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export type WeekIntention = { weekStart: string; text: string };

export function getWeekIntention(): WeekIntention | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as WeekIntention;
    if (!j?.weekStart || typeof j.text !== "string") return null;
    const current = mondayKey();
    if (j.weekStart !== current) return null;
    const t = j.text.trim();
    if (!t) return null;
    return { weekStart: j.weekStart, text: t };
  } catch {
    return null;
  }
}

export function setWeekIntention(text: string): void {
  const weekStart = mondayKey();
  const t = text.trim();
  try {
    if (!t) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ weekStart, text: t.slice(0, 200) }));
  } catch {
    /* ignore */
  }
}
