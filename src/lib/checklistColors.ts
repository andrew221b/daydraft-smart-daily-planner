/**
 * Per-category checklist colours.
 *
 * Categories read with their own identity colour so the eye can tell lists
 * apart at a glance. The palette is curated to be positive and professional —
 * and deliberately holds **no reds** (the failed-item ✗ owns red, so a red
 * category would read as "everything failed") and **no greens** (the ungrouped
 * section + the checklist page accent are emerald; a green category would blend
 * into it).
 *
 * Colours are assigned so they don't repeat within a day's categories (until the
 * palette is exhausted), and the user can override any category's colour from its
 * menu — a chosen colour is sticky and may repeat. Overrides live in
 * `localStorage` (instant, offline, no migration); auto colours are derived.
 *
 * Each entry is an `[accent, accent-2]` HSL-triplet pair (matching the app's
 * `--accent` / `--accent-2` gradient tokens). Setting these two CSS vars on a
 * category's root makes every accent-driven child inside it — the list chip, the
 * checkbox, the progress ring, the title — adopt the colour automatically,
 * exactly like `.checklist-theme` does globally.
 */
export const CHECKLIST_CATEGORY_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["248 78% 66%", "260 80% 64%"], // indigo
  ["212 90% 60%", "222 88% 60%"], // blue
  ["198 92% 56%", "205 90% 56%"], // sky
  ["188 82% 48%", "194 82% 52%"], // cyan
  ["272 80% 66%", "283 78% 64%"], // violet
  ["296 74% 64%", "306 70% 64%"], // magenta
  ["44 96% 55%", "38 95% 56%"],   // gold
  ["32 92% 56%", "26 90% 58%"],   // amber
  ["224 52% 64%", "234 50% 66%"], // slate-blue
];

export type ChecklistTint = { hsl: string; hsl2: string };

const PALETTE_LEN = CHECKLIST_CATEGORY_PALETTE.length;

/** FNV-1a hash of an id → a stable palette index in [0, PALETTE_LEN). */
function hashIndex(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % PALETTE_LEN;
}

/** The tint pair at a palette index (wraps if out of range). */
export function tintAt(index: number): ChecklistTint {
  const [hsl, hsl2] = CHECKLIST_CATEGORY_PALETTE[((index % PALETTE_LEN) + PALETTE_LEN) % PALETTE_LEN];
  return { hsl, hsl2 };
}

/** A linear-gradient CSS value for a swatch at a palette index. */
export function swatchGradient(index: number): string {
  const t = tintAt(index);
  return `linear-gradient(135deg, hsl(${t.hsl}), hsl(${t.hsl2}))`;
}

/**
 * Stable hash-derived tint for a category id — the deterministic fallback used
 * when no day-context is available (and the cross-device-stable choice for a
 * pinned category that the user hasn't recoloured). Never red, never green.
 */
export function checklistCategoryTint(id: string): ChecklistTint {
  return tintAt(hashIndex(id));
}

/** CSS-var style object that re-tints all accent-driven children to a colour. */
export function checklistTintVars(tint: ChecklistTint): Record<string, string> {
  return { "--accent": tint.hsl, "--accent-2": tint.hsl2 };
}

// ── User colour overrides (localStorage) ──────────────────────────────────────
// Map of `groupId -> palette index`. A category the user explicitly recoloured
// keeps that index everywhere and forever (may repeat with others — their call).
const OVERRIDES_KEY = "dd_checklist_colors";

export function getColorOverrides(): Record<string, number> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Set (or clear, with `index === null`) a category's colour override. */
export function setColorOverride(groupId: string, index: number | null): void {
  try {
    const map = getColorOverrides();
    if (index == null) delete map[groupId];
    else map[groupId] = ((index % PALETTE_LEN) + PALETTE_LEN) % PALETTE_LEN;
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map));
  } catch {
    /* quota / unavailable — best effort */
  }
}

/**
 * Resolve a palette index for every category, non-repeating within the set.
 *
 * Priority per category:
 *   1. an explicit user override (sticky, may repeat),
 *   2. for a PINNED category, its stable hash colour (so a list that recurs on
 *      every day keeps ONE colour instead of flickering as the day's other
 *      categories change),
 *   3. otherwise the least-used palette colour so far (tie-broken by a hash of
 *      the id for spread) — i.e. the first N categories get N distinct colours.
 *
 * Pass the day's categories in a STABLE order (e.g. by `created_at`) so adding a
 * category appends a fresh colour without disturbing the others.
 */
export function resolveChecklistTints(
  groups: ReadonlyArray<{ id: string; pinned?: boolean | null }>,
): Map<string, number> {
  const overrides = getColorOverrides();
  const usage = new Array(PALETTE_LEN).fill(0);
  const out = new Map<string, number>();

  // Pass 1 — fixed assignments (overrides + pinned hash) seed the usage counts.
  const deferred: { id: string }[] = [];
  for (const g of groups) {
    if (g.id in overrides) {
      const idx = ((overrides[g.id] % PALETTE_LEN) + PALETTE_LEN) % PALETTE_LEN;
      out.set(g.id, idx);
      usage[idx]++;
    } else if (g.pinned) {
      const idx = hashIndex(g.id);
      out.set(g.id, idx);
      usage[idx]++;
    } else {
      deferred.push({ id: g.id });
    }
  }

  // Pass 2 — greedily give each remaining category the least-used colour, so
  // they don't repeat until every colour is in play.
  for (const { id } of deferred) {
    let min = Infinity;
    for (const u of usage) if (u < min) min = u;
    const candidates: number[] = [];
    for (let i = 0; i < PALETTE_LEN; i++) if (usage[i] === min) candidates.push(i);
    const idx = candidates[hashIndex(id) % candidates.length];
    out.set(id, idx);
    usage[idx]++;
  }

  return out;
}
