import { X, ArrowRight } from "lucide-react";
import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { haptics } from "@/lib/haptics";

type OverlayStep = {
  id: string;
  chapter?: string;
  title?: string;
  body?: string;
  placement?: "top" | "bottom" | "auto" | "center";
  advance?: "next-button" | "click-target" | "auto-delay" | "dom-mutation" | "navigate";
  buttonLabel?: string;
  silent?: boolean;
};

const PADDING = 8;
const GAP = 16;

/* The whole tour speaks one contrasting voice: a vivid lime that the rest of
   the (sapphire) UI never uses, so a highlighted control instantly reads as
   "this is the tour", not "this is a normal button". Tooltip stays a fixed
   dark glass on both themes so the lime always pops and text never washes out. */
const ACCENT = "82 84% 56%"; // lime / chartreuse
const ACCENT_INK = "#10180a"; // near-black green, for text ON the lime CTA

export default function TourOverlay({
  rect,
  step,
  index,
  total,
  onNext,
  onSkip,
  isStuck,
}: {
  /** Target rect, or null when the target couldn't be found → centre fallback. */
  rect: DOMRect | null;
  step: OverlayStep;
  index: number;
  total: number;
  onNext: (clearData?: boolean) => void;
  onSkip: (clearData?: boolean) => void;
  isStuck?: boolean;
  /** True when the provider gave up locating the target (rect is null). */
  centerFallback?: boolean;
}) {
  const isLast = index === total - 1;
  const advanceMode = step.advance || "next-button";
  // Spotlight only when we actually have a target and the step isn't a centred
  // one. No rect → centre the tooltip on a plain scrim (no hole, no ring).
  const spotlight = !!rect && step.placement !== "center";
  const isCenter = !spotlight;

  const x = rect ? Math.max(8, rect.left - PADDING) : 0;
  const y = rect ? Math.max(8, rect.top - PADDING) : 0;
  const w = rect ? rect.width + PADDING * 2 : 0;
  const h = rect ? rect.height + PADDING * 2 : 0;
  const radius = 18;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tipH, setTipH] = useState(190);
  // useLayoutEffect runs pre-paint, so the corrected height is applied before
  // the user ever sees the first frame — no visible position jump.
  useLayoutEffect(() => {
    if (tooltipRef.current) setTipH(tooltipRef.current.getBoundingClientRect().height);
  }, [step.title, step.body, step.chapter, vw, vh]);

  // Haptic pulse on each real (non-silent) step.
  useEffect(() => {
    if (step.silent) return;
    if (isLast) haptics.notify("success");
    else haptics.impact("light");
  }, [step.id, step.silent, isLast]);

  // ── Tooltip placement ────────────────────────────────────────────
  // Candidate top for each side, plus whether the tooltip CLEARS the spotlight
  // on that side without running off-screen. The previous version clamped the
  // tooltip back onto the screen even when that pushed it over the highlighted
  // (and often tappable) target — the "tooltip covers the element" bug. Now we
  // honour the requested side only when it fits, otherwise flip to the side
  // that does, and only in the impossible case (target taller than either gap)
  // fall back to the roomier side.
  const spaceBelow = vh - (y + h) - 16;
  const spaceAbove = y - 16;
  const belowTop = y + h + GAP;
  const aboveTop = y - GAP - tipH;
  const fitsBelow = belowTop + tipH <= vh - 16; // clears target AND stays on-screen
  const fitsAbove = aboveTop >= 16;

  let placeBelow: boolean;
  if (step.placement === "bottom") placeBelow = fitsBelow || !fitsAbove;
  else if (step.placement === "top") placeBelow = !fitsAbove && fitsBelow;
  else if (fitsBelow && !fitsAbove) placeBelow = true;
  else if (fitsAbove && !fitsBelow) placeBelow = false;
  else placeBelow = spaceBelow >= spaceAbove;

  const tooltipWidth = Math.min(360, vw - 28);
  let tooltipTop: number;
  let tooltipLeft: number;
  if (isCenter) {
    tooltipTop = Math.max(16, (vh - tipH) / 2);
    tooltipLeft = (vw - tooltipWidth) / 2;
  } else {
    tooltipTop = placeBelow
      ? (fitsBelow ? belowTop : Math.max(16, vh - tipH - 16))
      : (fitsAbove ? aboveTop : 16);
    const targetCenter = x + w / 2;
    tooltipLeft = Math.max(16, Math.min(vw - tooltipWidth - 16, targetCenter - tooltipWidth / 2));
  }

  // Screen-minus-hole polygon: lets taps fall through to the real control on
  // click-target steps, blocks them everywhere else.
  const clipPath = `polygon(0% 0%, 0% 100%, ${x}px 100%, ${x}px ${y}px, ${x + w}px ${y}px, ${x + w}px ${y + h}px, ${x}px ${y + h}px, ${x}px 100%, 100% 100%, 100% 0%)`;

  const askToSkip = () => (index > 0 ? setShowSkipConfirm(true) : onSkip());
  const maskTransition = { type: "tween" as const, duration: 0.24, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] };

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none" aria-live="polite">
      {/* ── Dimmed backdrop ─────────────────────────────────────────
          Center steps (and the no-target fallback) have no hole — just a
          clean scrim; otherwise we mask out the spotlight cut-out. */}
      {!spotlight ? (
        <div className="absolute inset-0 bg-[rgba(6,8,16,0.78)] tour-backdrop-in" />
      ) : (
        <svg width="100%" height="100%" className="absolute inset-0 pointer-events-none">
          <defs>
            <mask id="tour-mask">
              <rect width="100%" height="100%" fill="white" />
              <motion.rect
                initial={false}
                animate={{ x, y, width: w, height: h }}
                transition={maskTransition}
                rx={radius}
                ry={radius}
                fill="black"
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(6, 8, 16, 0.78)" mask="url(#tour-mask)" />
        </svg>
      )}

      {/* ── Lime spotlight ring around the cut-out ──────────────────── */}
      {spotlight && (
        <>
          <motion.div
            aria-hidden
            className="absolute pointer-events-none rounded-[18px]"
            initial={false}
            animate={{ top: y, left: x, width: w, height: h }}
            transition={maskTransition}
            style={{
              border: `2px solid hsl(${ACCENT})`,
              boxShadow: `0 0 0 4px hsl(${ACCENT} / 0.16), 0 0 26px 3px hsl(${ACCENT} / 0.45)`,
            }}
          />
          {/* Soft breathing halo to draw the eye to the target. */}
          <motion.div
            aria-hidden
            className="absolute pointer-events-none rounded-[20px]"
            initial={false}
            animate={{ top: y - 4, left: x - 4, width: w + 8, height: h + 8, opacity: [0.55, 0.15, 0.55] }}
            transition={{
              top: maskTransition, left: maskTransition, width: maskTransition, height: maskTransition,
              opacity: { duration: 2.2, repeat: Infinity, ease: "easeInOut" },
            }}
            style={{ boxShadow: `0 0 22px 6px hsl(${ACCENT} / 0.4)` }}
          />
        </>
      )}

      {/* ── Click-blocking layer (hole stays tappable on click-target) ── */}
      <div
        className="absolute inset-0 pointer-events-auto"
        style={{ clipPath: spotlight && advanceMode === "click-target" ? clipPath : undefined }}
        onClick={askToSkip}
      />

      {/* ── Persistent Skip button ──────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, type: "spring", stiffness: 300, damping: 30 }}
        className="absolute top-[env(safe-area-inset-top,40px)] mt-4 right-4 z-[110] pointer-events-auto"
      >
        <button
          onClick={askToSkip}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-[13px] font-medium text-white/90 hover:bg-black/70 hover:text-white pressable shadow-[0_8px_16px_rgba(0,0,0,0.4)] transition-colors"
        >
          <X className="h-4 w-4" /> Skip
        </button>
      </motion.div>

      {/* ── Coach-mark tooltip ──────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {!step.silent && (
          <motion.div
            key={step.id}
            ref={tooltipRef}
            initial={{ opacity: 0, scale: 0.95, y: isCenter ? 8 : placeBelow ? -10 : 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
            transition={{ type: "spring", stiffness: 320, damping: 28, mass: 0.9 }}
            className="absolute pointer-events-auto rounded-[26px] p-5 overflow-hidden"
            style={{
              width: tooltipWidth,
              top: tooltipTop,
              left: tooltipLeft,
              background: "linear-gradient(165deg, rgba(24,27,38,0.96) 0%, rgba(15,17,26,0.97) 100%)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: `0 24px 60px -16px rgba(0,0,0,0.78), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px hsl(${ACCENT} / 0.10)`,
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            {/* faint lime corner glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full blur-2xl"
              style={{ background: `hsl(${ACCENT} / 0.16)` }}
            />

            <div className="relative z-10">
              {/* Eyebrow — chapter, not a step number */}
              {step.chapter && (
                <div
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: `hsl(${ACCENT})` }}
                >
                  <span className="flex h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${ACCENT})`, boxShadow: `0 0 8px hsl(${ACCENT})` }} />
                  {step.chapter}
                </div>
              )}

              <h3 className="text-[19px] font-display font-semibold mt-2.5 leading-tight tracking-tight text-white">
                {step.title}
              </h3>
              <p className="text-[14px] text-white/65 mt-2 leading-relaxed">{step.body}</p>

              {/* Footer: continuous progress bar (no numbering) + CTA */}
              <div className="flex items-center gap-3 mt-6">
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    initial={false}
                    animate={{ width: `${((index + 1) / total) * 100}%` }}
                    transition={{ type: "spring", stiffness: 200, damping: 30 }}
                    style={{ background: `linear-gradient(90deg, hsl(${ACCENT} / 0.7), hsl(${ACCENT}))`, boxShadow: `0 0 10px hsl(${ACCENT} / 0.6)` }}
                  />
                </div>

                {isStuck && advanceMode !== "next-button" ? (
                  <button
                    onClick={() => onNext()}
                    className="inline-flex items-center px-3.5 py-2.5 rounded-full border border-white/15 text-white/80 text-[13px] font-medium pressable whitespace-nowrap hover:bg-white/5 hover:text-white transition-colors"
                  >
                    Skip step &rarr;
                  </button>
                ) : advanceMode === "next-button" ? (
                  <button
                    onClick={() => onNext()}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[14px] font-semibold pressable whitespace-nowrap transition-all hover:brightness-105"
                    style={{ background: `linear-gradient(180deg, hsl(${ACCENT}), hsl(${ACCENT} / 0.88))`, color: ACCENT_INK, boxShadow: `0 6px 18px hsl(${ACCENT} / 0.4)` }}
                  >
                    {step.buttonLabel || (isLast ? "Done" : "Next")}
                    {!isLast && <ArrowRight className="h-4 w-4" />}
                  </button>
                ) : (
                  <div
                    className="px-3.5 py-2.5 rounded-full flex items-center gap-2 whitespace-nowrap"
                    style={{ background: `hsl(${ACCENT} / 0.12)`, border: `1px solid hsl(${ACCENT} / 0.3)` }}
                  >
                    <span className="flex h-2 w-2 rounded-full animate-pulse" style={{ background: `hsl(${ACCENT})`, boxShadow: `0 0 8px hsl(${ACCENT})` }} />
                    <span className="text-[13px] font-semibold" style={{ color: `hsl(${ACCENT})` }}>
                      {advanceMode === "navigate" ? "Tap to continue" : "Tap the highlight"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Skip confirmation ───────────────────────────────────────── */}
      <AnimatePresence>
        {showSkipConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm pointer-events-auto"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="w-full max-w-[320px] rounded-3xl bg-surface p-6 shadow-2xl border border-border/50 text-center"
            >
              <h3 className="text-[18px] font-semibold text-foreground tracking-tight">End the tour?</h3>
              <p className="mt-2 text-[14px] text-secondary-fg leading-relaxed">
                No problem — you can replay it anytime from Settings.
              </p>
              <div className="mt-6 flex flex-col gap-2.5">
                <button
                  onClick={() => { haptics.selection(); onSkip(); }}
                  className="w-full rounded-2xl bg-surface-elevated py-3.5 text-[14px] font-semibold text-foreground border border-border/50 pressable"
                >
                  End tour
                </button>
                <button
                  onClick={() => setShowSkipConfirm(false)}
                  className="w-full rounded-2xl py-3.5 text-[14px] font-semibold text-primary-foreground pressable bg-gradient-to-r from-primary to-primary-glow shadow-[0_4px_12px_hsl(var(--primary)/0.4)]"
                >
                  Keep going
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
