import { motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

/**
 * Premium empty state — a single component the whole app can lean on
 * so empty screens feel intentional instead of "we forgot to design
 * this." Matches the hero-glass language used everywhere else:
 *   - soft ambient halo behind a glyph (no flat dashed boxes)
 *   - eyebrow + title + body copy with a clear visual hierarchy
 *   - optional primary CTA + optional secondary action
 *   - subtle stagger on mount so it doesn't pop in flatly
 *
 * The component is intentionally lightweight: no internal state, no
 * effects, no haptic side-effects. Callers wire those in via the
 * action callbacks.
 */
export function EmptyState({
  icon: Icon,
  eyebrow,
  title,
  body,
  primaryAction,
  secondaryAction,
  tone = "neutral",
  className = "",
}: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  body?: ReactNode;
  primaryAction?: { label: string; onClick: () => void; icon?: LucideIcon };
  secondaryAction?: { label: string; onClick: () => void };
  /** "primary" lets the halo pick up the app's accent tint. */
  tone?: "neutral" | "primary" | "success";
  className?: string;
}) {
  const haloColor = tone === "primary"
    ? "hsl(var(--primary) / 0.16)"
    : tone === "success"
    ? "hsl(var(--success) / 0.16)"
    : "hsl(var(--foreground) / 0.08)";

  const haloRing = tone === "primary"
    ? "hsl(var(--primary) / 0.30)"
    : tone === "success"
    ? "hsl(var(--success) / 0.30)"
    : "hsl(var(--foreground) / 0.18)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: [0.32, 0.72, 0, 1] }}
      className={`relative overflow-hidden rounded-[28px] hero-glass border border-border/65 px-6 py-10 text-center ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-12 h-40 opacity-70 blur-3xl"
        style={{
          background: `radial-gradient(50% 50% at 50% 50%, ${haloColor}, transparent 70%)`,
        }}
      />
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.05, type: "spring", stiffness: 280, damping: 22 }}
        className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl backdrop-blur-sm"
        style={{
          background: haloColor,
          boxShadow: `0 0 0 1px ${haloRing}, 0 14px 28px -16px ${haloRing}`,
        }}
      >
        <Icon className="h-7 w-7" strokeWidth={1.8} style={{ color: tone === "neutral" ? "hsl(var(--foreground) / 0.72)" : `hsl(var(--${tone}))` }} />
      </motion.div>

      <div className="relative mt-5 space-y-1.5">
        {eyebrow && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70">
            {eyebrow}
          </p>
        )}
        <p className="font-display text-[18px] font-semibold tracking-tight text-foreground">
          {title}
        </p>
        {body && (
          <p className="mx-auto max-w-[28ch] text-[13px] leading-relaxed text-secondary-fg/85">
            {body}
          </p>
        )}
      </div>

      {(primaryAction || secondaryAction) && (
        <div className="relative mt-6 flex flex-col items-center gap-2">
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-primary-foreground pressable shadow-[0_6px_18px_-8px_hsl(var(--primary)/0.55)]"
            >
              {primaryAction.icon && <primaryAction.icon className="h-3.5 w-3.5" strokeWidth={2.4} />}
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="text-[12px] font-medium text-secondary-fg/80 hover:text-foreground pressable px-3 py-1.5"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
