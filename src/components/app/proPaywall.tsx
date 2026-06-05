/**
 * Shared Pro-paywall building blocks — used by BOTH the in-app UpgradeSheet
 * and the onboarding paywall step so the two never drift apart visually.
 */
import { motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";
import { type PlanPrice } from "@/lib/revenueCat";

/* ─── Feature data ─────────────────────────────────────────────── */
export type ProFeature = {
  id: "unlimited" | "drift" | "pdf_export" | "billing_reports";
  Icon: LucideIcon;
  accent: string; // raw HSL triplet
  title: string;
  desc: string;
};

export const PRO_FEATURES: readonly ProFeature[] = [
  {
    id: "unlimited",
    Icon: (() => null) as unknown as LucideIcon,
    accent: "211 95% 60%",
    title: "Unlimited AI planning",
    desc: "Generate full schedules and chat with the AI assistant any day, no caps.",
  },
  {
    id: "drift",
    Icon: (() => null) as unknown as LucideIcon,
    accent: "38 90% 54%",
    title: "No daily planning cap",
    desc: "Free plan allows 5 planning days. Go Pro and plan every day — no cap, ever.",
  },
  {
    id: "pdf_export",
    Icon: (() => null) as unknown as LucideIcon,
    accent: "265 80% 62%",
    title: "Professional PDF reports",
    desc: "Export your tracked time as polished, branded PDF reports — ready for clients.",
  },
  {
    id: "billing_reports",
    Icon: (() => null) as unknown as LucideIcon,
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

/* ─── Custom icons ─────────────────────────────────────────────── */
// Each icon is drawn on a 32×32 grid with 2.5px consistent stroke weight.
// Design rule: max 4 paths, one clear metaphor, no decorative noise.

function IconUnlimited({ accent }: { accent: string }) {
  // Confident ∞ loop — one closed path, slightly thicker crossing dot.
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      {/* Main loop */}
      <path
        d="M 16 16 C 13 11 7 11 7 16 C 7 21 13 21 16 16 C 19 11 25 11 25 16 C 25 21 19 21 16 16 Z"
        stroke={`hsl(${accent})`} strokeWidth="2.8" strokeLinecap="round" fill="none"
      />
      {/* Centre accent dot */}
      <circle cx="16" cy="16" r="1.6" fill={`hsl(${accent})`} opacity="0.5" />
    </svg>
  );
}

function IconNoLimit({ accent }: { accent: string }) {
  // Calendar grid with an open padlock top-right — "plan any day, no cap".
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      {/* Calendar body */}
      <rect x="4" y="10" width="18" height="16" rx="2.5" stroke={`hsl(${accent})`} strokeWidth="2.2" opacity="0.45" />
      {/* Calendar top tabs */}
      <line x1="9" y1="7" x2="9" y2="12" stroke={`hsl(${accent})`} strokeWidth="2.2" strokeLinecap="round" />
      <line x1="17" y1="7" x2="17" y2="12" stroke={`hsl(${accent})`} strokeWidth="2.2" strokeLinecap="round" />
      {/* Header divider */}
      <line x1="4" y1="15" x2="22" y2="15" stroke={`hsl(${accent})`} strokeWidth="1.5" opacity="0.4" />
      {/* Day dots — a mini grid */}
      <g fill={`hsl(${accent})`} opacity="0.7">
        <circle cx="9" cy="19.5" r="1.3" />
        <circle cx="13" cy="19.5" r="1.3" />
        <circle cx="17" cy="19.5" r="1.3" />
        <circle cx="9" cy="23.5" r="1.3" />
        <circle cx="13" cy="23.5" r="1.3" />
      </g>
      {/* Open padlock top-right — shackle open (rotated) */}
      <rect x="22" y="18" width="7" height="6" rx="1.5" stroke={`hsl(${accent})`} strokeWidth="1.8" />
      <path d="M 23.5 18 L 23.5 15.5 C 23.5 13.8 28.5 13.8 28.5 15.5" stroke={`hsl(${accent})`} strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function IconReport({ accent }: { accent: string }) {
  // Three ascending bars — the simplest "progress over time" glyph.
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      {/* Baseline */}
      <line x1="7" y1="24.5" x2="25" y2="24.5" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      {/* Bar 1 — shortest */}
      <line x1="11" y1="24.5" x2="11" y2="19" stroke={`hsl(${accent})`} strokeWidth="3.2" strokeLinecap="round" opacity="0.45" />
      {/* Bar 2 — mid */}
      <line x1="16" y1="24.5" x2="16" y2="14" stroke={`hsl(${accent})`} strokeWidth="3.2" strokeLinecap="round" opacity="0.7" />
      {/* Bar 3 — tallest, accent */}
      <line x1="21" y1="24.5" x2="21" y2="8" stroke={`hsl(${accent})`} strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

function IconBilling({ accent }: { accent: string }) {
  // Clean banknote shape — two rounded corners cut like a bill, $ centre.
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      {/* Banknote outline */}
      <rect x="4" y="10" width="24" height="13" rx="3" stroke={`hsl(${accent})`} strokeWidth="2.2" opacity="0.4" />
      {/* Corner accent circles (classic banknote detail) */}
      <circle cx="8.5" cy="16.5" r="2.5" stroke={`hsl(${accent})`} strokeWidth="1.5" opacity="0.3" />
      <circle cx="23.5" cy="16.5" r="2.5" stroke={`hsl(${accent})`} strokeWidth="1.5" opacity="0.3" />
      {/* $ vertical bar */}
      <line x1="16" y1="12.5" x2="16" y2="20.5" stroke={`hsl(${accent})`} strokeWidth="1.8" strokeLinecap="round" />
      {/* $ S-curve — two arcs, clean */}
      <path
        d="M 18 14 C 18 12.8 14 12.8 14 15 C 14 17.2 18 17.2 18 19.2 C 18 21 14 21 14 19.5"
        stroke={`hsl(${accent})`} strokeWidth="1.8" strokeLinecap="round" fill="none"
      />
    </svg>
  );
}

const ICONS: Record<ProFeature["id"], (p: { accent: string }) => JSX.Element> = {
  unlimited: IconUnlimited,
  drift: IconNoLimit,
  pdf_export: IconReport,
  billing_reports: IconBilling,
};

/* ─── Feature card ─────────────────────────────────────────────── */
export function ProFeatureCard({
  feat,
  index = 0,
  animate = true,
}: {
  feat: ProFeature;
  index?: number;
  animate?: boolean;
}) {
  const { accent, title, desc, id } = feat;
  const IconGlyph = ICONS[id];

  const inner = (
    <div className="px-3.5 py-3 flex items-center gap-3">
      {/* Icon box — tinted background, custom glyph */}
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
        style={{ background: `hsl(${accent} / 0.18)` }}
      >
        <IconGlyph accent={accent} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-foreground leading-snug">{title}</p>
        <p className="text-[11.5px] text-secondary-fg/70 mt-0.5 leading-snug">{desc}</p>
      </div>
    </div>
  );

  const cardStyle = {
    background: `linear-gradient(135deg, hsl(${accent} / 0.10) 0%, hsl(var(--card) / 0.72) 55%)`,
    borderColor: `hsl(${accent} / 0.30)`,
  };
  const className = "rounded-[16px] border backdrop-blur-sm overflow-hidden";

  if (!animate) return <div className={className} style={cardStyle}>{inner}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut", delay: index * 0.04 }}
      className={className}
      style={cardStyle}
    >
      {inner}
    </motion.div>
  );
}

/* ─── Plan row ─────────────────────────────────────────────────── */
function fmtPlanMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

export function ProPlanRow({
  plan,
  active,
  onClick,
  priceInfo,
}: {
  plan: ProPlan;
  active: boolean;
  onClick: () => void;
  priceInfo?: PlanPrice;
}) {
  const isAnnual = plan.id === "annual";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full text-left rounded-[14px] px-4 py-3 pressable transition-all duration-200 border ${
        active ? "ring-2 ring-primary/60 bg-primary/[0.08] border-primary/20" : "bg-card/40 border-border/30"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300 ${
            active ? "border-primary" : "border-border/60"
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full bg-primary transition-all duration-300 ease-out origin-center ${
              active ? "scale-100 opacity-100" : "scale-0 opacity-0"
            }`}
          />
        </span>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[13.5px] font-semibold text-foreground">{plan.label}</span>
          {isAnnual && <span className="text-[11px] font-semibold text-amber-500">Save 50%</span>}
        </div>

        <div className="text-right shrink-0">
          {isAnnual ? (
            <>
              <p className="text-[13.5px] font-semibold text-foreground tabular-nums">
                {priceInfo ? fmtPlanMoney(priceInfo.price / 12, priceInfo.currencyCode) : "$4.99"}
                <span className="text-[11.5px] font-normal text-secondary-fg">/mo</span>
              </p>
              <p className="text-[11px] text-secondary-fg/60 tabular-nums">
                billed {priceInfo ? priceInfo.priceString : "$59.99"}/yr
              </p>
            </>
          ) : (
            <p className="text-[13.5px] font-semibold text-foreground tabular-nums">
              {priceInfo ? priceInfo.priceString : plan.price}
              <span className="text-[11.5px] font-normal text-secondary-fg">{plan.period}</span>
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
