import { useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Calendar, Brain, Music, Zap } from "lucide-react";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const benefits = [
  { icon: Calendar, label: "Google Calendar sync", sub: "Plan around your meetings" },
  { icon: Brain, label: "Compounding AI", sub: "Learns your patterns each week" },
  { icon: Zap, label: "Unlimited plans", sub: "No 5-per-week limit" },
  { icon: Music, label: "Focus soundscapes", sub: "Rain, café, lofi & more" },
];

export type UpgradeReason = "quota" | "feature" | "trial-banner";

const reasonHeadline: Record<UpgradeReason, string> = {
  quota: "You're on a roll.",
  feature: "Unlock the full DayDraft.",
  "trial-banner": "Two weeks in. Make it forever.",
};
const reasonSub: Record<UpgradeReason, string> = {
  quota: "Free is 5 plans a week. Pro is unlimited.",
  feature: "This feature is part of DayDraft Pro.",
  "trial-banner": "Lock in everything you've been using.",
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl border-border bg-surface-elevated max-h-[92vh] overflow-y-auto p-0">
        {/* gradient header */}
        <div className="relative px-6 pt-8 pb-6 rounded-t-3xl" style={{ background: "var(--gradient-glow)" }}>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/30">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">DayDraft Pro</span>
          </div>
          <h2 className="text-[26px] font-semibold leading-tight mt-3">{reasonHeadline[reason]}</h2>
          <p className="text-secondary-fg text-sm mt-1">{reasonSub[reason]}</p>
        </div>

        <div className="px-6 pb-6">
          <ul className="mt-4 space-y-3">
            {benefits.map(({ icon: Icon, label, sub }) => (
              <li key={label} className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
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
            className="w-full mt-5 h-13 py-3.5 rounded-xl text-primary-foreground text-base font-medium pressable"
           >
            Start 7-day free trial
          </Button>
          <p className="text-[11px] text-secondary-fg text-center mt-2">No charge today · Cancel anytime</p>

          {isDev && (
            <button onClick={simulatePro} className="block mx-auto mt-4 text-[11px] text-secondary-fg/70 hover:text-primary underline">
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
    className={`relative text-left rounded-xl border-2 p-3 pressable transition-all ${
      active ? "border-primary bg-primary/5" : "border-border bg-surface"
    }`}>
    {badge && (
      <span className="absolute -top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">{badge}</span>
    )}
    <div className="text-[11px] uppercase tracking-wider text-secondary-fg">{title}</div>
    <div className="text-xl font-semibold mt-1">{price}</div>
    <div className="text-[11px] text-secondary-fg">{sub}</div>
  </button>
);