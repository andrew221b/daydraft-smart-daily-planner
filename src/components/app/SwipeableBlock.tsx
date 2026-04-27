import { ReactNode, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { haptics } from "@/lib/haptics";

/**
 * iOS-style swipeable row.
 * - Swipe RIGHT (→) reveals/triggers Complete
 * - Swipe LEFT (←) reveals/triggers Delete
 * - Threshold-based commit (no peek-and-hold UI to keep it simple)
 *
 * Disabled when `disabled` is true (e.g. while drag-reordering).
 */
export const SwipeableBlock = ({
  children,
  onComplete,
  onDelete,
  disabled = false,
  showComplete = true,
  showDelete = true,
}: {
  children: ReactNode;
  onComplete?: () => void;
  onDelete?: () => void;
  disabled?: boolean;
  showComplete?: boolean;
  showDelete?: boolean;
}) => {
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const locked = useRef<"x" | "y" | null>(null);
  const triggered = useRef<"left" | "right" | null>(null);

  const THRESHOLD = 80;
  const MAX = 110;

  const reset = () => {
    setDx(0);
    startX.current = null;
    startY.current = null;
    locked.current = null;
    triggered.current = null;
  };

  const onStart = (x: number, y: number) => {
    if (disabled) return;
    startX.current = x;
    startY.current = y;
    locked.current = null;
    triggered.current = null;
  };

  const onMove = (x: number, y: number) => {
    if (disabled || startX.current == null || startY.current == null) return;
    const deltaX = x - startX.current;
    const deltaY = y - startY.current;
    if (locked.current == null) {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return;
      locked.current = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
    }
    if (locked.current !== "x") return;
    let next = deltaX;
    if (!showComplete && next > 0) next = 0;
    if (!showDelete && next < 0) next = 0;
    next = Math.max(-MAX, Math.min(MAX, next));
    setDx(next);
    // Edge haptic when crossing threshold
    if (Math.abs(next) >= THRESHOLD && triggered.current == null) {
      triggered.current = next > 0 ? "right" : "left";
      haptics.tap();
    } else if (Math.abs(next) < THRESHOLD && triggered.current != null) {
      triggered.current = null;
    }
  };

  const onEnd = () => {
    if (disabled) return;
    const committed = triggered.current;
    if (committed === "right" && onComplete) {
      haptics.notify("success");
      onComplete();
    } else if (committed === "left" && onDelete) {
      haptics.impact("medium");
      onDelete();
    }
    reset();
  };

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Action backgrounds */}
      <div className="absolute inset-0 flex items-center justify-between px-5 pointer-events-none">
        <div
          className={`flex items-center gap-1.5 text-success-foreground text-xs font-semibold transition-opacity ${
            dx > 20 && showComplete ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className={`h-9 w-9 rounded-full bg-success flex items-center justify-center ${dx >= THRESHOLD ? "scale-110" : ""} transition-transform`}>
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
          <span className="text-success">{dx >= THRESHOLD ? "Release" : "Complete"}</span>
        </div>
        <div
          className={`flex items-center gap-1.5 text-destructive text-xs font-semibold ml-auto transition-opacity ${
            dx < -20 && showDelete ? "opacity-100" : "opacity-0"
          }`}
        >
          <span>{Math.abs(dx) >= THRESHOLD ? "Release" : "Delete"}</span>
          <span className={`h-9 w-9 rounded-full bg-destructive flex items-center justify-center ${Math.abs(dx) >= THRESHOLD ? "scale-110" : ""} transition-transform`}>
            <Trash2 className="h-4 w-4 text-destructive-foreground" />
          </span>
        </div>
      </div>

      {/* Foreground content */}
      <div
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? "transform 200ms ease" : undefined, touchAction: locked.current === "x" ? "none" : "pan-y" }}
        onTouchStart={(e) => onStart(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={(e) => onMove(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={onEnd}
        onTouchCancel={reset}
      >
        {children}
      </div>
    </div>
  );
};
