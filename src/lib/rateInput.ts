/**
 * Strict parsing for the hourly-rate input shared by the Home tracker hero and
 * the Tracker page. Distinguishes three outcomes so the UI can tell "I cleared
 * it" apart from "I typed garbage":
 *
 *   - "cleared": the field is empty  → store null (a legitimate "no rate").
 *   - "valid":   a well-formed amount → the rounded number to save.
 *   - "invalid": letters, symbols, or malformed numbers like a leading-zero
 *                integer ("0123") → the caller should surface a format error
 *                and NOT save anything.
 *
 * A comma is accepted as the decimal separator. A bare "0" and decimals like
 * "0.5" are valid; leading-zero integers ("0123", "01") are rejected because
 * `Number()` would silently coerce them and hide the typo.
 */
export type RateParseResult =
  | { kind: "cleared" }
  | { kind: "valid"; value: number }
  | { kind: "invalid" };

// Non-negative decimal: a bare 0, or a non-zero integer with no leading zero,
// optionally followed by a fractional part.
const RATE_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

export function parseHourlyRate(raw: string): RateParseResult {
  const cleaned = raw.replace(",", ".").trim();
  if (cleaned === "") return { kind: "cleared" };
  if (!RATE_PATTERN.test(cleaned)) return { kind: "invalid" };
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return { kind: "invalid" };
  return { kind: "valid", value: Math.round(n * 100) / 100 };
}
