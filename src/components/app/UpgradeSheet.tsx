import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Shield, Check, Lock } from "lucide-react";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { haptics } from "@/lib/haptics";
import { PRO_FEATURES, PRO_PLANS, ProFeatureCard, ProPlanRow, type ProPlanId } from "@/components/app/proPaywall";

export type UpgradeReason = "quota" | "feature" | "trial-banner" | "momentum";

const PAYWALL_COOLDOWN_KEY = "dd_paywall_last_open";
const PAYWALL_COOLDOWN_MS = 1000 * 60 * 30;
export const canShowPassivePaywall = () => {
  try {
    const last = Number(localStorage.getItem(PAYWALL_COOLDOWN_KEY) || 0);
    return !last || Date.now() - last > PAYWALL_COOLDOWN_MS;
  } catch { return true; }
};

/* ─── Headline copy per reason ─────────────────────────────────── */
const HEADLINE: Record<UpgradeReason, { h: string; sub: string }> = {
  quota: { h: "Keep the streak going.", sub: "You've used your free days. Pro removes every limit and adds the tools serious planners rely on." },
  feature: { h: "The full version of DayDraft.", sub: "Pro opens the planning cap, AI assistant, smart nudges, and billing-ready reports — all in one upgrade." },
  "trial-banner": { h: "Stay in control.", sub: "Don't lose your planning flow. Pro keeps you on unlimited days plus every feature you've already been using." },
  momentum: { h: "Protect your momentum.", sub: "One busy week shouldn't block the next. Pro keeps plans, nudges, and exports uncapped — forever." },
};

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
  const [plan, setPlan] = useState<ProPlanId>("annual");
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

  const { h, sub } = HEADLINE[reason];

  const ctaLabel = busy
    ? "Opening…"
    : plan === "annual"
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
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-40"
              style={{
                background: "radial-gradient(60% 100% at 50% 0%, hsl(var(--primary) / 0.10) 0%, transparent 80%)",
              }}
            />

            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.07] px-3 py-1 mb-4 relative z-10">
              <Lock className="h-2.5 w-2.5 text-primary" strokeWidth={2.5} />
              <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-primary">DayDraft Pro</span>
            </div>

            <h2 className="font-semibold text-[28px] leading-[1.15] tracking-tight text-foreground relative z-10 max-w-[280px]">
              {h}
            </h2>
            <p className="text-[13px] text-secondary-fg mt-2.5 leading-relaxed relative z-10 max-w-[260px]">
              {sub}
            </p>
          </div>

          {/* ─── Feature cards ────────────────────────────────────── */}
          <div className="px-4 flex flex-col gap-2.5 pb-1">
            {PRO_FEATURES.map((feat, i) => (
              <ProFeatureCard key={feat.id} feat={feat} index={i} />
            ))}
          </div>

          {/* ─── Plan selector ────────────────────────────────────── */}
          <div className="px-4 mt-5 flex flex-col gap-2">
            {PRO_PLANS.map((p) => (
              <ProPlanRow
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

            <div style={{ height: "max(20px, env(safe-area-inset-bottom, 0px))" }} />
          </div>
        </motion.div>
      </SheetContent>
    </Sheet>
  );
};
