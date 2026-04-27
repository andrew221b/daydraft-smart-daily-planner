import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "./UpgradeSheet";

/**
 * Replaces the old StreakBadge in the Today header.
 * Free / trial users see an "Upgrade" pill that opens the paywall.
 * Pro users see a subtle "Pro" badge (no action) — keeps the slot balanced.
 */
export const ProBadge = () => {
  const { isPro, entitlement } = useEntitlement();
  const [open, setOpen] = useState(false);

  if (isPro) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30">
        <Sparkles className="h-3.5 w-3.5 text-primary" fill="currentColor" />
        <span className="text-xs font-semibold text-primary">Pro</span>
      </span>
    );
  }

  const trialDays = entitlement?.tier === "trial" ? entitlement.daysLeftInTrial : null;
  const label = trialDays != null ? `Trial · ${trialDays}d` : "Upgrade";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-primary/15 to-primary/5 border border-primary/40 pressable"
        aria-label="Upgrade to Pro"
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" fill="currentColor" />
        <span className="text-xs font-semibold text-primary">{label}</span>
      </button>
      <UpgradeSheet open={open} onOpenChange={setOpen} reason="feature" />
    </>
  );
};