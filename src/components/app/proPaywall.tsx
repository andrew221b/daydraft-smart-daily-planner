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
  id: "unlimited" | "smart_parsing" | "insights" | "pdf_export" | "billing_reports";
  Icon: LucideIcon;
  accent: string; // raw HSL triplet
  title: string;
  desc: string;
};

// Descriptions are kept tight (~45 chars) on purpose — at this card width
// anything longer wraps to 2 lines, and with 5 cards now in the list that's
// the single biggest driver of the sheet needing to scroll on shorter
// screens (see UpgradeSheet's sticky footer + this trim, done together).
export const PRO_FEATURES: readonly ProFeature[] = [
  {
    id: "unlimited",
    Icon: (() => null) as unknown as LucideIcon,
    accent: "211 95% 60%",
    title: "Unlimited AI planning",
    desc: "Generate schedules and chat with AI, no caps.",
  },
  {
    id: "smart_parsing",
    Icon: (() => null) as unknown as LucideIcon,
    accent: "186 80% 48%",
    title: "Smart task parsing",
    desc: "Type freely — AI understands what you need.",
  },
  {
    id: "insights",
    Icon: (() => null) as unknown as LucideIcon,
    accent: "38 90% 54%",
    title: "Daily AI Insights",
    desc: "A daily challenge, plus yesterday's recap.",
  },
  {
    id: "pdf_export",
    Icon: (() => null) as unknown as LucideIcon,
    accent: "265 80% 62%",
    title: "Professional PDF reports",
    desc: "Polished PDF reports, ready for clients.",
  },
  {
    id: "billing_reports",
    Icon: (() => null) as unknown as LucideIcon,
    accent: "155 70% 44%",
    title: "Billing & payment details",
    desc: "Rates and payment details on every export.",
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

// v2: every icon below moved from thin single-weight strokes to solid
// filled shapes + a soft offset shadow-echo layer (duotone depth) — the
// flat schematic-diagram look was the actual complaint, more than the
// metaphors themselves. A couple of metaphors were also swapped for
// something more specific to the feature (sunrise instead of a generic
// AI-sparkle burst, a folded report page instead of a bare bar chart).

function IconUnlimited({ accent }: { accent: string }) {
  // Bold ribbon-weight ∞ loop with a shadow echo behind it for depth.
  const d = "M 16 16 C 13 11 7 11 7 16 C 7 21 13 21 16 16 C 19 11 25 11 25 16 C 25 21 19 21 16 16 Z";
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d={d} transform="translate(0.75, 1.25)" stroke={`hsl(${accent})`} strokeWidth="3.4" strokeLinecap="round" fill="none" opacity="0.22" />
      <path d={d} stroke={`hsl(${accent})`} strokeWidth="3.4" strokeLinecap="round" fill="none" />
      <circle cx="16" cy="16" r="1.7" fill={`hsl(${accent})`} />
    </svg>
  );
}

function IconParse({ accent }: { accent: string }) {
  // A solid wand tips a filled star and leaves behind two resolved, filled
  // chips — "AI reads what you typed and cleans it up."
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M 7.5 25.2 L 19 13.6" stroke={`hsl(${accent})`} strokeWidth="3.6" strokeLinecap="round" opacity="0.2" transform="translate(0.7,1)" />
      <path d="M 6.5 24.5 L 18 12.8" stroke={`hsl(${accent})`} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M 21 6.5 L 22.6 10.4 L 26.5 12 L 22.6 13.6 L 21 17.5 L 19.4 13.6 L 15.5 12 L 19.4 10.4 Z" fill={`hsl(${accent})`} />
      <rect x="17.5" y="21" width="10.5" height="3.2" rx="1.6" fill={`hsl(${accent})`} opacity="0.85" />
      <rect x="17.5" y="25.8" width="7" height="3.2" rx="1.6" fill={`hsl(${accent})`} opacity="0.5" />
    </svg>
  );
}

function IconInsights({ accent }: { accent: string }) {
  // Sunrise, not the generic AI-sparkle burst — ties to "daily" and reads as
  // its own mark instead of the single most overused AI-feature cliché.
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="16" cy="18" r="9" fill={`hsl(${accent} / 0.16)`} />
      <line x1="6" y1="23" x2="26" y2="23" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.35" />
      <path d="M 9 23 A 7 7 0 0 1 23 23 Z" fill={`hsl(${accent})`} />
      <line x1="16" y1="7" x2="16" y2="10" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" />
      <line x1="8.5" y1="10.5" x2="10.3" y2="12.3" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <line x1="23.5" y1="10.5" x2="21.7" y2="12.3" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function IconReport({ accent }: { accent: string }) {
  // A folded-corner page with an ascending bar chart inside it — specific to
  // "PDF report," not a bare chart glyph that could mean any analytics.
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M 7.8 4.8 L 19.3 4.8 L 24.8 10.3 L 24.8 27.8 L 7.8 27.8 Z" fill={`hsl(${accent} / 0.18)`} transform="translate(0.8,0.8)" />
      <path d="M 7 4 L 18.5 4 L 24 9.5 L 24 27 L 7 27 Z" fill={`hsl(${accent} / 0.16)`} stroke={`hsl(${accent})`} strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M 18.5 4 L 18.5 9.5 L 24 9.5" stroke={`hsl(${accent})`} strokeWidth="1.9" strokeLinejoin="round" fill="none" />
      <rect x="10.5" y="19.5" width="2.8" height="4.5" rx="1" fill={`hsl(${accent})`} opacity="0.6" />
      <rect x="14.6" y="16.5" width="2.8" height="7.5" rx="1" fill={`hsl(${accent})`} opacity="0.85" />
      <rect x="18.7" y="13.5" width="2.8" height="10.5" rx="1" fill={`hsl(${accent})`} />
    </svg>
  );
}

function IconBilling({ accent }: { accent: string }) {
  // An invoice card (not a generic banknote) with a solid $ badge overlapping
  // the corner — the badge reuses the same $ S-curve construction as before,
  // just scaled into a small filled circle instead of drawn at full size.
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="6.8" y="9.8" width="16" height="13" rx="1.8" fill={`hsl(${accent} / 0.18)`} />
      <rect x="6" y="9" width="16" height="13" rx="1.8" fill={`hsl(${accent} / 0.16)`} stroke={`hsl(${accent})`} strokeWidth="1.8" />
      <line x1="9" y1="14.2" x2="17" y2="14.2" stroke={`hsl(${accent})`} strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <line x1="9" y1="17.4" x2="14" y2="17.4" stroke={`hsl(${accent})`} strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <circle cx="22.5" cy="20.5" r="5.5" fill={`hsl(${accent})`} />
      <path
        d="M 24 18.3 C 24 17.4 20.8 17.4 20.8 19 C 20.8 20.6 24 20.6 24 22.2 C 24 23.8 20.8 23.8 20.8 22.7"
        stroke="white" strokeWidth="1.3" strokeLinecap="round" fill="none"
      />
      <line x1="22.4" y1="17" x2="22.4" y2="23.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

const ICONS: Record<ProFeature["id"], (p: { accent: string }) => JSX.Element> = {
  unlimited: IconUnlimited,
  smart_parsing: IconParse,
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
      className={`relative w-full text-left rounded-[16px] px-4 py-2.5 pressable transition-all duration-200 border origin-center ${
        active ? "scale-[1.03] ring-2 ring-primary/60 bg-primary/[0.08] border-primary/30 shadow-md shadow-primary/5" : "scale-100 bg-card/40 border-border/60 hover:bg-card/60"
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
  showTrial,
}: {
  planId: ProPlanId;
  priceInfo?: PlanPrice;
  // When provided, controls whether the "3 days free" clause is shown. Lets the
  // caller gate it on real RevenueCat trial eligibility (e.g. a returning user
  // who already used the trial). Undefined → fall back to the old behaviour
  // (trial shown for the annual plan), so callers that don't pass it (onboarding
  // paywall, AskAi paywall) are unaffected.
  showTrial?: boolean;
}) {
  const plan = PRO_PLANS.find((p) => p.id === planId) ?? PRO_PLANS[0];
  const priceStr = priceInfo ? cleanPrice(priceInfo.priceString) : plan.price;
  const periodWord = plan.id === "annual" ? "year" : plan.id === "monthly" ? "month" : "week";
  const trial = showTrial ?? plan.id === "annual";
  const lead = trial ? `3 days free, then ${priceStr}/${periodWord}.` : `${priceStr}/${periodWord}.`;

  return (
    <div className="mt-0.5 px-3 text-center">
      <p className="text-[10.5px] leading-[1.3] text-secondary-fg/45">
        {lead} Auto-renews. Cancel anytime in settings.
      </p>
      <p className="text-[10.5px] leading-[1.3] text-secondary-fg/55">
        <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">Terms of Use</Link>
        <span className="px-1 text-secondary-fg/35">·</span>
        <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy Policy</Link>
      </p>
    </div>
  );
}
