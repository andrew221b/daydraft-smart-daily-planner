import { useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { Fingerprint, ScanFace } from "lucide-react";

/** Background-lock grace period. Brief inactivity events (Face ID system
 *  prompt, Control Center pull-down, notification banner expand, even an
 *  incoming call's status bar) all fire `isActive: false` followed by
 *  `isActive: true` within sub-second timing. We schedule a lock on each
 *  inactive event and cancel it if active arrives before the timer fires.
 *  Only "real" backgrounding (home swipe / app switch) keeps the app
 *  inactive long enough to actually lock. */
const BACKGROUND_LOCK_DELAY_MS = 1500;

export function AppLock({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [supported, setSupported] = useState(false);
  // Mutex for our own biometric prompt — prevents stacking verifyIdentity()
  // calls if appStateChange events somehow reach the listener while the
  // prompt is mid-flight.
  const authInFlightRef = useRef(false);
  // Handle for the pending background-lock timer. Cancellable when iOS
  // bounces back to active before the grace period expires (which it does
  // for every system-prompt-style inactive event).
  const lockTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setChecking(false);
      return;
    }

    NativeBiometric.isAvailable()
      .then((res) => {
        setSupported(res.isAvailable);
        checkLock();
      })
      .catch(() => {
        setSupported(false);
        setChecking(false);
      });

    const listener = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      // While our own biometric prompt is on screen, ignore everything.
      if (authInFlightRef.current) return;

      if (isActive) {
        // App came (back) to foreground. Cancel any pending lock — the
        // inactive interval that scheduled it was too brief to count as
        // a real background event (Face ID UI, Control Center, etc).
        if (lockTimerRef.current !== null) {
          window.clearTimeout(lockTimerRef.current);
          lockTimerRef.current = null;
        }
        // Don't proactively re-auth here. If the lock timer DID fire while
        // we were "away", the lockscreen is already up and the user will
        // tap Unlock. If it didn't, the app stays unlocked — which is
        // exactly what we want for sub-second blips.
        return;
      }

      // isActive: false — schedule a delayed lock. If the user comes back
      // within BACKGROUND_LOCK_DELAY_MS, we cancel it above. Only sustained
      // inactivity actually flips us to locked.
      if (lockTimerRef.current !== null) return; // already scheduled
      if (localStorage.getItem("daydraft.applock") !== "true") return;
      lockTimerRef.current = window.setTimeout(() => {
        lockTimerRef.current = null;
        setLocked(true);
      }, BACKGROUND_LOCK_DELAY_MS);
    });
    return () => {
      listener.then((l) => l.remove());
      if (lockTimerRef.current !== null) {
        window.clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkLock = async () => {
    if (localStorage.getItem("daydraft.applock") !== "true") {
      setLocked(false);
      setChecking(false);
      return;
    }
    setLocked(true);
    setChecking(false);
    authenticate();
  };

  const authenticate = async () => {
    // Don't stack prompts — if one is already on screen, return.
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    try {
      await NativeBiometric.verifyIdentity({
        reason: "Unlock DayDraft",
        title: "App Lock",
        subtitle: "Use Face ID or Fingerprint to unlock",
        description: "Keep your daily plans secure.",
      });
      setLocked(false);
      // Also cancel any pending background-lock timer that might fire and
      // re-lock us right after we just unlocked.
      if (lockTimerRef.current !== null) {
        window.clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    } catch {
      // User cancelled or failed. App remains locked; the visible Unlock
      // button lets them retry.
    } finally {
      // Release the mutex on the next tick. Doing it synchronously can
      // race with the appStateChange event iOS fires when the prompt
      // closes — letting the macrotask drain first guarantees the
      // listener sees authInFlightRef === true for that event.
      window.setTimeout(() => {
        authInFlightRef.current = false;
      }, 250);
    }
  };

  if (checking) {
    // Prevent flickering while we check NativeBiometric.isAvailable()
    return <div className="fixed inset-0 bg-background z-[9999]" />;
  }

  return (
    <>
      {locked && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background px-6 animate-in fade-in zoom-in duration-200">
          {Capacitor.getPlatform() === "android" ? (
            <div className="relative h-24 w-24 flex items-center justify-center mb-8">
              <div className="absolute inset-0 rounded-full bg-primary/30 blur-2xl animate-pulse" />
              <div className="relative z-10 h-20 w-20 rounded-full bg-background border border-primary/30 flex items-center justify-center text-primary shadow-[0_0_24px_rgba(var(--primary-rgb),0.4),inset_0_2px_4px_rgba(255,255,255,0.1),inset_0_-4px_8px_rgba(var(--primary-rgb),0.3)]">
                <Fingerprint className="h-10 w-10 drop-shadow-[0_2px_8px_rgba(var(--primary-rgb),0.5)]" />
              </div>
            </div>
          ) : (
            <div className="h-20 w-20 rounded-3xl bg-secondary/30 border border-soft/50 flex items-center justify-center text-foreground mb-8 backdrop-blur-md shadow-sm">
              <ScanFace className="h-11 w-11 stroke-[1.5]" />
            </div>
          )}
          <h2 className="text-2xl font-display font-semibold mb-2 text-foreground text-balance text-center">App Locked</h2>
          <p className="text-[14px] text-secondary-fg text-center max-w-xs mb-10 leading-relaxed">
            Verify your identity to view your schedule and tasks.
          </p>
          <button
            onClick={authenticate}
            className="w-full max-w-[280px] h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable font-medium text-[16px] shadow-card btn-volumetric"
          >
            {Capacitor.getPlatform() === "android" ? "Unlock with Fingerprint" : "Unlock with Face ID"}
          </button>
        </div>
      )}
      {children}
    </>
  );
}
