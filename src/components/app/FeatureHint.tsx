import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useHints } from "@/hooks/useHints";
import { haptics } from "@/lib/haptics";

type Placement = "top" | "bottom" | "auto";

const MARGIN = 12; // viewport edge keep-out
const GAP = 12; // distance between anchor and card
const CARD_MAX = 320;
const ARROW = 9; // half-size of the little diamond
const RING_PAD = 6; // how far the spotlight ring sits outside the anchor
const TABBAR_KEEPOUT = 92; // bottom tab bar + home indicator — never place the card under it
const TOPBAR_KEEPOUT = 52; // status / header zone at the top

// The hint's own identity colour: emerald, deliberately distinct from the app's
// blue --primary, echoing the old green tutorial spotlight the user liked.
const G = "152 70% 45%";

/**
 * A one-time, anchored coachmark that points at a real on-screen element.
 *
 * Non-blocking by design: taps pass straight through (the highlighted control
 * still works), but the rest of the screen dims into a spotlight so the eye goes
 * to the right place. The card is the only interactive surface.
 *
 * Robustness: the anchor rect is tracked every frame while the hint is live, so
 * the spotlight stays glued through page-enter animations, scrolling and layout
 * shifts — and the whole thing tears down the instant the anchor disappears
 * (route change, mode switch), so nothing ever lingers on the wrong screen.
 */
export function FeatureHint({
  id,
  selector,
  anchorRef,
  active = true,
  title,
  children,
  placement = "auto",
  badge,
  delayMs = 220,
  autoScroll = true,
}: {
  id: string;
  selector?: string;
  anchorRef?: RefObject<HTMLElement>;
  active?: boolean;
  title?: string;
  children: ReactNode;
  placement?: Placement;
  /** Optional eyebrow tag, e.g. "New". Defaults to "Tip". */
  badge?: string;
  delayMs?: number;
  /** When false, the hint never scrolls the page to its anchor — it stays hidden
   *  until the user scrolls the anchor into view on their own, then appears.
   *  Use for hints on a long page where yanking the viewport is jarring. */
  autoScroll?: boolean;
}) {
  const { enabled, isSeen, markSeen, setEnabled, register, unregister, isActive } = useHints();

  // "Explicitly dismissed" (Got it / X / Turn off) is tracked locally and is
  // what actually hides the card. It's deliberately separate from "seen": we
  // persist seen the moment the hint is displayed (so it never returns on the
  // next launch), while `persistedRef` latches eligibility so persisting doesn't
  // yank the card out from under someone still reading it.
  const [dismissed, setDismissed] = useState(false);
  const persistedRef = useRef(false);

  const eligible = enabled && active && !dismissed && (!isSeen(id) || persistedRef.current);

  // Settle delay — let the screen finish entering before a tip pops, so we don't
  // measure mid-transition. Kept short; the rAF loop below corrects any drift.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!eligible) { setReady(false); return; }
    const t = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(t);
  }, [eligible, delayMs]);

  // Track the anchor every frame. Cheap (one getBoundingClientRect, and only
  // ever for the handful of eligible hints), and it keeps the spotlight exactly
  // on the element through animations/scroll — and drops it to null the moment
  // the anchor is gone, which is what makes teardown instant on navigation.
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Scroll the anchor into a comfortable spot exactly once per showing. Reset
  // whenever this hint (re)becomes eligible so a re-armed tip scrolls again.
  const scrolledRef = useRef(false);
  useEffect(() => { scrolledRef.current = false; }, [id, eligible, ready]);
  useEffect(() => {
    if (!eligible || !ready) { setRect(null); return; }
    let raf = 0;
    let alive = true;
    const getEl = (): HTMLElement | null =>
      anchorRef?.current ?? (selector ? (document.querySelector(selector) as HTMLElement | null) : null);
    const tick = () => {
      if (!alive) return;
      const el = getEl();
      const uTop = TOPBAR_KEEPOUT + MARGIN;
      const uBottom = window.innerHeight - TABBAR_KEEPOUT - MARGIN;
      if (el) {
        const r0 = el.getBoundingClientRect();
        const outOfBand = r0.height > 0 && (r0.top < uTop + 8 || r0.bottom > uBottom - 8);
        if (autoScroll) {
          // "Hints at the bottom don't scroll me there": once, if the anchor sits
          // outside the usable band, bring it toward centre. Instant scroll keeps
          // it snappy; we re-measure next frame so the card lands settled.
          if (!scrolledRef.current && outOfBand) {
            scrolledRef.current = true;
            try { el.scrollIntoView({ block: "center", behavior: "auto" }); } catch { /* old webview */ }
            raf = requestAnimationFrame(tick);
            return;
          }
        } else if (outOfBand) {
          // Never yank the viewport — stay hidden until the user scrolls the
          // anchor into view themselves, then reveal on the next in-band frame.
          setRect((prev) => (prev === null ? prev : null));
          raf = requestAnimationFrame(tick);
          return;
        }
      }
      const r = el ? el.getBoundingClientRect() : null;
      setRect((prev) => {
        if (!r || (r.width === 0 && r.height === 0)) return prev === null ? prev : null;
        if (prev &&
          Math.abs(prev.top - r.top) < 0.5 && Math.abs(prev.left - r.left) < 0.5 &&
          Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5) {
          return prev;
        }
        return r;
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [eligible, ready, selector, anchorRef, autoScroll]);

  // Claim the single on-screen slot only once we can actually paint; release it
  // the moment we can't (and on unmount).
  const canShow = eligible && ready && !!rect;
  useEffect(() => {
    if (canShow) register(id);
    else unregister(id);
    return () => unregister(id);
  }, [canShow, id, register, unregister]);

  const shown = canShow && isActive(id);

  useEffect(() => { if (shown) haptics.selection?.(); }, [shown]);

  // The fix for "tips replay on every launch": persist `seen` as soon as the
  // hint has actually been on screen for a short dwell (the dwell guards against
  // a transient one-frame flash during a page transition burning the tip). The
  // card stays visible — `persistedRef` keeps it eligible despite seen=true — so
  // this only changes the next-launch behaviour, not the current reading.
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => {
      persistedRef.current = true;
      markSeen(id);
    }, 800);
    return () => window.clearTimeout(t);
  }, [shown, id, markSeen]);

  // Measured card height — used to clamp the card into the usable band so it
  // never spills behind the tab bar / top bar. useLayoutEffect corrects the
  // estimate before paint, so there's no visible jump.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(150);
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  });

  if (!shown || !rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const usableTop = TOPBAR_KEEPOUT + MARGIN;
  const usableBottom = vh - TABBAR_KEEPOUT - MARGIN;

  const spaceBelow = usableBottom - rect.bottom;
  const spaceAbove = rect.top - usableTop;
  const place: "top" | "bottom" =
    placement === "top" ? "top"
    : placement === "bottom" ? "bottom"
    : (spaceBelow >= spaceAbove ? "bottom" : "top");

  const cardW = Math.min(CARD_MAX, vw - MARGIN * 2);
  const anchorCx = rect.left + rect.width / 2;
  let left = anchorCx - cardW / 2;
  left = Math.max(MARGIN, Math.min(left, vw - cardW - MARGIN));

  // Place against the chosen side, then clamp into the usable band. Because the
  // anchor was scrolled toward centre there's room either way; the clamp is the
  // safety net for short/edge layouts.
  let top = place === "bottom" ? rect.bottom + GAP : rect.top - GAP - cardH;
  top = Math.max(usableTop, Math.min(top, usableBottom - cardH));

  const arrowX = Math.max(18, Math.min(anchorCx - left, cardW - 18));

  const dismiss = (turnOff: boolean) => {
    haptics.selection?.();
    persistedRef.current = true;
    setDismissed(true);
    markSeen(id);
    unregister(id);
    if (turnOff) setEnabled(false);
  };

  return createPortal(
    // No exit animation anywhere: when `shown` flips false (dismiss / navigate /
    // mode switch) this returns null and the whole overlay is gone that frame.
    <div className="fixed inset-0 z-[70]" style={{ pointerEvents: "none" }} aria-live="polite">
      {/* Spotlight: a dim scrim everywhere EXCEPT a glowing green hole around the
          anchor (the 9999px box-shadow trick). pointer-events:none, so the real
          control underneath stays tappable and the app is never blocked. */}
      <motion.div
        className="absolute"
        style={{
          top: rect.top - RING_PAD,
          left: rect.left - RING_PAD,
          width: rect.width + RING_PAD * 2,
          height: rect.height + RING_PAD * 2,
          borderRadius: 16,
          boxShadow: `0 0 0 2px hsl(${G} / 0.95), 0 0 0 5px hsl(${G} / 0.28), 0 0 22px 3px hsl(${G} / 0.5), 0 0 0 9999px hsl(222 32% 4% / 0.55)`,
          pointerEvents: "none",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      />
      {/* Attention pulse */}
      <motion.div
        className="absolute"
        style={{
          top: rect.top - RING_PAD,
          left: rect.left - RING_PAD,
          width: rect.width + RING_PAD * 2,
          height: rect.height + RING_PAD * 2,
          borderRadius: 16,
          boxShadow: `0 0 0 2px hsl(${G} / 0.6)`,
          pointerEvents: "none",
        }}
        animate={{ scale: [1, 1.07, 1], opacity: [0.7, 0, 0.7] }}
        transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        ref={cardRef}
        role="dialog"
        initial={{ opacity: 0, scale: 0.94, y: place === "bottom" ? -6 : 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 440, damping: 30 }}
        className="absolute bg-popover text-popover-foreground border border-border/70 rounded-2xl shadow-2xl"
        style={{
          left,
          top,
          width: cardW,
          pointerEvents: "auto",
        }}
      >
        {/* Arrow */}
        <div
          className="absolute bg-popover border-border/70"
          style={{
            left: arrowX - ARROW,
            width: ARROW * 2,
            height: ARROW * 2,
            transform: "rotate(45deg)",
            ...(place === "bottom"
              ? { top: -ARROW, borderLeft: "1px solid", borderTop: "1px solid", borderColor: "hsl(var(--border) / 0.7)" }
              : { bottom: -ARROW, borderRight: "1px solid", borderBottom: "1px solid", borderColor: "hsl(var(--border) / 0.7)" }),
          }}
        />

        <div className="relative px-4 pt-3 pb-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span
              className="text-[10.5px] font-bold uppercase tracking-[0.14em] inline-flex items-center gap-1.5"
              style={{ color: `hsl(${G})` }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${G})`, boxShadow: `0 0 6px hsl(${G})` }} />
              {badge || "Tip"}
            </span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(false)}
              className="-mr-1 -mt-0.5 p-1 rounded-full text-secondary-fg/70 hover:text-foreground pressable"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.4} />
            </button>
          </div>

          {title && <p className="text-[14px] font-semibold leading-snug mb-1">{title}</p>}
          <div className="text-[12.5px] leading-relaxed text-secondary-fg/90">{children}</div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => dismiss(true)}
              className="text-[12px] font-medium text-secondary-fg/65 hover:text-secondary-fg pressable"
            >
              Turn off tips
            </button>
            <button
              type="button"
              onClick={() => dismiss(false)}
              className="rounded-full text-white text-[12.5px] font-semibold px-4 py-1.5 pressable"
              style={{ background: `hsl(${G})`, boxShadow: `0 4px 14px hsl(${G} / 0.45)` }}
            >
              Got it
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
