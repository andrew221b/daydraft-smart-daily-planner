/**
 * Per-category checklist colours.
 *
 * The DB has no colour column, so each category's identity colour is derived
 * deterministically from its id (a curated, on-brand palette). Same id → same
 * colour on every device and reload, with no migration. Categories read with
 * their own colour; ungrouped items keep the checklist page's own accent
 * (the emerald `--checklist-accent`).
 *
 * Each entry is an `[accent, accent-2]` HSL-triplet pair (matching the app's
 * `--accent` / `--accent-2` gradient tokens). Setting these two CSS vars on a
 * category's root makes every accent-driven child inside it — the list chip,
 * the checkbox, the progress ring, the title — adopt the colour automatically,
 * exactly like `.checklist-theme` does globally. Greens are intentionally
 * absent so a category never blends into the ungrouped (emerald) section.
 */
const CHECKLIST_CATEGORY_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["248 78% 66%", "266 82% 62%"], // violet
  ["210 92% 60%", "224 90% 58%"], // blue
  ["28 92% 56%", "14 90% 58%"],   // amber → orange
  ["338 84% 64%", "318 82% 62%"], // rose → pink
  ["190 86% 50%", "202 90% 52%"], // cyan → sky
  ["46 96% 54%", "36 95% 55%"],   // gold → amber
  ["282 82% 66%", "300 84% 64%"], // purple → magenta
  ["10 88% 63%", "352 84% 64%"],  // coral → red
];

export type ChecklistTint = { hsl: string; hsl2: string };

/** Stable accent pair for a category id (FNV-1a hash → palette index). */
export function checklistCategoryTint(id: string): ChecklistTint {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const [hsl, hsl2] = CHECKLIST_CATEGORY_PALETTE[(h >>> 0) % CHECKLIST_CATEGORY_PALETTE.length];
  return { hsl, hsl2 };
}

/** CSS-var style object that re-tints all accent-driven children to the category colour. */
export function checklistTintVars(tint: ChecklistTint): Record<string, string> {
  return { "--accent": tint.hsl, "--accent-2": tint.hsl2 };
}
