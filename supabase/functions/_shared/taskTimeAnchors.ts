/** mirror src/lib/taskTimeAnchors.ts for edge functions */

const pad = (n: number) => String(Math.max(0, Math.min(23, Math.floor(n)))).padStart(2, "0");

function composeHHMM(hRaw: number, mRaw?: number | null, meridiem?: string | null): string | undefined {
  if (!Number.isFinite(hRaw) || hRaw < 0 || hRaw > 23) return undefined;
  let h = Math.floor(hRaw);
  let m = Number.isFinite(mRaw as number) ? Math.floor(mRaw as number) : 0;
  const ap = meridiem?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (m < 0 || m > 59) m = 0;
  return `${pad(h)}:${String(m).padStart(2, "0")}`;
}

export function extractTaskTimeAnchors(line: string): {
  cleanedTitle: string;
  fixedStart?: string;
  deadlineNote?: string;
} {
  let s = line.trim();
  let fixedStart: string | undefined;
  let deadlineNote: string | undefined;

  const deadlineRe =
    /(?:\bдо\s+|by\s+|until\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi;
  const dm = deadlineRe.exec(s);
  if (dm) {
    const hhmm = composeHHMM(parseInt(dm[1], 10), dm[2] ? parseInt(dm[2], 10) : 0, dm[3] || null);
    if (hhmm) deadlineNote = `Finish-by ${hhmm} (user wording)`;
    s = (s.slice(0, dm.index) + s.slice(dm.index + dm[0].length)).replace(/\s+/g, " ").trim();
    deadlineRe.lastIndex = 0;
  }

  const h24 = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (h24 && !fixedStart) {
    fixedStart = `${pad(parseInt(h24[1], 10))}:${h24[2]}`;
    s = s.replace(h24[0], " ").replace(/\s+/g, " ").trim();
  }

  const atRe =
    /\b(?:в|В|at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;
  const am = atRe.exec(s);
  if (am && !fixedStart) {
    const mer = am[3]?.replace(/\./g, "").toLowerCase();
    const ap = mer === "a.m" ? "am" : mer === "p.m" ? "pm" : mer || undefined;
    const hhmm = composeHHMM(parseInt(am[1], 10), am[2] ? parseInt(am[2], 10) : 0, ap || null);
    if (hhmm) {
      fixedStart = hhmm;
      s = (s.slice(0, am.index) + s.slice(am.index + am[0].length)).replace(/\s+/g, " ").trim();
    }
  }

  const lone = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(s);
  if (lone && !fixedStart) {
    const hhmm = composeHHMM(parseInt(lone[1], 10), lone[2] ? parseInt(lone[2], 10) : 0, lone[3] || null);
    if (hhmm) {
      fixedStart = hhmm;
      s = (s.slice(0, lone.index) + s.slice(lone.index + lone[0].length)).replace(/\s+/g, " ").trim();
    }
  }

  return {
    cleanedTitle: s.replace(/^[-•*]+\s*/, "").replace(/\s+/g, " ").trim(),
    ...(fixedStart ? { fixedStart } : {}),
    ...(deadlineNote ? { deadlineNote } : {}),
  };
}
