import { toast } from "sonner";

/**
 * Service worker update flow.
 *
 * Default behaviour without this: a new SW installs, the user keeps running
 * the old JS for the rest of the session, and only the next *cold* tab open
 * sees the new code. That's how "stuck on old version" bugs happen after a
 * deploy — the user reports something we already shipped a fix for.
 *
 * With this wired up:
 *   1. Register the SW.
 *   2. On `updatefound`, watch the installing worker.
 *   3. When it reaches `installed` AND there's already a controller
 *      (= not first install on this device), show a non-intrusive toast.
 *   4. If the user taps "Reload", tell the new SW to skipWaiting and reload
 *      the page when it takes over (`controllerchange`).
 *
 * The matching sw.js change is: stop calling `self.skipWaiting()` in the
 * install handler. Without that, the user is in charge of when the new
 * version takes over, which means we don't yank state out from under them
 * mid-flow (e.g., while a sheet is open).
 */

let toastShown = false;
let reloading = false;

function promptReload(worker: ServiceWorker) {
  if (toastShown) return;
  toastShown = true;
  toast("New version available", {
    description: "Reload to get the latest fixes.",
    action: {
      label: "Reload",
      onClick: () => {
        try { worker.postMessage({ type: "SKIP_WAITING" }); } catch { /* ignore */ }
      },
    },
    duration: Infinity,
  });
}

function attachUpdateWatcher(registration: ServiceWorkerRegistration) {
  // If a worker is already waiting (e.g., the page was opened with an
  // update already installed in the background), prompt immediately.
  if (registration.waiting && navigator.serviceWorker.controller) {
    promptReload(registration.waiting);
  }

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (
        installing.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        promptReload(installing);
      }
    });
  });

  // When the new SW takes control after the user accepts, reload once so
  // the page picks up the new JS. Guarded by `reloading` so we don't loop
  // if the event fires more than once.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

export function registerServiceWorker(): void {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !import.meta.env.PROD
  ) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => attachUpdateWatcher(registration))
      .catch((e) => console.warn("[sw] register failed", e));
  });

  // Periodically check for updates while the tab stays open — without this
  // a long-lived tab never notices new deploys. 30 min cadence is gentle.
  setInterval(() => {
    navigator.serviceWorker.getRegistration().then((r) => r?.update().catch(() => {}));
  }, 30 * 60_000);
}
