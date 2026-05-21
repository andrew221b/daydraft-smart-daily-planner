import { memo, useEffect, useRef } from "react";
import { subscribeElapsed, getElapsedSec } from "@/hooks/useTimeTracker";

/**
 * Live timer display. Subscribes to the timer worker tick and writes the
 * formatted seconds directly into `textContent` — no React state, no
 * re-render every second. The component itself only renders when the
 * surrounding tree re-renders for other reasons.
 *
 *   <LiveElapsed format={fmtHMS} className="font-mono-sf text-[46px]" />
 *
 * Falls back to formatting whatever value `getElapsedSec()` reports on mount
 * so the very first paint isn't stale.
 */
function LiveElapsedInner({
  format,
  className,
}: {
  format: (sec: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const write = (sec: number) => {
      if (!ref.current) return;
      ref.current.textContent = formatRef.current(sec);
    };
    write(getElapsedSec());
    return subscribeElapsed(write);
  }, []);

  return (
    <span ref={ref} className={className}>
      {format(getElapsedSec())}
    </span>
  );
}

export const LiveElapsed = memo(LiveElapsedInner);
