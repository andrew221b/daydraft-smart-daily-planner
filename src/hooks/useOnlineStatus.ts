import { useEffect, useState } from "react";
import { listQueuedWrites } from "@/lib/idbCache";

/**
 * Live online/offline status + offline write-queue size.
 *
 * `online` mirrors `navigator.onLine`. It's not perfect — the browser
 * only fires `online`/`offline` for raw network connectivity, not for
 * captive portals or unreachable Supabase — but it covers the common
 * "subway/plane/elevator" cases that actually frustrate users.
 *
 * `queuedWrites` polls IndexedDB at a slow cadence (every 3s, only
 * while offline OR right after coming back online). The poll exists
 * because `idbCache` doesn't emit change events; if it grows one in
 * the future we can swap this for a subscription.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [queuedWrites, setQueuedWrites] = useState<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const queue = await listQueuedWrites();
        if (!cancelled) setQueuedWrites(queue.length);
      } catch {
        if (!cancelled) setQueuedWrites(0);
      }
    };

    // Poll while offline. When we come back online we also keep
    // polling for a short window so the banner can show "syncing N
    // changes…" as the drain runs, then disappear.
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    void tick();
    if (!online) {
      timer = window.setInterval(tick, 3000);
    } else {
      // Online — poll briefly while the drainer catches up.
      let n = 0;
      timer = window.setInterval(() => {
        void tick();
        n += 1;
        if (n >= 6) stop(); // ~18s total
      }, 3000);
    }

    return () => {
      cancelled = true;
      stop();
    };
  }, [online]);

  return { online, queuedWrites };
}
