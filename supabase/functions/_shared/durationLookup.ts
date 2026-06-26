/**
 * Local, zero-cost duration resolver — tries to answer "how long does this
 * task take" from TIME_DATASET before falling back to asking Gemini.
 *
 * Matching follows the same normalize + tiered-score pattern already proven
 * in src/pages/app/DayView.tsx (matching AI plan blocks back to user rows):
 * exact normalized match > substring containment > multi-word overlap.
 * Deliberately conservative — any ambiguity (two rows scoring the same with
 * different durations) returns null so the AI decides instead of guessing.
 */

import { TIME_DATASET, type TimeDatasetRow } from "./timeDataset.ts";

export interface LocalDurationMatch {
  min: number;
  matchedTask: string;
  category: string;
  occupation: string;
}

const normalize = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

const SIGNIFICANT_WORD_MIN_LEN = 4;

const significantWords = (s: string) =>
  s.split(" ").filter((w) => w.length >= SIGNIFICANT_WORD_MIN_LEN);

interface ScoredRow {
  row: TimeDatasetRow;
  score: number;
}

const DATASET_WITH_KEYS = TIME_DATASET.map((row) => ({
  row,
  key: normalize(row.task),
}));

function scoreAgainst(inputKey: string, inputWords: string[], rowKey: string): number {
  if (!rowKey) return 0;
  if (rowKey === inputKey) return 3;
  if (rowKey.includes(inputKey) || inputKey.includes(rowKey)) return 2;
  const rowWords = significantWords(rowKey);
  const shared = inputWords.filter((w) => rowWords.includes(w));
  if (shared.length >= 2) return 1;
  return 0;
}

/**
 * Resolve a user-typed task title to a real-world duration.
 * Returns null when there's no match, or when the best match is ambiguous
 * (multiple equally-good rows disagree on duration) — both cases mean
 * "let the AI estimate this one instead."
 */
export function resolveLocalDuration(title: string): LocalDurationMatch | null {
  const inputKey = normalize(title);
  if (!inputKey) return null;
  const inputWords = significantWords(inputKey);

  let best: ScoredRow[] = [];
  let bestScore = 0;

  for (const { row, key } of DATASET_WITH_KEYS) {
    const score = scoreAgainst(inputKey, inputWords, key);
    if (score === 0) continue;
    if (score > bestScore) {
      bestScore = score;
      best = [{ row, score }];
    } else if (score === bestScore) {
      best.push({ row, score });
    }
  }

  if (bestScore === 0 || best.length === 0) return null;

  // Ambiguous: top candidates disagree on duration enough to matter — defer to AI.
  if (best.length > 1) {
    const mins = best.map((b) => b.row.min);
    const spread = Math.max(...mins) - Math.min(...mins);
    if (spread > 10) return null;
  }

  const winner = best[0].row;
  const roundedMin = Math.max(5, Math.round(winner.min / 5) * 5);

  return {
    min: roundedMin,
    matchedTask: winner.task,
    category: winner.category,
    occupation: winner.occupation,
  };
}
