/**
 * Shared Pro-paywall building blocks — used by BOTH the in-app UpgradeSheet
 * and the onboarding paywall step so the two never drift apart visually.
 *
 * The illustrations are hand-drawn-feeling line art: rounded caps/joins,
 * organic curves, a faint "object" layer + a brighter accent detail. Each one
 * carries the literal meaning of its feature so the card reads at a glance:
 *   • unlimited       → an ∞ loop with a couple of AI "sparkles"
 *   • drift nudges    → a compass that's being nudged back on course
 *   • pdf reports     → a page with a little bar chart + folded corner
 *   • billing details → two coins, the front one stamped with a $
 */
import { motion } from "framer-motion";
import { Zap, Compass, FileDown, Wallet, type LucideIcon } from "lucide-react";

/* ─── Feature data ─────────────────────────────────────────────── */
export type ProFeature = {
  id: "unlimited" | "drift" | "pdf_export" | "billing_reports";
  Icon: LucideIcon;
  accent: string; // raw HSL triplet, e.g. "211 95% 60%"
  title: string;
  desc: string;
};

export const PRO_FEATURES: readonly ProFeature[] = [
  {
    id: "unlimited",
    Icon: Zap,
    accent: "211 95% 60%",
    title: "Unlimited AI planning",
    desc: "Generate full schedules and chat with the AI assistant any day, no caps.",
  },
  {
    id: "drift",
    Icon: Compass,
    accent: "38 90% 54%",
    title: "Smart drift nudges",
    desc: "When your day slips, get a gentle heads-up and one-tap replan options.",
  },
  {
    id: "pdf_export",
    Icon: FileDown,
    accent: "265 80% 62%",
    title: "Professional PDF reports",
    desc: "Export your tracked time as polished, branded PDF reports — ready for clients.",
  },
  {
    id: "billing_reports",
    Icon: Wallet,
    accent: "155 70% 44%",
    title: "Billing & payment details",
    desc: "Include hourly rates, earned totals, and your payment instructions on every export.",
  },
] as const;

/* ─── Plan data ────────────────────────────────────────────────── */
export type ProPlanId = "annual" | "monthly" | "weekly";

export type ProPlan = {
  id: ProPlanId;
  label: string;
  price: string;
  period: string;
};

export const PRO_PLANS: readonly ProPlan[] = [
  { id: "annual", label: "Annual", price: "$59.99", period: "/year" },
  { id: "monthly", label: "Monthly", price: "$9.99", period: "/month" },
  { id: "weekly", label: "Weekly", price: "$3.99", period: "/week" },
] as const;

/* ─── Illustrations (hand-drawn line art) ──────────────────────── */
// A small twinkle/sparkle — a 4-point concave star drawn with quadratics
// that pull each edge toward the centre. Conveys "AI magic".
function Sparkle({ cx, cy, r, accent, opacity = 0.85 }: { cx: number; cy: number; r: number; accent: string; opacity?: number }) {
  return (
    <path
      d={`M ${cx} ${cy - r} Q ${cx} ${cy} ${cx + r} ${cy} Q ${cx} ${cy} ${cx} ${cy + r} Q ${cx} ${cy} ${cx - r} ${cy} Q ${cx} ${cy} ${cx} ${cy - r} Z`}
      fill={`hsl(${accent})`}
      opacity={opacity}
    />
  );
}

function IllustrationInfinity({ accent }: { accent: string }) {
  return (
    <svg width="64" height="56" viewBox="0 0 64 56" fill="none" aria-hidden>
      {/* Soft halo behind for depth */}
      <path
        d="M 32 30 C 28 22, 17 22, 17 30 C 17 38, 28 38, 32 30 C 36 22, 47 22, 47 30 C 47 38, 36 38, 32 30 Z"
        stroke={`hsl(${accent})`} strokeWidth="5" strokeLinecap="round" opacity="0.1"
      />
      {/* Main loop */}
      <path
        d="M 32 30 C 28 22, 17 22, 17 30 C 17 38, 28 38, 32 30 C 36 22, 47 22, 47 30 C 47 38, 36 38, 32 30 Z"
        stroke={`hsl(${accent})`} strokeWidth="2.5" strokeLinecap="round" opacity="0.78"
      />
      {/* Bright highlight along the top-left arc — catches the eye first */}
      <path
        d="M 32 30 C 29 24.5, 21.5 22.5, 18 27"
        stroke={`hsl(${accent})`} strokeWidth="2.5" strokeLinecap="round" opacity="1"
      />
      {/* Subtle crossing dot at the centre */}
      <circle cx="32" cy="30" r="1.8" fill={`hsl(${accent})`} opacity="0.38" />
      {/* AI sparkles — top-right, size-varied so they feel placed not generated */}
      <Sparkle cx={50} cy={14} r={4} accent={accent} opacity={0.9} />
      <Sparkle cx={43} cy={10} r={2.2} accent={accent} opacity={0.55} />
      {/* Micro accent, bottom-left void */}
      <circle cx="16" cy="43" r="1.5" fill={`hsl(${accent})`} opacity="0.28" />
    </svg>
  );
}

function IllustrationCompass({ accent }: { accent: string }) {
  return (
    <svg width="64" height="56" viewBox="0 0 64 56" fill="none" aria-hidden>
      {/* Faint outer bezel */}
      <circle cx="32" cy="28" r="16.5" stroke={`hsl(${accent})`} strokeWidth="1" opacity="0.18" />
      {/* Main dial */}
      <circle cx="32" cy="28" r="14.5" stroke={`hsl(${accent})`} strokeWidth="2.5" opacity="0.4" />
      {/* Cardinal ticks — longer at N/S/E/W */}
      <g stroke={`hsl(${accent})`} strokeLinecap="round" opacity="0.5">
        <line x1="32" y1="14.5" x2="32" y2="18" strokeWidth="2.2" />
        <line x1="45.5" y1="28" x2="42" y2="28" strokeWidth="2.2" />
        <line x1="32" y1="41.5" x2="32" y2="38" strokeWidth="2.2" />
        <line x1="18.5" y1="28" x2="22" y2="28" strokeWidth="2.2" />
      </g>
      {/* Intercardinal ticks — short, quiet */}
      <g stroke={`hsl(${accent})`} strokeWidth="1.5" strokeLinecap="round" opacity="0.22">
        <line x1="42.2" y1="17.8" x2="40.7" y2="19.3" />
        <line x1="42.2" y1="38.2" x2="40.7" y2="36.7" />
        <line x1="21.8" y1="17.8" x2="23.3" y2="19.3" />
        <line x1="21.8" y1="38.2" x2="23.3" y2="36.7" />
      </g>
      {/* Needle pointing NNE — "drifted" off true north, awaiting a nudge back */}
      {/* North blade: tip (37, 18), pivot (32, 28) — classic filled diamond half */}
      <path d="M 37 18 L 30 26.5 L 32.5 28.5 Z" fill={`hsl(${accent})`} opacity="0.9" />
      {/* South blade: opposite end, faded */}
      <path d="M 27 38 L 34 29.5 L 31.5 27.5 Z" fill={`hsl(${accent})`} opacity="0.28" />
      {/* Pivot ring */}
      <circle cx="32" cy="28" r="2.5" fill={`hsl(${accent})`} />
      <circle cx="32" cy="28" r="1.1" fill="hsl(0 0% 100% / 0.55)" />
    </svg>
  );
}

function IllustrationReport({ accent }: { accent: string }) {
  return (
    <svg width="64" height="56" viewBox="0 0 64 56" fill="none" aria-hidden>
      {/* Page body */}
      <path
        d="M 20 9 L 35 9 L 43 17 L 43 47 L 20 47 Z"
        stroke={`hsl(${accent})`} strokeWidth="2.5" strokeLinejoin="round" opacity="0.4"
      />
      {/* Fold corner */}
      <path d="M 35 9 L 35 17 L 43 17" stroke={`hsl(${accent})`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
      {/* "Text" lines — three lines, varied width, feel like real content */}
      <line x1="25" y1="21" x2="33" y2="21" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      <line x1="25" y1="26" x2="38" y2="26" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.42" />
      <line x1="25" y1="31" x2="30" y2="31" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      {/* Chart baseline */}
      <line x1="24" y1="44" x2="40" y2="44" stroke={`hsl(${accent})`} strokeWidth="1.5" strokeLinecap="round" opacity="0.32" />
      {/* Bars — 4 bars, ascending, heights feel like real data not generated */}
      <g stroke={`hsl(${accent})`} strokeWidth="3" strokeLinecap="round" opacity="0.88">
        <line x1="26.5" y1="44" x2="26.5" y2="41" />
        <line x1="30.5" y1="44" x2="30.5" y2="37" />
        <line x1="34.5" y1="44" x2="34.5" y2="39.5" />
        <line x1="38.5" y1="44" x2="38.5" y2="34" />
      </g>
    </svg>
  );
}

function IllustrationCoins({ accent }: { accent: string }) {
  return (
    <svg width="64" height="56" viewBox="0 0 64 56" fill="none" aria-hidden>
      {/* Back coin — outer edge */}
      <circle cx="40" cy="21" r="11" stroke={`hsl(${accent})`} strokeWidth="2.5" opacity="0.35" />
      {/* Back coin — inner rim for 3-D depth */}
      <circle cx="40" cy="21" r="8.5" stroke={`hsl(${accent})`} strokeWidth="1" opacity="0.18" />
      {/* Front coin — outer edge */}
      <circle cx="26" cy="33" r="12.5" stroke={`hsl(${accent})`} strokeWidth="2.5" opacity="0.72" />
      {/* Front coin — inner rim */}
      <circle cx="26" cy="33" r="9.8" stroke={`hsl(${accent})`} strokeWidth="1" opacity="0.3" />
      {/* $ vertical stem */}
      <line x1="26" y1="23.5" x2="26" y2="42.5" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.88" />
      {/* $ S-curve — two half-loops centred on the coin */}
      <path
        d="M 30 27 C 30 24.5, 22 24.5, 22 28.5 C 22 32.5, 30 32.5, 30 36.5 C 30 40, 22 40, 22 37.5"
        stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.88"
      />
    </svg>
  );
}

const ILLUSTRATIONS: Record<ProFeature["id"], (p: { accent: string }) => JSX.Element> = {
  unlimited: IllustrationInfinity,
  drift: IllustrationCompass,
  pdf_export: IllustrationReport,
  billing_reports: IllustrationCoins,
};

/* ─── Feature card ─────────────────────────────────────────────── */
export function ProFeatureCard({
  feat,
  index = 0,
  animate = true,
}: {
  feat: ProFeature;
  index?: number;
  /** When false the card is static (no mount entrance) — used when a parent
   *  already plays one cohesive reveal for the whole panel. */
  animate?: boolean;
}) {
  const { Icon, accent, title, desc, id } = feat;
  const Illustration = ILLUSTRATIONS[id];

  const inner = (
    <>
      <div className="pl-4 py-3.5 flex items-start gap-3 flex-1 min-w-0">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] mt-0.5"
          style={{ background: `hsl(${accent} / 0.13)`, color: `hsl(${accent})` }}
        >
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-foreground leading-snug">{title}</p>
          <p className="text-[12px] text-secondary-fg/75 mt-0.5 leading-snug">{desc}</p>
        </div>
      </div>
      <div className="w-[72px] self-stretch flex items-center justify-center flex-shrink-0 overflow-hidden opacity-80">
        <Illustration accent={accent} />
      </div>
    </>
  );

  const className =
    "flex items-center rounded-[18px] border border-border/30 bg-card/50 backdrop-blur-sm overflow-hidden";

  if (!animate) return <div className={className}>{inner}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut", delay: index * 0.04 }}
      className={className}
    >
      {inner}
    </motion.div>
  );
}

/* ─── Plan row ─────────────────────────────────────────────────── */
export function ProPlanRow({
  plan,
  active,
  onClick,
}: {
  plan: ProPlan;
  active: boolean;
  onClick: () => void;
}) {
  const isAnnual = plan.id === "annual";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full text-left rounded-[16px] px-4 py-3.5 pressable transition-all duration-200 border ${
        active ? "ring-2 ring-primary/60 bg-primary/[0.08] border-primary/20" : "bg-card/40 border-border/30"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            active ? "border-primary" : "border-border/60"
          }`}
        >
          {active && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
        </span>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[14px] font-semibold text-foreground">{plan.label}</span>
          {isAnnual && <span className="text-[11px] font-semibold text-amber-500">Save 50%</span>}
        </div>

        <div className="text-right shrink-0">
          {isAnnual ? (
            <>
              <p className="text-[14px] font-semibold text-foreground tabular-nums">
                $4.99<span className="text-[12px] font-normal text-secondary-fg">/mo</span>
              </p>
              <p className="text-[11px] text-secondary-fg/60 tabular-nums">billed $59.99/yr</p>
            </>
          ) : (
            <p className="text-[14px] font-semibold text-foreground tabular-nums">
              {plan.price}
              <span className="text-[12px] font-normal text-secondary-fg">{plan.period}</span>
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
