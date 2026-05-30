import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Fingerprint, ScanFace, ShieldCheck, CreditCard, FileDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { haptics } from "@/lib/haptics";
import {
  getBiometricInfo,
  setGatePref,
  verifyBiometric,
  type BiometricInfo,
} from "@/lib/biometricGate";

export type GateFeature = "billing" | "export";

type Props = {
  open: boolean;
  onClose: () => void;
  feature: GateFeature;
  /** Called after the user makes a choice. granted = true means proceed. */
  onResult: (granted: boolean) => void;
};

const COPY: Record<GateFeature, { icon: React.ElementType; headline: string; body: string; verifyReason: string }> = {
  billing: {
    icon: CreditCard,
    headline: "Payment details protected",
    body: "Your billing info — IBAN, wallets, payout links — is locked behind biometrics. You'll verify once each time you open it.",
    verifyReason: "View saved payment details",
  },
  export: {
    icon: FileDown,
    headline: "Report download protected",
    body: "Your time-tracking data is personal. Verify your identity before downloading.",
    verifyReason: "Export time tracking report",
  },
};

/**
 * First-time opt-in sheet shown before a biometric gate fires.
 *
 * The user sees this ONCE (the gate pref is written on their choice). After
 * that, verifyBiometric() fires the system prompt directly (no sheet).
 *
 * Choosing "Not now" writes pref = "off" and grants access immediately
 * (fail-open philosophy — we never lock users out of their own data).
 */
export function BiometricGateSheet({ open, onClose, feature, onResult }: Props) {
  const [bioInfo, setBioInfo] = useState<BiometricInfo | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (open && !bioInfo) {
      getBiometricInfo().then(setBioInfo);
    }
  }, [open, bioInfo]);

  // If biometrics aren't available, skip the sheet entirely — just grant access.
  useEffect(() => {
    if (!open) return;
    if (bioInfo && !bioInfo.available) {
      setGatePref("off");
      onResult(true);
      onClose();
    }
  }, [open, bioInfo, onResult, onClose]);

  const copy = COPY[feature];
  const isFace = bioInfo?.isFace ?? false;
  const BiometricIcon = isFace ? ScanFace : Fingerprint;
  const biometricLabel = isFace
    ? (Capacitor.getPlatform() === "android" ? "Face Authentication" : "Face ID")
    : (Capacitor.getPlatform() === "android" ? "Fingerprint" : "Touch ID");

  const handleEnable = async () => {
    if (verifying) return;
    setVerifying(true);
    haptics.tap();
    try {
      setGatePref("on");
      const ok = await verifyBiometric(copy.verifyReason);
      if (ok) {
        haptics.notify("success");
        onResult(true);
        onClose();
      } else {
        // Verification failed / cancelled — pref stays "on", sheet closes,
        // caller sees granted=false so the data stays hidden.
        onResult(false);
        onClose();
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleSkip = () => {
    haptics.tap();
    setGatePref("off");
    onResult(true); // fail-open
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleSkip(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] border-border/45 bg-popover p-0 flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetTitle className="sr-only">Protect with biometrics</SheetTitle>

        <div className="px-6 pt-10 pb-4 flex flex-col items-center text-center">

          {/* ── Animated biometric visual ─────────────────────────────── */}
          <div className="relative h-40 w-40 flex items-center justify-center mb-6">
            {/* Ambient glow */}
            <motion.div
              animate={{ scale: [1, 1.06, 1], opacity: [0.18, 0.38, 0.18] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 rounded-full bg-primary/40 blur-[32px]"
            />

            {/* Glass card */}
            <div className="relative z-10 h-36 w-36 rounded-[40px] flex items-center justify-center overflow-hidden"
              style={{
                background: "linear-gradient(145deg, hsl(var(--background)/0.92) 0%, hsl(var(--background)/0.55) 100%)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.18)",
                boxShadow: "0 24px 48px -12px rgba(0,0,0,0.4), inset 0 4px 8px rgba(255,255,255,0.22), inset 0 -8px 16px rgba(0,0,0,0.22), inset 0 0 24px hsl(var(--primary)/0.13)",
              }}>

              {/* Scanning line */}
              <motion.div
                initial={{ y: -72 }}
                animate={{ y: [-72, 138, -72] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
                className="absolute left-0 right-0 top-0 h-[3px] bg-gradient-to-r from-transparent via-primary to-transparent blur-[1px]"
                style={{ boxShadow: "0 0 10px 3px hsl(var(--primary)/0.55), 0 0 22px 5px hsl(var(--primary)/0.22)" }}
              />

              {/* Face scan corner brackets — only for Face ID */}
              <AnimatePresence>
                {isFace && (
                  <>
                    {[
                      { top: 12, left: 12,  rotate: 0   },
                      { top: 12, right: 12, rotate: 90  },
                      { bottom: 12, right: 12, rotate: 180 },
                      { bottom: 12, left: 12,  rotate: 270 },
                    ].map((pos, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: [0.5, 1, 0.5], scale: 1 }}
                        transition={{ duration: 2, repeat: Infinity, delay: i * 0.15 }}
                        className="absolute w-5 h-5"
                        style={{
                          ...pos,
                          border: "2px solid hsl(var(--primary)/0.8)",
                          borderRadius: "3px",
                          clipPath: i === 0 ? "polygon(0 0, 55% 0, 55% 18%, 18% 18%, 18% 55%, 0 55%)"
                                  : i === 1 ? "polygon(45% 0, 100% 0, 100% 55%, 82% 55%, 82% 18%, 45% 18%)"
                                  : i === 2 ? "polygon(45% 45%, 82% 45%, 82% 82%, 100% 82%, 100% 100%, 45% 100%)"
                                  : "polygon(0 82%, 18% 82%, 18% 45%, 55% 45%, 55% 100%, 0 100%)",
                        }}
                      />
                    ))}
                  </>
                )}
              </AnimatePresence>

              {/* Main biometric icon */}
              <motion.div
                animate={{ y: [-3, 3, -3], scale: [1, 1.04, 1] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="relative z-20"
              >
                <BiometricIcon
                  className="h-20 w-20 text-primary"
                  strokeWidth={1.4}
                  style={{
                    filter: "drop-shadow(0 8px 10px rgba(0,0,0,0.5)) drop-shadow(0 0 28px hsl(var(--primary)/0.55))",
                  }}
                />
              </motion.div>
            </div>
          </div>

          {/* ── Feature context badge ──────────────────────────────────── */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 mb-4">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-semibold text-primary uppercase tracking-wide">
              {biometricLabel} Protection
            </span>
          </div>

          <h2 className="text-[24px] font-display font-bold tracking-tight text-foreground/95 mb-2">
            {copy.headline}
          </h2>
          <p className="text-[14px] text-secondary-fg/72 leading-relaxed max-w-[290px] mb-8">
            {copy.body}
          </p>

          {/* ── CTAs ──────────────────────────────────────────────────── */}
          <button
            type="button"
            onClick={handleEnable}
            disabled={verifying}
            className="w-full max-w-[320px] h-[54px] rounded-[18px] bg-primary text-primary-foreground pressable font-semibold text-[16px] shadow-[0_12px_32px_-8px_hsl(var(--primary)/0.6)] disabled:opacity-60 transition-opacity"
          >
            {verifying ? "Verifying…" : `Enable ${biometricLabel}`}
          </button>

          <button
            type="button"
            onClick={handleSkip}
            className="mt-2.5 w-full max-w-[320px] h-[46px] rounded-[18px] text-secondary-fg/75 hover:text-foreground hover:bg-foreground/[0.05] pressable font-medium text-[14px] transition-colors"
          >
            Access without protection
          </button>
        </div>

        <div className="shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }} />
      </SheetContent>
    </Sheet>
  );
}
