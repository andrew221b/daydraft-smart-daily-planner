import { AnimatePresence, motion } from "framer-motion";
import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { haptics } from "@/lib/haptics";

/**
 * Slim status bar that slides in below the iOS status-bar / safe area
 * when the device is offline, or when an offline write queue still
 * has rows to drain after coming back online.
 *
 * Mounted once at the Shell level so every screen gets the same
 * treatment without each page having to re-implement the listener.
 *
 * Visual states:
 *   - offline                       → amber, CloudOff, "No connection…"
 *   - online + queue pending        → primary tint, animated RefreshCw,
 *                                     "Syncing N changes…"
 *   - online + queue empty          → component renders null
 *
 * Z-index: 35 — above page content, below the tab bar (z-40) and any
 * Radix sheets / modals (z-50). When a sheet is open the banner is
 * intentionally hidden behind it; the user is mid-interaction and
 * doesn't need a competing status pill in their way. The banner
 * reappears when the sheet closes.
 */
export function OfflineBanner() {
  const { online, queuedWrites } = useOnlineStatus();
  const showSyncing = online && queuedWrites > 0;
  const showOffline = !online;
  const visible = showOffline || showSyncing;

  // Subtle haptic when transitioning offline ↔ online. Skipped on the
  // very first render so a cold launch on a flaky network doesn't buzz
  // the device immediately.
  const prevOnlineRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevOnlineRef.current === null) {
      prevOnlineRef.current = online;
      return;
    }
    if (prevOnlineRef.current !== online) {
      haptics.notify(online ? "success" : "warning");
      prevOnlineRef.current = online;
    }
  }, [online]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -32, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -32, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className="pointer-events-none fixed left-0 right-0 z-[35] flex justify-center px-4"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 6px)" }}
          role="status"
          aria-live="polite"
        >
          <div
            className={[
              "pointer-events-auto inline-flex max-w-[92vw] items-center gap-2 rounded-full border px-3.5 py-1.5 backdrop-blur-md",
              showOffline
                ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200 shadow-[0_8px_24px_-12px_hsl(40_85%_55%/0.55)]"
                : "border-primary/35 bg-primary/12 text-primary shadow-[0_8px_24px_-12px_hsl(var(--primary)/0.55)]",
            ].join(" ")}
            style={{ WebkitBackdropFilter: "blur(12px)" }}
          >
            {showOffline ? (
              <CloudOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2.4} />
            )}
            <span className="text-[12px] font-semibold tracking-tight truncate">
              {showOffline
                ? (queuedWrites > 0
                  ? `Offline — ${queuedWrites} change${queuedWrites === 1 ? "" : "s"} pending`
                  : "Offline — changes will sync later")
                : `Syncing ${queuedWrites} change${queuedWrites === 1 ? "" : "s"}…`}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
