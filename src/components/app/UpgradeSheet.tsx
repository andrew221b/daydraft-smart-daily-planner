import { useEffect, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { type ProFeatureId, proCatalogById } from "@/lib/proFeatures";

export type UpgradeReason = "quota" | "feature" | "trial-banner" | "momentum";

const reasonHeadline: Record<UpgradeReason, string> = {
  quota: "You've used your free planning days.",
  feature: "This is a Pro feature.",
  "trial-banner": "Don't lose what you've built.",
  momentum: "You're in a rhythm — protect it.",
};
const reasonSub: Record<UpgradeReason, string> = {
  quota: "Upgrade now and never worry about hitting the wall mid-week again. Pro is unlimited AI planning plus calendar-aware schedules.",
  feature: "Pro unlocks the full stack: unlimited plans, calendar sync, smarter AI, and every premium surface.",
  "trial-banner": "Stay on unlimited plans, calendar sync, and pattern-aware AI — the version of DayDraft you already rely on.",
  momentum: "Serious users upgrade so one busy week never blocks the next. Pro keeps plans, nudges, and insights uncapped.",
};
/** Bullet order per paywall context — ids must exist in `PRO_FEATURE_CATALOG`. */
const reasonOrder: Record<UpgradeReason, ProFeatureId[]> = {
  quota: ["unlimited", "calendar", "debrief", "pdf_export"],
  feature: ["unlimited", "calendar", "debrief", "pdf_export"],
  "trial-banner": ["unlimited", "calendar", "debrief", "drift"],
  momentum: ["unlimited", "drift", "timer_reschedule", "calendar"],
};
const reasonCta: Record<UpgradeReason, string> = {
  quota: "Upgrade to unlimited",
  feature: "Get Pro — unlock everything",
  "trial-banner": "Keep Pro access",
  momentum: "Upgrade & stay ahead",
};
const PAYWALL_COOLDOWN_KEY = "dd_paywall_last_open";
const PAYWALL_COOLDOWN_MS = 1000 * 60 * 30;
export const canShowPassivePaywall = () => {
  try {
    const last = Number(localStorage.getItem(PAYWALL_COOLDOWN_KEY) || 0);
    if (!last) return true;
    return Date.now() - last > PAYWALL_COOLDOWN_MS;
  } catch {
    return true;
  }
};

export const UpgradeSheet = ({
  open, onOpenChange, reason = "feature",
}: { open: boolean; onOpenChange: (v: boolean) => void; reason?: UpgradeReason }) => {
  const [plan, setPlan] = useState<"monthly" | "annual">("annual");
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();

  const checkout = async () => {
    setBusy(true);
    // analytics: paywall_checkout_clicked
    try {
      await startCheckout(plan, {
        onUnavailable: () => toast("Payments coming soon — we'll let you know."),
      });
    } finally { setBusy(false); }
  };

  const simulatePro = async () => {
    if (!user) return;
    // dev-only helper — flips the user's row to active for testing gated flows
    const { error } = await supabase.from("subscriptions").upsert({
      user_id: user.id, status: "active", plan: "annual",
      current_period_end: new Date(Date.now() + 365 * 86400000).toISOString(),
    } as any, { onConflict: "user_id" });
    if (error) { toast.error(error.message); return; }
    toast.success("Simulated Pro · refresh to see");
    onOpenChange(false);
    setTimeout(() => location.reload(), 600);
  };

  const isDev = import.meta.env.DEV;
  const orderedBenefits = reasonOrder[reason]
    .map((id) => proCatalogById(id))
    .filter((item): item is NonNullable<typeof item> => item != null)
    .map((item) => ({ icon: item.Icon, label: item.sheetLine, sub: item.tagline }));

  useEffect(() => {
    if (!open) return;
    try { localStorage.setItem(PAYWALL_COOLDOWN_KEY, String(Date.now())); } catch {/* ignore */}
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[24px] border-soft bg-background/95 backdrop-blur-xl max-h-[92vh] overflow-y-auto p-0">
        <div className="relative px-6 pt-7 pb-6 rounded-t-[24px]" style={{ background: "var(--gradient-glow)" }}>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full surface-accent border border-accent">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="eyebrow text-primary">DayDraft Pro</span>
          </div>
          <h2 className="font-display text-[24px] font-semibold leading-tight mt-3 text-balance">{reasonHeadline[reason]}</h2>
          <p className="text-secondary-fg text-[13px] mt-2 leading-[1.55]">{reasonSub[reason]}</p>
          <p className="text-[11px] text-primary/90 font-medium mt-3 leading-snug">
            Most people who plan several days a week choose Pro within their first two weeks.
          </p>
        </div>

        <div className="px-6 pb-6">
          <ul className="mt-4 space-y-3">
            {orderedBenefits.map(({ icon: Icon, label, sub }) => (
              <li key={label} className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-[10px] surface-accent border border-accent flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="text-[15px] font-medium leading-tight">{label}</div>
                  <div className="text-xs text-secondary-fg mt-0.5">{sub}</div>
                </div>
                <Check className="h-4 w-4 text-primary ml-auto mt-1.5 shrink-0" />
              </li>
            ))}
          </ul>

          {/* plan toggle */}
          <div className="grid grid-cols-2 gap-2 mt-6">
            <PlanCard
              active={plan === "annual"} onClick={() => setPlan("annual")}
              title="Annual" price="$59" sub="$4.92/mo" badge="Save 38%"
            />
            <PlanCard
              active={plan === "monthly"} onClick={() => setPlan("monthly")}
              title="Monthly" price="$7.99" sub="per month"
            />
          </div>

          <Button onClick={checkout} disabled={busy}
            className="w-full mt-5 h-13 py-3.5 rounded-[14px] bg-primary hover:bg-primary/92 text-primary-foreground text-[15px] font-medium pressable shadow-card"
           >
            {reasonCta[reason]}
          </Button>
          <p className="text-[11px] text-secondary-fg text-center mt-2 leading-relaxed">
            Transparent pricing · cancel before renewal anytime · no surprise add-ons
          </p>

          {isDev && (
            <button onClick={simulatePro} className="block mx-auto mt-4 text-[11px] text-faint hover:text-primary underline">
              dev: simulate Pro
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

const PlanCard = ({ active, onClick, title, price, sub, badge }: {
  active: boolean; onClick: () => void; title: string; price: string; sub: string; badge?: string;
}) => (
  <button onClick={onClick}
    className={`relative text-left rounded-[14px] border p-3.5 pressable transition-all backdrop-blur-sm ${
      active ? "border-accent surface-accent ring-1 ring-primary/10" : "border-soft surface-card"
    }`}>
    {badge && (
      <span className="absolute -top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">{badge}</span>
    )}
    <div className="eyebrow">{title}</div>
    <div className="font-display text-xl font-semibold tabular-nums mt-1">{price}</div>
    <div className="text-[11px] text-secondary-fg">{sub}</div>
  </button>
);