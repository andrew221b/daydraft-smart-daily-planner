import { useEffect, useRef, useState } from "react";

/**
 * Renders a numeric / time string and replays a brief vertical-tick
 * animation on each character that changes between renders. Cheap
 * (CSS-only, no virtual DOM tricks beyond a per-character key), and on
 * `tabular-nums` containers the column widths stay stable so the result
 * reads like a real odometer rolling.
 *
 * Use for timer displays ("00:09 → 00:10"), totals ("1h 14m → 1h 15m"),
 * counters ("3/12 done") — anything that updates while the user watches.
 *
 *   <span className="font-mono-sf tabular-nums text-[46px]">
 *     <TickingNumber value={fmtHMS(elapsedSec)} />
 *   </span>
 *
 * Characters that don't change between renders don't replay, so a
 * ticking seconds counter only animates the rightmost digits.
 */
export function TickingNumber({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  // Defensive: callers should pass a string, but a passing through of
  // `null` / `undefined` (e.g. from a formatter returning `?? ""`) used
  // to crash on `.split` here. Coerce so the component never throws.
  const safe = value == null ? "" : String(value);
  // Per-character generation counters. Bumping a counter keys the span,
  // which forces React to remount it — re-running the CSS animation.
  const [gens, setGens] = useState<number[]>(() => safe.split("").map(() => 0));
  const prevRef = useRef(safe);

  useEffect(() => {
    const prev = prevRef.current;
    if (safe === prev) return;
    const next = safe.split("");
    const prevArr = prev.split("");
    setGens((old) =>
      next.map((ch, i) => {
        const same = prevArr[i] === ch;
        // If the string grew, brand-new positions animate too. If it
        // shrank, the trailing positions just get dropped (React reconciles).
        if (i >= old.length) return 1;
        return same ? old[i] : old[i] + 1;
      }),
    );
    prevRef.current = safe;
  }, [safe]);

  return (
    <span className={className} aria-label={safe} role="text">
      {safe.split("").map((ch, i) => (
        // Wrap in a positioned span so the per-character animation doesn't
        // shift the baseline. Non-numeric separators (":", " ", "h", "m")
        // animate too — that's deliberate when, say, "59m" rolls to "1h".
        <span
          key={`${i}-${gens[i] ?? 0}`}
          className="tick-digit"
          style={{ display: "inline-block", minWidth: ch === " " ? "0.4em" : undefined }}
          aria-hidden
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
