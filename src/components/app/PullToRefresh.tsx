import { ReactNode, useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { haptics } from "@/lib/haptics";

/**
 * Native-feeling pull-to-refresh wrapper.
 * Activates only when scrolled to the top of the viewport.
 */
export const PullToRefresh = ({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
}) => {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const triggered = useRef(false);

  const THRESHOLD = 70;
  const MAX = 110;

  const onStart = (y: number) => {
    if (window.scrollY > 0) return;
    startY.current = y;
    triggered.current = false;
  };
  const onMove = (y: number) => {
    if (startY.current == null || refreshing) return;
    const dy = y - startY.current;
    if (dy <= 0) { setPull(0); return; }
    const damped = Math.min(MAX, dy * 0.5);
    setPull(damped);
    if (damped >= THRESHOLD && !triggered.current) {
      triggered.current = true;
      haptics.tap();
    } else if (damped < THRESHOLD) {
      triggered.current = false;
    }
  };
  const onEnd = async () => {
    const wasTriggered = triggered.current;
    startY.current = null;
    triggered.current = false;
    if (wasTriggered && !refreshing) {
      setRefreshing(true);
      setPull(50);
      try { await onRefresh(); } catch { /* noop */ }
      setRefreshing(false);
    }
    setPull(0);
  };

  return (
    <div
      onTouchStart={(e) => onStart(e.touches[0].clientY)}
      onTouchMove={(e) => onMove(e.touches[0].clientY)}
      onTouchEnd={onEnd}
      onTouchCancel={onEnd}
    >
      <div
        className="flex items-center justify-center text-secondary-fg overflow-hidden transition-[height] duration-150"
        style={{ height: pull }}
      >
        {refreshing ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : pull > 10 ? (
          <ArrowDown
            className="h-4 w-4 text-primary transition-transform"
            style={{ transform: `rotate(${Math.min(180, (pull / THRESHOLD) * 180)}deg)` }}
          />
        ) : null}
      </div>
      {children}
    </div>
  );
};