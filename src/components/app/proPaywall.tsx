/**
 * Shared Pro-paywall building blocks — used by BOTH the in-app UpgradeSheet
 * and the onboarding paywall step so the two never drift apart visually.
 */
import { memo } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { type LucideIcon } from "lucide-react";
import { type PlanPrice } from "@/lib/revenueCat";

/* ─── Feature data ─────────────────────────────────────────────── */
export type ProFeature = {
  id: "unlimited" | "insights" | "pdf_export" | "billing_reports";
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
    id: "insights",
    Icon: (() => null) as unknown as LucideIcon,
    accent: "38 90% 54%",
    title: "Daily AI Insights",
    desc: "A fresh riddle, quiz, or challenge every morning — plus a recap of yesterday.",
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

function IconInsights({ accent }: { accent: string }) {
  // Exact Lucide Sparkles paths (24×24 viewBox scaled to 32×32 by the SVG).
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* Main 4-pointed star */}
      <path
        d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
        stroke={`hsl(${accent})`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        fill={`hsl(${accent} / 0.18)`}
      />
      {/* Small sparkle top-right */}
      <path d="M20 3v4" stroke={`hsl(${accent})`} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M22 5h-4" stroke={`hsl(${accent})`} strokeWidth="1.8" strokeLinecap="round" />
      {/* Tiny sparkle bottom-left */}
      <path d="M4 17v2" stroke={`hsl(${accent})`} strokeWidth="1.8" strokeLinecap="round" opacity="0.55" />
      <path d="M5 18H3" stroke={`hsl(${accent})`} strokeWidth="1.8" strokeLinecap="round" opacity="0.55" />
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
  insights: IconInsights,
  pdf_export: IconReport,
  billing_reports: IconBilling,
};

/* ─── Feature card ─────────────────────────────────────────────── */
export const ProFeatureCard = memo(function ProFeatureCard({
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
    <div className="px-3.5 py-1.5 flex items-center gap-2.5">
      {/* Icon box — tinted background, custom glyph */}
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: `hsl(${accent} / 0.28)` }}
      >
        <IconGlyph accent={accent} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-foreground leading-tight">{title}</p>
        <p className="text-[11.5px] text-secondary-fg/70 mt-0.5 leading-[1.25]">{desc}</p>
      </div>
    </div>
  );

  const cardStyle = {
    background: `linear-gradient(135deg, hsl(${accent} / 0.10) 0%, hsl(var(--card) / 0.72) 55%)`,
    borderColor: `hsl(${accent} / 0.30)`,
  };
  // NOTE: no backdrop-blur here. The card sits on the sheet's opaque
  // bg-background, so blur was visually a no-op — but on iOS WKWebView each of
  // the 4 cards forced a full GPU re-composite on every repaint/animation frame,
  // which is what froze the paywall (1.5s+) on open and on plan-switch.
  const className = "rounded-[16px] border overflow-hidden";

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
});

/* ─── Plan row ─────────────────────────────────────────────────── */

// StoreKit (iOS) returns "US$59.99" instead of "$59.99" on non-US device
// locales for USD prices. Strip the two-letter country prefix so prices
// always show as "$59.99" regardless of locale.
function cleanPrice(s: string): string {
  return s.replace(/^[A-Z]{2}(\$|€|£|¥|₩|₹|₽|CHF\s*|AUD\s*|CAD\s*)/, "$1");
}

// Intl.NumberFormat construction is expensive on iOS JSCore (first call
// initialises ICU locale data). Cache by currency so we pay the cost once.
const fmtCache = new Map<string, Intl.NumberFormat>();
function fmtPlanMoney(amount: number, currency: string): string {
  try {
    let fmt = fmtCache.get(currency);
    if (!fmt) {
      fmt = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      fmtCache.set(currency, fmt);
    }
    return cleanPrice(fmt.format(amount));
  } catch {
    return amount.toFixed(2);
  }
}

export const ProPlanRow = memo(function ProPlanRow({
  plan,
  active,
  onSelect,
  priceInfo,
}: {
  plan: ProPlan;
  active: boolean;
  // Receives the plan id. Pass a STABLE handler (useCallback) so the row's memo
  // holds — otherwise every plan-switch re-renders all three rows.
  onSelect: (id: ProPlanId) => void;
  priceInfo?: PlanPrice;
}) {
  const isAnnual = plan.id === "annual";

  return (
    <button
      type="button"
      onClick={() => onSelect(plan.id)}
      className={`relative w-full text-left rounded-[16px] px-4 py-3 pressable transition-all duration-200 border ${
        active ? "ring-2 ring-primary/60 bg-primary/[0.08] border-primary/30 shadow-md shadow-primary/5" : "bg-card/40 border-border/60 hover:bg-card/60"
      }`}
    >
      <div className="flex items-center gap-4">
        <span
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300 ${
            active ? "border-primary" : "border-border/90"
          }`}
        >
          <span
            className={`h-3 w-3 rounded-full bg-primary transition-all duration-300 ease-out origin-center ${
              active ? "scale-100 opacity-100" : "scale-0 opacity-0"
            }`}
          />
        </span>

        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span className="text-[15px] font-semibold text-foreground">{plan.label}</span>
          {isAnnual && <span className="text-[11.5px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full uppercase tracking-wide">Save 50%</span>}
        </div>

        <div className="text-right shrink-0 min-w-[96px]">
          {isAnnual ? (
            <>
              <p className="text-[15px] font-semibold text-foreground tabular-nums">
                {priceInfo ? fmtPlanMoney(Math.floor(priceInfo.price / 12 * 100) / 100, priceInfo.currencyCode) : "$4.99"}
                <span className="text-[12px] font-normal text-secondary-fg/80">/mo</span>
              </p>
              <p className="text-[11px] text-secondary-fg/60 mt-0.5">
                Billed annually at {priceInfo ? fmtPlanMoney(priceInfo.price, priceInfo.currencyCode) : "$59.99"}
              </p>
            </>
          ) : (
            <p className="text-[15px] font-semibold text-foreground tabular-nums">
              {priceInfo ? cleanPrice(priceInfo.priceString) : plan.price}
              <span className="text-[12px] font-normal text-secondary-fg/80"> {plan.period}</span>
            </p>
          )}
        </div>
      </div>
    </button>
  );
});

/* ─── Subscription terms + legal links ─────────────────────────────
   Apple Guideline 3.1.2 requires the auto-renew terms AND functional
   links to the EULA (Terms) + Privacy Policy to be visible on the
   purchase screen itself — not just in Settings. Shared so the in-app
   sheet and the onboarding paywall always carry identical, compliant
   disclosure. The renewal line reflects the SELECTED plan + its real
   localized price, and the trial clause shows only when that plan
   actually carries one (annual). */
export function PaywallTerms({
  planId,
  priceInfo,
}: {
  planId: ProPlanId;
  priceInfo?: PlanPrice;
}) {
  const plan = PRO_PLANS.find((p) => p.id === planId) ?? PRO_PLANS[0];
  const priceStr = priceInfo ? cleanPrice(priceInfo.priceString) : plan.price;
  const periodWord = plan.id === "annual" ? "year" : plan.id === "monthly" ? "month" : "week";
  const lead = plan.id === "annual" ? `3 days free, then ${priceStr}/${periodWord}.` : `${priceStr}/${periodWord}.`;

  return (
    <div className="mt-2 px-3 text-center">
      <p className="text-[10.5px] leading-[1.45] text-secondary-fg/45">
        {lead} Auto-renews. Cancel anytime in settings.
      </p>
      <p className="text-[10.5px] leading-[1.5] text-secondary-fg/55 mt-1">
        <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">Terms of Use</Link>
        <span className="px-1 text-secondary-fg/35">·</span>
        <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy Policy</Link>
      </p>
    </div>
  );
}
