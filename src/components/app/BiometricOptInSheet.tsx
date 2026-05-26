import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { Fingerprint, ScanFace } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { haptics } from "@/lib/haptics";

/** Per-user "I've already asked about App Lock once" flag. Keyed by uid so a
 *  household account swap re-asks fresh, but the same user is never nagged
 *  twice on the same device. */
const promptedFlag = (uid: string) => `daydraft.applock.prompted.${uid}`;
const APPLOCK_KEY = "daydraft.applock";

/** Apple BiometryType constants from `@capgo/capacitor-native-biometric`:
 *  1 = Touch ID, 2 = Face ID, 3 = Fingerprint (Android), 4 = Face Authentication (Android). */
const BIOMETRY_FACE_ID = 2;
const BIOMETRY_FACE_AUTH_ANDROID = 4;

/**
 * One-time post-auth opt-in for biometric App Lock.
 *
 * Self-gating: the component is always mounted near the app root, but the
 * sheet opens only when ALL of these are true:
 *   1. Running on a native platform (iOS / Android)
 *   2. Biometric hardware is available + enrolled
 *   3. There IS a logged-in user
 *   4. The user has finished onboarding (so we don't interrupt that flow)
 *   5. App Lock isn't already enabled
 *   6. We haven't already asked this user
 *
 * Tapping "Not now" sets the prompt flag so we don't ask again — they can
 * still enable App Lock manually from Settings later.
 */
export function BiometricOptInSheet() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(false);
  const [isFaceId, setIsFaceId] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!user?.id) return;
    if (profile?.onboarded !== true) return;

    let cancelledTimer: number | null = null;
    try {
      if (localStorage.getItem(promptedFlag(user.id)) === "true") return;
      if (localStorage.getItem(APPLOCK_KEY) === "true") return;
    } catch {
      /* localStorage unavailable — fall through and let the biometric check decide */
    }

    NativeBiometric.isAvailable()
      .then((res) => {
        if (!res.isAvailable) return;
        setSupported(true);
        // Use Face ID branding when the device actually supports it; otherwise
        // (Touch ID, Android fingerprint) lean on the fingerprint visuals.
        const platform = Capacitor.getPlatform();
        const isFace =
          (platform === "ios" && res.biometryType === BIOMETRY_FACE_ID) ||
          (platform === "android" && res.biometryType === BIOMETRY_FACE_AUTH_ANDROID);
        setIsFaceId(isFace);
        // Tiny delay so we don't blast the prompt during the auth → home
        // navigation animation — it lands smoothly after Home has settled.
        cancelledTimer = window.setTimeout(() => setOpen(true), 700);
      })
      .catch(() => {
        /* No biometry / permission denied — never open */
      });

    return () => {
      if (cancelledTimer !== null) window.clearTimeout(cancelledTimer);
    };
  }, [user?.id, profile?.onboarded]);

  const markPrompted = () => {
    if (!user?.id) return;
    try {
      localStorage.setItem(promptedFlag(user.id), "true");
    } catch {
      /* ignore */
    }
  };

  const handleEnable = async () => {
    if (enrolling) return;
    setEnrolling(true);
    try {
      // Test-verify the user's biometric before we actually flip the switch.
      // This both confirms the system prompt works AND records a moment of
      // consent — if the user can't pass this, App Lock would just lock them
      // out, so we want to know now.
      await NativeBiometric.verifyIdentity({
        reason: isFaceId ? "Confirm Face ID" : "Confirm Fingerprint",
        title: "Enable App Lock",
        subtitle: isFaceId
          ? "Use Face ID to unlock DayDraft"
          : "Use your fingerprint to unlock DayDraft",
        description: "Keep your daily plans private.",
      });
      try {
        localStorage.setItem(APPLOCK_KEY, "true");
      } catch {
        /* ignore */
      }
      haptics.notify("success");
      toast.success(isFaceId ? "Face ID enabled" : "Fingerprint unlock enabled");
    } catch {
      // User cancelled or failed verification — don't enable, but don't nag again.
    }
    markPrompted();
    setEnrolling(false);
    setOpen(false);
  };

  const handleNotNow = () => {
    haptics.tap();
    markPrompted();
    setOpen(false);
  };

  // Don't even mount sheet markup if biometry isn't supported — avoids
  // a hidden Radix portal in the DOM for no reason.
  if (!supported) return null;

  const Icon = isFaceId ? ScanFace : Fingerprint;
  const headline = isFaceId ? "Unlock with Face ID" : "Unlock with Fingerprint";
  const primaryCta = isFaceId ? "Enable Face ID" : "Enable Fingerprint";

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) handleNotNow();
      }}
    >
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] border-border/45 bg-popover p-0 flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-6 pt-10 pb-8 flex flex-col items-center text-center">
          
          {/* Beautiful Biometric Animation (2D Embossed) */}
          <div className="relative h-40 w-40 flex items-center justify-center mb-6">
            {/* Pulsing ambient glow */}
            <motion.div
              animate={{ 
                scale: [1, 1.05, 1],
                opacity: [0.2, 0.4, 0.2],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 rounded-full bg-primary/40 blur-[32px]" 
            />
            
            {/* Inner ring (Physical 3D Glass block using purely 2D shadows/gradients) */}
            <div className="relative z-10 h-36 w-36 rounded-[40px] bg-gradient-to-br from-background/90 to-background/50 backdrop-blur-xl border border-white/20 dark:border-white/5 flex items-center justify-center overflow-hidden shadow-[0_24px_48px_-12px_rgba(0,0,0,0.4),inset_0_4px_8px_rgba(255,255,255,0.25),inset_0_-8px_16px_rgba(0,0,0,0.25),inset_0_0_24px_hsl(var(--primary)/0.15)]">
              
              {/* Scanning line animation */}
              <motion.div
                animate={{ y: ["-100%", "100%", "-100%"] }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 w-full h-[6px] bg-primary/90 blur-[2px] shadow-[0_0_24px_hsl(var(--primary))]"
              />
              
              {/* The Biometric Icon with Heavy Extrusion Shadows */}
              <motion.div
                animate={{ y: [-3, 3, -3] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="relative z-20"
              >
                <Icon 
                  className="h-20 w-20 text-primary drop-shadow-[0_8px_10px_rgba(0,0,0,0.5)] drop-shadow-[0_-1px_2px_rgba(255,255,255,0.4)] drop-shadow-[0_0_32px_hsl(var(--primary)/0.6)]" 
                  strokeWidth={1.5} 
                />
              </motion.div>
            </div>
          </div>

          <h2 className="text-[26px] font-display font-bold tracking-tight text-foreground/95 mb-1.5">
            {headline}
          </h2>
          <p className="text-[14px] text-secondary-fg/70 leading-relaxed max-w-[280px] mb-8">
            Keep your daily plans private with a single tap.
          </p>

          <button
            type="button"
            onClick={handleEnable}
            disabled={enrolling}
            className="w-full max-w-[320px] h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable font-semibold text-[16px] shadow-[0_12px_32px_-8px_hsl(var(--primary)/0.6)] disabled:opacity-60 transition-opacity"
          >
            {enrolling ? "Verifying…" : primaryCta}
          </button>
          
          <button
            type="button"
            onClick={handleNotNow}
            className="mt-2 w-full max-w-[320px] h-[48px] rounded-[18px] text-secondary-fg/80 hover:text-foreground/95 hover:bg-soft/40 pressable font-medium text-[15px] transition-colors"
          >
            Maybe later
          </button>
        </div>
        <div
          className="shrink-0"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
        />
      </SheetContent>
    </Sheet>
  );
}
