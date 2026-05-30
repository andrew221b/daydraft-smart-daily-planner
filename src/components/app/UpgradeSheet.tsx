import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Zap, Compass, FileDown, Wallet, Shield, Check, Lock } from "lucide-react";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { haptics } from "@/lib/haptics";

export type UpgradeReason = "quota" | "feature" | "trial-banner" | "momentum";

const PAYWALL_COOLDOWN_KEY = "dd_paywall_last_open";
const PAYWALL_COOLDOWN_MS = 1000 * 60 * 30;
export const canShowPassivePaywall = () => {
  try {
    const last = Number(localStorage.getItem(PAYWALL_COOLDOWN_KEY) || 0);
    return !last || Date.now() - last > PAYWALL_COOLDOWN_MS;
  } catch { return true; }
};

/* ─── Feature cards data ──────────────────────────────────────── */
const FEATURES = [
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
const PLANS = [
  {
    id: "annual" as const,
    label: "Annual",
    price: "$59.99",
    pricePerMonth: "$4.99",
    period: "/year",
    badge: "Save 50%",
    tagline: "Most popular",
    highlight: true,
  },
  {
    id: "monthly" as const,
    label: "Monthly",
    price: "$9.99",
    pricePerMonth: "$9.99",
    period: "/month",
    badge: null,
    tagline: null,
    highlight: false,
  },
  {
    id: "weekly" as const,
    label: "Weekly",
    price: "$3.99",
    pricePerMonth: null,
    period: "/week",
    badge: null,
    tagline: null,
    highlight: false,
  },
] as const;

type Plan = (typeof PLANS)[number]["id"];

/* ─── Headline copy per reason ─────────────────────────────────── */
const HEADLINE: Record<UpgradeReason, { h: string; sub: string }> = {
  quota: { h: "Keep the streak going.", sub: "You've used your free days. Pro removes every limit and adds the tools serious planners rely on." },
  feature: { h: "The full version of DayDraft.", sub: "Pro opens the planning cap, AI assistant, smart nudges, and billing-ready reports — all in one upgrade." },
  "trial-banner": { h: "Stay in control.", sub: "Don't lose your planning flow. Pro keeps you on unlimited days plus every feature you've already been using." },
  momentum: { h: "Protect your momentum.", sub: "One busy week shouldn't block the next. Pro keeps plans, nudges, and exports uncapped — forever." },
};

function IllustrationInfinity({ accent }: { accent: string }) {
  return (
    <svg width="64" height="56" viewBox="0 0 64 56" fill="none" aria-hidden>
      <path d="M18 28 C 10 16, 2 36, 18 36 C 26 36, 38 20, 46 20 C 62 20, 54 40, 46 40 C 38 40, 26 24, 18 24" stroke={`hsl(${accent})`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <circle cx="48" cy="16" r="2.5" fill={`hsl(${accent})`} />
      <path d="M 40 10 L 43 14 M 53 10 L 50 14" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function IllustrationNudge({ accent }: { accent: string }) {
  return (
    <svg width="64" height="56" viewBox="0 0 64 56" fill="none" aria-hidden>
      <path d="M 14 36 C 20 36, 24 20, 32 20 C 40 20, 44 32, 50 32" stroke={`hsl(${accent})`} strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
      <polyline points="44,26 50,32 44,38" stroke={`hsl(${accent})`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <circle cx="14" cy="36" r="3" fill={`hsl(${accent})`} opacity="0.8" />
      <circle cx="32" cy="20" r="3" fill={`hsl(${accent})`} opacity="0.5" />
    </svg>
  );
}

function IllustrationReport({ accent }: { accent: string }) {
  return (
    <svg width="64" height="56" viewBox="0 0 64 56" fill="none" aria-hidden>
      <rect x="20" y="10" width="24" height="36" rx="3" stroke={`hsl(${accent})`} strokeWidth="2.5" opacity="0.4" />
      <line x1="26" y1="18" x2="38" y2="18" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <line x1="26" y1="24" x2="34" y2="24" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <circle cx="32" cy="35" r="5" stroke={`hsl(${accent})`} strokeWidth="2" opacity="0.8" />
      <path d="M 32 35 L 32 30 A 5 5 0 0 1 37 35 Z" fill={`hsl(${accent})`} opacity="0.8" />
    </svg>
  );
}

function IllustrationInvoice({ accent }: { accent: string }) {
  return (
    <svg width="64" height="56" viewBox="0 0 64 56" fill="none" aria-hidden>
      <path d="M 18 14 C 18 12, 20 10, 22 10 L 42 10 C 44 10, 46 12, 46 14 L 46 48 L 40 44 L 32 48 L 24 44 L 18 48 Z" stroke={`hsl(${accent})`} strokeWidth="2.5" strokeLinejoin="round" opacity="0.4" />
      <path d="M 28 22 C 28 19, 36 19, 36 22 C 36 25, 28 25, 28 28 C 28 31, 36 31, 36 28" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      <line x1="32" y1="18" x2="32" y2="32" stroke={`hsl(${accent})`} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

const ILLUSTRATIONS = {
  unlimited: IllustrationInfinity,
  drift: IllustrationNudge,
  pdf_export: IllustrationReport,
  billing_reports: IllustrationInvoice,
} as const;

/* ─── UpgradeSheet ─────────────────────────────────────────────── */
export const UpgradeSheet = ({
  open,
  onOpenChange,
  reason = "feature",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reason?: UpgradeReason;
}) => {
  const [plan, setPlan] = useState<Plan>("annual");
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const isDev = import.meta.env.DEV;

  const checkout = async () => {
    haptics.impact();
    setBusy(true);
    try {
      await startCheckout(plan, {
        onUnavailable: () => toast("Payments coming soon — we'll let you know."),
      });
    } finally {
      setBusy(false);
    }
  };

  const simulatePro = async () => {
    if (!user) return;
    const { error } = await supabase.from("subscriptions").upsert(
      {
        user_id: user.id, status: "active", plan: "annual",
        current_period_end: new Date(Date.now() + 365 * 86400000).toISOString(),
      } as any,
      { onConflict: "user_id" },
    );
    if (error) { toast.error(error.message); return; }
    toast.success("Simulated Pro · refresh to see");
    onOpenChange(false);
    setTimeout(() => location.reload(), 600);
  };

  useEffect(() => {
    if (!open) return;
    try { localStorage.setItem(PAYWALL_COOLDOWN_KEY, String(Date.now())); } catch { /* ignore */ }
  }, [open]);

  const activePlan = PLANS.find((p) => p.id === plan)!;
  const { h, sub } = HEADLINE[reason];

  const ctaLabel = busy
    ? "Opening…"
    : activePlan.id === "annual"
      ? "Start 7-day free trial"
      : "Continue with Pro";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/20 bg-background max-h-[96vh] flex flex-col p-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetTitle className="sr-only">Upgrade to Pro</SheetTitle>

        {/* Drag handle */}
        <div className="shrink-0 flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-foreground/15" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="flex-1 overflow-y-auto overscroll-contain scrollbar-none"
        >
          {/* ─── Hero ─────────────────────────────────────────────── */}
          <div className="relative px-6 pt-6 pb-5 text-center flex flex-col items-center">
            {/* Subtle radial behind hero only */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-40"
              style={{
                background: "radial-gradient(60% 100% at 50% 0%, hsl(var(--primary) / 0.10) 0%, transparent 80%)",
              }}
            />

            {/* Pro chip */}
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.07] px-3 py-1 mb-4 relative z-10">
              <Lock className="h-2.5 w-2.5 text-primary" strokeWidth={2.5} />
              <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-primary">DayDraft Pro</span>
            </div>

            {/* Headline */}
            <h2 className="font-semibold text-[28px] leading-[1.15] tracking-tight text-foreground relative z-10 max-w-[280px]">
              {h}
            </h2>
            <p className="text-[13px] text-secondary-fg mt-2.5 leading-relaxed relative z-10 max-w-[260px]">
              {sub}
            </p>
          </div>

          {/* ─── Feature cards ────────────────────────────────────── */}
          <div className="px-4 flex flex-col gap-2.5 pb-1">
            {FEATURES.map((feat, i) => (
              <FeatureCard key={feat.id} feat={feat} index={i} />
            ))}
          </div>

          {/* ─── Plan selector ────────────────────────────────────── */}
          <div className="px-4 mt-5 flex flex-col gap-2">
            {PLANS.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                active={plan === p.id}
                onClick={() => { haptics.selection(); setPlan(p.id); }}
              />
            ))}
          </div>

          {/* ─── CTA ──────────────────────────────────────────────── */}
          <div className="px-4 mt-5">
            <button
              type="button"
              onClick={checkout}
              disabled={busy}
              className="pressable w-full h-[56px] rounded-[18px] bg-primary text-primary-foreground text-[15px] font-semibold tracking-wide disabled:opacity-60"
            >
              {ctaLabel}
            </button>

            {/* Trust row */}
            <div className="flex items-center justify-center gap-6 mt-3.5">
              {[
                { Icon: Shield, text: "Cancel anytime" },
                { Icon: Check, text: "Secure payment" },
              ].map(({ Icon, text }) => (
                <span key={text} className="flex items-center gap-1 text-[11px] text-secondary-fg/55">
                  <Icon className="h-3 w-3" strokeWidth={2} />
                  {text}
                </span>
              ))}
            </div>

            {isDev && (
              <button
                onClick={simulatePro}
                className="block mx-auto mt-5 text-[11px] text-secondary-fg/30 hover:text-primary transition-colors underline"
              >
                dev: simulate Pro
              </button>
            )}

            <button
              onClick={() => onOpenChange(false)}
              className="block w-full text-center mt-4 text-[14px] text-secondary-fg/50 pressable"
            >
              Maybe later
            </button>

            {/* Bottom safe area */}
            <div style={{ height: "max(20px, env(safe-area-inset-bottom, 0px))" }} />
          </div>
        </motion.div>
      </SheetContent>
    </Sheet>
  );
};

/* ─── FeatureCard ──────────────────────────────────────────────── */
function FeatureCard({
  feat,
  index,
}: {
  feat: (typeof FEATURES)[number];
  index: number;
}) {
  const { Icon, accent, title, desc, id } = feat;
  const Illustration = ILLUSTRATIONS[id];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut", delay: index * 0.04 }}
      className="flex items-center rounded-[18px] border border-border/30 bg-card/50 backdrop-blur-sm overflow-hidden"
    >
      {/* Left: icon + text */}
      <div className="pl-4 py-3.5 flex items-start gap-3 flex-1 min-w-0">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] mt-0.5"
          style={{
            background: `hsl(${accent} / 0.13)`,
            color: `hsl(${accent})`,
          }}
        >
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-foreground leading-snug">{title}</p>
          <p className="text-[12px] text-secondary-fg/75 mt-0.5 leading-snug">{desc}</p>
        </div>
      </div>

      {/* Right: illustration — strictly clipped */}
      <div className="w-[72px] h-full flex items-center justify-center flex-shrink-0 overflow-hidden opacity-80">
        <Illustration accent={accent} />
      </div>
    </motion.div>
  );
}

/* ─── PlanCard ─────────────────────────────────────────────────── */
function PlanCard({
  plan,
  active,
  onClick,
}: {
  plan: (typeof PLANS)[number];
  active: boolean;
  onClick: () => void;
}) {
  const isAnnual = plan.id === "annual";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full text-left rounded-[16px] px-4 py-3.5 pressable transition-all duration-200 border ${
        active
          ? "ring-2 ring-primary/60 bg-primary/[0.08] border-primary/20"
          : "bg-card/40 border-border/30"
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Radio circle */}
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            active ? "border-primary" : "border-border/60"
          }`}
        >
          {active && (
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          )}
        </span>

        {/* Label + badge */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[14px] font-semibold text-foreground">{plan.label}</span>
          {isAnnual && (
            <span className="text-[11px] font-semibold text-amber-500">Save 50%</span>
          )}
        </div>

        {/* Price block */}
        <div className="text-right shrink-0">
          {isAnnual ? (
            <>
              <p className="text-[14px] font-semibold text-foreground tabular-nums">$4.99<span className="text-[12px] font-normal text-secondary-fg">/mo</span></p>
              <p className="text-[11px] text-secondary-fg/60 tabular-nums">billed $59.99/yr</p>
            </>
          ) : (
            <p className="text-[14px] font-semibold text-foreground tabular-nums">
              {plan.price}<span className="text-[12px] font-normal text-secondary-fg">{plan.period}</span>
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
