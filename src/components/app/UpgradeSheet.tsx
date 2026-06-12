import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Shield, Check, Lock, RotateCcw } from "lucide-react";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import { PRO_FEATURES, PRO_PLANS, ProFeatureCard, ProPlanRow, type ProPlanId } from "@/components/app/proPaywall";
import { usePlanPrices } from "@/hooks/usePlanPrices";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { enablePush, pushSupported } from "@/lib/push";

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
  const { user } = useAuth();
  const { update } = useProfile();

  const checkout = async () => {
    haptics.impact();
    setBusy(true);
    try {
      await startCheckout(plan, {
        onSuccess: () => {
          void update({ notifications_enabled: true });
          if (user?.id && pushSupported()) void enablePush(user.id);
          toast.success("You're Pro — enjoy DayDraft.");
          onOpenChange(false);
        },
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
        // 88vh keeps the rounded top well below the Dynamic Island / status bar
        // on every modern iPhone (96vh was reaching behind the system UI).
        className="rounded-t-[28px] border-border/20 bg-background max-h-[88vh] flex flex-col p-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetTitle className="sr-only">Upgrade to Pro</SheetTitle>

        {/* Drag handle */}
        <div className="shrink-0 flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-foreground/15" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="flex-1 overflow-y-auto overscroll-contain"
        >
          {/* ─── Hero ─────────────────────────────────────────────── */}
          <div className="relative px-6 pt-3 pb-3 text-center flex flex-col items-center">
            {/* Reduced gradient height so it doesn't visually bleed toward
                the top of the sheet (was h-40, looked like it overlapped the
                status bar on small phones). */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-24"
              style={{
                background: "radial-gradient(60% 100% at 50% 0%, hsl(var(--primary) / 0.09) 0%, transparent 80%)",
              }}
            />

            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.07] px-3 py-1 mb-3 relative z-10">
              <Lock className="h-2.5 w-2.5 text-primary" strokeWidth={2.5} />
              <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-primary">DayDraft Pro</span>
            </div>

            <h2 className="font-semibold text-[20px] leading-[1.2] tracking-tight text-foreground relative z-10">
              {h}
            </h2>
          </div>

          {/* ─── Feature cards ────────────────────────────────────── */}
          <div className="px-4 flex flex-col gap-1.5">
            {PRO_FEATURES.map((feat, i) => (
              <ProFeatureCard key={feat.id} feat={feat} index={i} />
            ))}
          </div>

          {/* ─── Plan selector ────────────────────────────────────── */}
          <div className="px-4 mt-4 flex flex-col gap-1.5">
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
          <div className="px-4 mt-4">
            <button
              type="button"
              onClick={checkout}
              disabled={busy}
              className="pressable w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground text-[15px] font-semibold tracking-wide disabled:opacity-60"
            >
              {ctaLabel}
            </button>

            {/* Trust badges + restore — flex-wrap so the row wraps on
                iPhone SE (375px) instead of overflowing. gap-3 is tighter
                than gap-5 to give each label more room. */}
            <div className="flex items-center justify-center gap-x-3 gap-y-1.5 flex-wrap mt-2.5">
              {[
                { Icon: Shield, text: "Cancel anytime" },
                { Icon: Check, text: "Secure payment" },
                { Icon: RotateCcw, text: "Restore", action: restore, loading: restoring },
              ].map(({ Icon, text, action, loading }) => (
                <button
                  key={text}
                  type="button"
                  onClick={action}
                  disabled={loading}
                  className="flex items-center gap-1 text-[11px] text-secondary-fg/55 pressable disabled:opacity-50 transition-colors hover:text-secondary-fg whitespace-nowrap"
                >
                  <Icon className="h-3 w-3 shrink-0" strokeWidth={2} />
                  {loading ? "Restoring…" : text}
                </button>
              ))}
            </div>

            <div style={{ height: "max(16px, env(safe-area-inset-bottom, 0px))" }} />
          </div>
        </motion.div>
      </SheetContent>
    </Sheet>
  );
};
