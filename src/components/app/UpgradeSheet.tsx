import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Shield, Check, Lock } from "lucide-react";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import { PRO_FEATURES, PRO_PLANS, ProFeatureCard, ProPlanRow, type ProPlanId } from "@/components/app/proPaywall";
import { usePlanPrices } from "@/hooks/usePlanPrices";

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
  const [restoring, setRestoring] = useState(false);
  const prices = usePlanPrices();

  const checkout = async () => {
    haptics.impact();
    setBusy(true);
    try {
      await startCheckout(plan, {
        onSuccess: () => { toast.success("You're Pro — enjoy DayDraft."); onOpenChange(false); },
        onUnavailable: () => toast("Payments coming soon — we'll let you know."),
        onError: () => toast.error("Couldn't complete the purchase. Please try again."),
      });
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setRestoring(true);
    try {
      const { restorePurchases } = await import("@/lib/revenueCat");
      const { ok, isPro } = await restorePurchases();
      if (!ok) { toast("Restore isn't available here."); return; }
      if (isPro) { toast.success("Purchases restored — Pro is active."); onOpenChange(false); }
      else toast("No previous purchases found.");
    } finally {
      setRestoring(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    try { localStorage.setItem(PAYWALL_COOLDOWN_KEY, String(Date.now())); } catch { /* ignore */ }
  }, [open]);

  const { h } = HEADLINE[reason];

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
          <div className="relative px-6 pt-5 pb-4 text-center flex flex-col items-center">
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

            <h2 className="font-semibold text-[22px] leading-[1.2] tracking-tight text-foreground relative z-10 whitespace-nowrap">
              {h}
            </h2>
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
                priceInfo={prices[p.id]}
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

            <button
              type="button"
              onClick={restore}
              disabled={restoring}
              className="block w-full text-center mt-3.5 text-[12px] text-secondary-fg/60 hover:text-foreground pressable disabled:opacity-50 transition-colors"
            >
              {restoring ? "Restoring…" : "Restore purchases"}
            </button>

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
