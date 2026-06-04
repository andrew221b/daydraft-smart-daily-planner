type AiFlagName = "aiRescueV2" | "aiFocusRuntime" | "aiWeeklyMemory";

const KEY = "dd_ai_flags";
const EVENTS_KEY = "dd_ai_events";

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function rolloutPctFor(flag: AiFlagName): number {
  const envValue = import.meta.env[`VITE_AI_${flag.toUpperCase()}_ROLLOUT` as keyof ImportMetaEnv] as string | undefined;
  const parsed = Number(envValue);
  if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed));
  return 20;
}

export function isAiFlagEnabled(flag: AiFlagName, userId?: string | null): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const obj = JSON.parse(saved) as Partial<Record<AiFlagName, boolean>>;
      if (typeof obj[flag] === "boolean") return !!obj[flag];
    }
  } catch {
    // ignore storage
  }
  if (!userId) return false;
  const bucket = hashString(`${userId}:${flag}`) % 100;
  return bucket < rolloutPctFor(flag);
}

export function setAiFlagOverride(flag: AiFlagName, enabled: boolean): void {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? (JSON.parse(raw) as Partial<Record<AiFlagName, boolean>>) : {};
    obj[flag] = enabled;
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

export function trackAiEvent(name: string, payload?: Record<string, unknown>): void {
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    const events = raw ? (JSON.parse(raw) as Array<{ name: string; payload: unknown; ts: string }>) : [];
    events.push({ name, payload: payload || {}, ts: new Date().toISOString() });
    if (events.length > 200) events.splice(0, events.length - 200);
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  } catch {
    // ignore
  }
  console.info("[ai-event]", name, payload || {});
}

export type AiWeeklyMemory = {
  generated_at: string;
  best_focus_hours: string;
  realistic_block_min: number;
  common_slip: string;
  recommendation: string;
};

const MEMORY_KEY = "dd_ai_weekly_memory";

export function readAiWeeklyMemory(): AiWeeklyMemory | null {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AiWeeklyMemory;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeAiWeeklyMemory(memory: AiWeeklyMemory): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // ignore
  }
}
