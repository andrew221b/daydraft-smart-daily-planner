import { X, ArrowRight } from "lucide-react";
import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { haptics } from "@/lib/haptics";

type OverlayStep = {
  title?: string;
  body?: string;
  placement?: "top" | "bottom" | "auto" | "center";
  advance?: "next-button" | "click-target" | "auto-delay" | "dom-mutation" | "navigate";
  buttonLabel?: string;
  silent?: boolean;
};

const PADDING = 8;
const GAP = 14;

export default function TourOverlay({
  rect,
  step,
  index,
  total,
  onNext,
  onSkip,
  isStuck,
}: {
  rect: DOMRect;
  step: OverlayStep;
  index: number;
  total: number;
  onNext: (clearData?: boolean) => void;
  onSkip: (clearData?: boolean) => void;
  isStuck?: boolean;
}) {
  const isLast = index === total - 1;
  const padX = PADDING,
    padY = PADDING;
  const x = Math.max(8, rect.left - padX);
  const y = Math.max(8, rect.top - padY);
  const w = rect.width + padX * 2;
  const h = rect.height + padY * 2;
  const radius = 16;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tipH, setTipH] = useState(180);
  useLayoutEffect(() => {
    if (tooltipRef.current) setTipH(tooltipRef.current.getBoundingClientRect().height);
  }, [step.title, step.body, vw, vh, step.silent]);

  // Trigger haptics on step change
  useEffect(() => {
    if (!step.silent) {
      if (isLast) haptics.notify("success");
      else haptics.impact("light");
    }
  }, [step.id, step.silent, isLast]);

  const isCenter = step.placement === "center";
  const advanceMode = step.advance || "next-button";

  const spaceBelow = vh - (y + h) - 16;
  const spaceAbove = y - 16;
  let placeBelow: boolean;
  if (step.placement === "bottom") placeBelow = spaceBelow >= tipH + GAP || spaceBelow >= spaceAbove;
  else if (step.placement === "top") placeBelow = !(spaceAbove >= tipH + GAP || spaceAbove >= spaceBelow);
  else placeBelow = spaceBelow >= spaceAbove;

  let tooltipTop: number;
  let tooltipLeft: number;
  const tooltipWidth = Math.min(340, vw - 32);

  if (isCenter) {
    tooltipTop = Math.max(16, (vh - tipH) / 2);
    tooltipLeft = (vw - tooltipWidth) / 2;
  } else {
    tooltipTop = placeBelow
      ? Math.min(vh - tipH - 16, y + h + GAP)
      : Math.max(16, y - GAP - tipH);
    const targetCenter = x + w / 2;
    tooltipLeft = Math.max(16, Math.min(vw - tooltipWidth - 16, targetCenter - tooltipWidth / 2));
  }

  // Create a polygon that covers the whole screen EXCEPT the hole.
  // This allows clicks to pass through the hole, while blocking them everywhere else.
  const clipPath = `polygon(0% 0%, 0% 100%, ${x}px 100%, ${x}px ${y}px, ${x + w}px ${y}px, ${x + w}px ${y + h}px, ${x}px ${y + h}px, ${x}px 100%, 100% 100%, 100% 0%)`;

  // Determine direction for smooth tooltip slide based on placement
  const yOffset = isCenter ? 0 : placeBelow ? -20 : 20;

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none tour-backdrop-in" aria-live="polite">
      {/* Visual backdrop with a hole - animated smoothly with framer-motion */}
      <svg width="100%" height="100%" className="absolute inset-0 pointer-events-none drop-shadow-2xl">
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <motion.rect 
              animate={{ x, y, width: w, height: h }}
              transition={{ type: "tween", duration: 0.15, ease: "easeOut" }}
              rx={radius} 
              ry={radius} 
              fill="black" 
            />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(5, 6, 18, 0.75)" mask="url(#tour-mask)" />
      </svg>

      {/* Blocking layer - handles clicks OUTSIDE the hole */}
      <div 
        className="absolute inset-0 pointer-events-auto"
        style={{ clipPath: advanceMode === "click-target" ? clipPath : undefined }}
        onClick={() => index > 0 ? setShowSkipConfirm(true) : onSkip()} // If they click the backdrop, ask to skip if they've made progress
      />

      {/* Global Skip Button - ALWAYS visible, even on silent steps */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 30 }}
        className="absolute top-[env(safe-area-inset-top,40px)] mt-4 right-4 z-[110] pointer-events-auto"
      >
        <button 
          onClick={() => index > 0 ? setShowSkipConfirm(true) : onSkip()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface/80 backdrop-blur-md border border-white/10 text-[13px] font-medium text-white/90 hover:bg-surface hover:text-white pressable shadow-[0_8px_16px_rgba(0,0,0,0.4)] transition-colors"
        >
          <X className="h-4 w-4" /> Skip tutorial
        </button>
      </motion.div>

      {/* Tooltip */}
      <AnimatePresence mode="wait">
        {!step.silent && (
          <motion.div
            key={step.id} // Animate when step changes
            ref={tooltipRef}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 350, damping: 30, mass: 0.9 }}
            className="absolute pointer-events-auto rounded-3xl bg-surface/95 backdrop-blur-2xl border border-white/10 shadow-[0_24px_54px_-12px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.15)] p-5 w-full tour-tooltip-spring"
            style={{ width: tooltipWidth, top: tooltipTop, left: tooltipLeft }}
          >

            <div className="relative z-10">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-primary/90 flex items-center gap-1.5">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-primary" />
                  Step {index + 1} of {total}
                </div>
              </div>
              <h3 className="text-[18px] font-display font-semibold mt-3 leading-tight tracking-tight text-foreground">{step.title}</h3>
              <p className="text-[14px] text-secondary-fg mt-2 leading-relaxed">{step.body}</p>

              <div className="flex items-center gap-3 mt-6">
                <div className="flex gap-1.5 flex-1 items-center">
                  {Array.from({ length: total }).map((_, i) => (
                    <motion.span 
                      key={i} 
                      initial={false}
                      animate={{ 
                        backgroundColor: i <= index ? "hsl(var(--primary))" : "hsl(var(--border) / 0.5)",
                        scaleY: i === index ? 1.5 : 1,
                        opacity: i <= index ? 1 : 0.5
                      }}
                      className="h-1 flex-1 rounded-full transition-all duration-300" 
                    />
                  ))}
                </div>
                {isLast ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onNext(true)}
                      className="inline-flex items-center gap-1 px-3 py-2.5 rounded-full bg-destructive/10 text-destructive text-[13px] font-medium pressable whitespace-nowrap"
                    >
                      Start fresh
                    </button>
                    <button
                      onClick={() => onNext(false)}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-gradient-to-r from-primary to-primary-glow text-primary-foreground text-[13px] font-semibold pressable whitespace-nowrap shadow-[0_4px_12px_hsl(var(--primary)/0.4)]"
                    >
                      Keep data
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {isStuck && advanceMode !== "next-button" && (
                      <button
                        onClick={() => onNext()}
                        className="inline-flex items-center px-3 py-2.5 rounded-full border border-border/50 text-secondary-fg text-[13px] font-medium pressable whitespace-nowrap hover:bg-surface-elevated hover:text-foreground transition-colors"
                      >
                        Skip step &rarr;
                      </button>
                    )}
                    {(!isStuck || advanceMode === "next-button") && !step.silent && (
                      advanceMode === "next-button" ? (
                        <button
                          onClick={() => onNext()}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-primary text-primary-foreground text-[14px] font-semibold pressable shadow-[0_4px_14px_hsl(var(--primary)/0.4)] hover:brightness-110 transition-all"
                        >
                          {step.buttonLabel || "Next"} <ArrowRight className="h-4 w-4" />
                        </button>
                      ) : (
                        <div className="px-3.5 py-2.5 rounded-full bg-primary/10 border border-primary/25 flex items-center gap-2">
                          <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_hsl(var(--primary))]" />
                          <span className="text-[13px] font-medium text-primary">
                            {advanceMode === "navigate" ? "Navigate to continue" : "Tap highlight to continue"}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Skip Confirmation Modal */}
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
              <h3 className="text-[18px] font-semibold text-foreground tracking-tight">End tutorial early?</h3>
              <p className="mt-2 text-[14px] text-secondary-fg leading-relaxed">
                You're skipping the rest of the tour. Do you want to keep the test data you just created, or start fresh?
              </p>
              <div className="mt-6 flex flex-col gap-2.5">
                <button
                  onClick={() => { haptics.selection(); onSkip(true); }}
                  className="w-full rounded-2xl bg-destructive/10 py-3.5 text-[14px] font-semibold text-destructive pressable"
                >
                  Start fresh (Delete test data)
                </button>
                <button
                  onClick={() => { haptics.selection(); onSkip(false); }}
                  className="w-full rounded-2xl bg-surface-elevated py-3.5 text-[14px] font-semibold text-foreground border border-border/50 pressable"
                >
                  Keep data & skip
                </button>
                <button
                  onClick={() => setShowSkipConfirm(false)}
                  className="mt-1 w-full py-2 text-[13px] font-medium text-secondary-fg pressable"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

