import { ArrowRight, TriangleAlert } from "lucide-react";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { haptics } from "@/lib/haptics";

export type CurrencyMismatch = {
  catId: string;
  catName: string;
  catColor: string;
  trackerCurrency: string;
  reportCurrency: string;
};

/**
 * Pre-export interruption when the user's chosen report currency for one or
 * more categories doesn't match the tracker currency that owns the payment
 * details. The PDF would otherwise show "earned in EUR" alongside an IBAN
 * that was set up to receive USD — confusing for the recipient.
 *
 * Two outcomes:
 *   • [Update payment details] → caller opens a PaymentMethodFields sheet
 *     pre-filled with each mismatched category in turn.
 *   • [Export in original currency] → caller reverts overrides to tracker
 *     currencies and proceeds with export using the original tracked currency.
 */
export function ReportCurrencyMismatchDialog({
  open,
  mismatches,
  onCancel,
  onExportOriginal,
  onUpdatePaymentDetails,
}: {
  open: boolean;
  mismatches: CurrencyMismatch[];
  onCancel: () => void;
  onExportOriginal: () => void;
  onUpdatePaymentDetails: () => void;
}) {
  const count = mismatches.length;

  const uniqueTrackerCurrencies = [...new Set(mismatches.map((m) => m.trackerCurrency))];
  const exportOriginalLabel =
    uniqueTrackerCurrencies.length === 1
      ? `Export in ${uniqueTrackerCurrencies[0]}`
      : "Export in original currencies";

  const handleUpdatePaymentDetails = () => {
    haptics.notify("warning");
    onUpdatePaymentDetails();
  };

  const handleExportOriginal = () => {
    haptics.tap();
    onExportOriginal();
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover p-0 flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        <SheetTitle className="sr-only">Currency mismatch</SheetTitle>

        <div className="px-5 pt-8 pb-6 flex flex-col">
          {/* Icon */}
          <div className="flex items-center justify-center mb-5">
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 22, delay: 0.05 }}
              className="h-[60px] w-[60px] rounded-[20px] flex items-center justify-center bg-amber-500/12 dark:bg-amber-400/10 border border-amber-500/20 dark:border-amber-400/15"
              style={{ boxShadow: "0 8px 24px -4px hsl(38 92% 50% / 0.25)" }}
            >
              <TriangleAlert className="h-7 w-7 text-amber-500 dark:text-amber-400" strokeWidth={1.75} />
            </motion.div>
          </div>

          {/* Title + description */}
          <h2 className="font-display text-[20px] font-bold tracking-tight text-foreground/95 text-center mb-1.5">
            Payment details out of sync
          </h2>
          <p className="text-[13px] text-secondary-fg/75 leading-relaxed text-center mb-5 max-w-[300px] mx-auto">
            {count === 1
              ? "One category's report currency doesn't match its payment details."
              : `${count} categories have a report currency that doesn't match their payment details.`}
          </p>

          {/* Mismatch list */}
          <div className="rounded-2xl border border-border/60 bg-background/40 backdrop-blur-sm overflow-hidden mb-5">
            {mismatches.map((m, i) => (
              <div
                key={m.catId}
                className={`flex items-center gap-3 px-4 py-3 ${i < mismatches.length - 1 ? "border-b border-border/50" : ""}`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: m.catColor }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-foreground truncate">
                  {m.catName}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] font-semibold font-mono text-secondary-fg/65 bg-secondary/30 px-1.5 py-0.5 rounded-md">
                    {m.trackerCurrency}
                  </span>
                  <ArrowRight className="h-3 w-3 text-secondary-fg/35" />
                  <span className="text-[11px] font-semibold font-mono text-amber-500 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-md">
                    {m.reportCurrency}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <button
            type="button"
            onClick={handleUpdatePaymentDetails}
            className="w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground hover:bg-primary/92 pressable font-semibold text-[15px] cta-glow transition-opacity mb-2"
          >
            Update payment details
          </button>
          <button
            type="button"
            onClick={handleExportOriginal}
            className="w-full h-[46px] rounded-[16px] border border-border/70 bg-card/30 text-[14px] font-medium text-foreground/75 hover:text-foreground hover:bg-card/60 pressable transition-colors mb-1"
          >
            {exportOriginalLabel}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="w-full h-[42px] rounded-[16px] text-[13px] text-secondary-fg/60 hover:text-foreground/80 hover:bg-foreground/[0.04] pressable transition-colors"
          >
            Cancel
          </button>
        </div>

        <div
          className="shrink-0"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
        />
      </SheetContent>
    </Sheet>
  );
}
