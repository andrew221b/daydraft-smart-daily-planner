import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { haptics } from "@/lib/haptics";

/**
 * Swipe-down-to-dismiss for Radix bottom sheets.
 *
 * Radix Dialog has no built-in drag gesture — the affordance is the small
 * pill at the top of the sheet, but historically tapping it did nothing.
 * This hook fills that gap.
 *
 * Usage:
 *
 *   const { handleProps, sheetStyle } = useSheetSwipeDown(() => onOpenChange(false));
 *   <SheetContent style={{ ...sheetStyle, ...mySheetStyle }}>
 *     <div className="…drag handle row…" {...handleProps}>
 *       <div className="h-1 w-9 rounded-full bg-foreground/15" />
 *     </div>
 *     …
 *   </SheetContent>
 *
 * Mechanics:
 *  - `onPointerDown` on the handle row captures pointer events, snapshots
 *    the start position, and flips `active` so we know to bypass any
 *    transform transition while the finger is down.
 *  - `onPointerMove` translates the sheet 1:1 with downward drag. Upward
 *    drag is rubber-banded (÷6) so the user gets feedback but never lifts
 *    the sheet above its anchored position.
 *  - On release we dismiss when EITHER the drag travelled >130px OR the
 *    finger lifted with a velocity > 0.6 px/ms (the iOS Sheets threshold).
 *  - Otherwise we spring back to 0 with a 220ms cubic-bezier transition.
 *
 * `sheetStyle` is `null` until the user touches the handle, so the sheet's
 * own slide-in animation is never disturbed. After release the inline
 * style stays applied just long enough to play the snap-back, then it
 * resets to `null` on the next render with `y === 0 && !active`.
 */
export type SheetSwipeDown = {
  handleProps: {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLDivElement>) => void;
    style: CSSProperties;
  };
  sheetStyle: CSSProperties | null;
};

const DISMISS_PX = 130;
const DISMISS_VELOCITY = 0.6; // px/ms — matches the iOS bottom-sheet threshold

export function useSheetSwipeDown(onClose: () => void): SheetSwipeDown {
  const [y, setY] = useState(0);
  const [active, setActive] = useState(false);

  const startY = useRef<number | null>(null);
  const lastY = useRef<number | null>(null);
  const lastT = useRef<number | null>(null);
  const velocity = useRef(0);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startY.current = e.clientY;
    lastY.current = e.clientY;
    lastT.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    velocity.current = 0;
    setActive(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    const dy = e.clientY - startY.current;
    // Rubber-band on upward drag — let the user feel resistance but never
    // lift the sheet above its anchor.
    const value = dy < 0 ? dy / 6 : dy;
    setY(value);

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (lastY.current !== null && lastT.current !== null) {
      const dt = now - lastT.current;
      if (dt > 0) velocity.current = (e.clientY - lastY.current) / dt;
    }
    lastY.current = e.clientY;
    lastT.current = now;
  }, []);

  const finishDrag = useCallback(() => {
    if (startY.current === null) return;
    const dragged = y;
    const v = velocity.current;
    startY.current = null;
    lastY.current = null;
    lastT.current = null;
    setActive(false);
    if (dragged > DISMISS_PX || v > DISMISS_VELOCITY) {
      haptics.tap();
      // Reset the inline transform before invoking onClose so Radix's
      // own close animation isn't fighting an applied translate.
      setY(0);
      onClose();
    } else {
      setY(0);
    }
    velocity.current = 0;
  }, [y, onClose]);

  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    style: { touchAction: "none" as const, cursor: "grab" },
  };

  const sheetStyle: CSSProperties | null =
    active || y !== 0
      ? {
          transform: `translate3d(0, ${y}px, 0)`,
          transition: active ? "none" : "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)",
        }
      : null;

  return { handleProps, sheetStyle };
}
