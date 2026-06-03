import { type ReactNode, type RefObject, useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { haptics } from "@/lib/haptics";

/**
 * Find the nearest scrolling ancestor of `el`. Walks up the DOM looking
 * for an element whose computed `overflow-y` is `auto` or `scroll` — the
 * one that actually moves when the user drags.
 *
 * Needed because the Shell now scrolls inside `<main>` instead of the
 * body, and `window.scrollY` always reports 0 there.
 */
const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
  let n: HTMLElement | null = el?.parentElement ?? null;
  while (n) {
    const style = window.getComputedStyle(n);
    if (/(auto|scroll)/.test(style.overflowY)) return n;
    n = n.parentElement;
  }
  return null;
};

const scrollTop = (
  scrollContainerRef?: RefObject<HTMLElement | null>,
  autoFound?: HTMLElement | null,
) => {
  if (scrollContainerRef?.current) return scrollContainerRef.current.scrollTop;
  if (autoFound) return autoFound.scrollTop;
  return typeof window !== "undefined" ? window.scrollY : 0;
};

/**
 * Native-feeling pull-to-refresh wrapper.
 * Activates only when scrolled to the top of the window or the optional scroll container.
 */
export const PullToRefresh = ({
  onRefresh,
  children,
  scrollContainerRef,
}: {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
  /** When the page uses an inner scroll root (e.g. DayView), pass it so pull checks scrollTop correctly. */
  scrollContainerRef?: RefObject<HTMLElement | null>;
}) => {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const triggered = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const autoScrollParentRef = useRef<HTMLElement | null>(null);

  const THRESHOLD = 70;
  const MAX = 110;

  const onStart = (y: number, e: React.TouchEvent | React.PointerEvent) => {
    // Ignore touches that originated in React portals (like modals/sheets)
    if (e.target instanceof Node && rootRef.current && !rootRef.current.contains(e.target)) return;

    // Lazily resolve the actual scroll parent on first interaction so the
    // ref is populated by the time we read it. The DOM might not be fully
    // mounted at component-init time on slow first paints.
    if (!scrollContainerRef?.current && !autoScrollParentRef.current) {
      autoScrollParentRef.current = findScrollParent(rootRef.current);
    }
    if (scrollTop(scrollContainerRef, autoScrollParentRef.current) > 0) return;
    startY.current = y;
    triggered.current = false;
  };
  const onMove = (y: number) => {
    if (startY.current == null || refreshing) return;
    if (document.body.classList.contains("dd-dnd-scroll-lock")) {
      setPull(0);
      return;
    }
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
      // Success haptic on completion — pairs with the spring snap-back
      // so the refresh feels tactile end-to-end.
      haptics.notify("success");
    }
    setPull(0);
  };

  // While the finger is moving, height tracks 1:1 (no transition would
  // make it feel rubbery in the wrong way). On release / completion the
  // spring curve gives the iOS-style elastic snap-back.
  const isReleasing = startY.current === null;

  return (
    <div
      ref={rootRef}
      className="w-full"
      onTouchStart={(e) => onStart(e.touches[0].clientY, e)}
      onTouchMove={(e) => onMove(e.touches[0].clientY)}
      onTouchEnd={onEnd}
      onTouchCancel={onEnd}
    >
      <div
        className="flex items-center justify-center text-secondary-fg overflow-hidden"
        style={{
          height: pull,
          transition: isReleasing
            ? "height 320ms cubic-bezier(0.34, 1.2, 0.64, 1)"
            : "none",
        }}
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