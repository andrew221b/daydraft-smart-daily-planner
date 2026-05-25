import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { requestLocalNotificationPermissions, clearLocalNotifications } from "./localNotifications";

export const PUBLIC_VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

/**
 * Diagnose why notifications aren't available so we can give the user a useful
 * next step instead of a dead-end "not supported" message.
 *
 * Returns:
 *   - "ok"               — web push is wired up and ready to enable
 *   - "needs-install"    — iOS Safari, needs to install as PWA before web push works
 *   - "in-app-browser"   — inside an embedded WebView (lovable.dev preview, social apps)
 *   - "browser-no-support" — browser genuinely doesn't expose PushManager / SW
 *   - "not-configured"   — PushManager is there but the VAPID key isn't wired
 *   - "native-not-wired" — running inside the Capacitor native iOS / Android app,
 *                          but we haven't installed @capacitor/push-notifications yet.
 *                          The native channel uses APNs / FCM, not Web Push.
 */
export type PushAvailability =
  | "ok"
  | "needs-install"
  | "in-app-browser"
  | "browser-no-support"
  | "not-configured";

export const pushAvailability = (): PushAvailability => {
  if (typeof window === "undefined") return "browser-no-support";
  if (Capacitor.isNativePlatform()) return "ok";
  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua);
  // iOS Safari requires the app to be installed to the home screen (standalone)
  // before it exposes a working PushManager. Lovable / in-app browsers never
  // expose it at all.
  const standalone =
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const inAppBrowserHints = /(Instagram|FBAN|FBAV|Line\/|MicroMessenger|Twitter|TikTok|Lovable)/i.test(ua);
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    if (isIos && !standalone) return "needs-install";
    if (inAppBrowserHints) return "in-app-browser";
    return "browser-no-support";
  }
  if (!PUBLIC_VAPID_KEY) return "not-configured";
  return "ok";
};

export const pushAvailabilityCopy: Record<PushAvailability, { title: string; body: string }> = {
  ok: { title: "Notifications ready", body: "Turn on to get gentle nudges as your day unfolds." },
  "needs-install": {
    title: "Install DayDraft first",
    body: "iOS only sends notifications from installed apps. Tap Share → Add to Home Screen, then open DayDraft from your home screen to enable.",
  },
  "in-app-browser": {
    title: "Open in your browser",
    body: "Notifications don't work inside in-app browsers. Tap the menu and choose \"Open in Safari / Chrome\" to enable.",
  },
  "browser-no-support": {
    title: "Notifications not supported",
    body: "This browser doesn't expose web push. Try the latest Safari, Chrome, or Edge.",
  },
  "not-configured": {
    title: "Coming soon",
    body: "Push isn't wired up in this preview yet. Your reminders still fire while the app is open.",
  },

};

const urlBase64ToUint8 = (b64: string) => {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
};

export const enablePush = async (userId: string) => {
  if (Capacitor.isNativePlatform()) {
    const granted = await requestLocalNotificationPermissions();
    if (!granted) throw new Error("Notifications permission denied");
    // Native Push (FCM/APNs) is not yet wired, but we return to let Settings update the flag.
    return;
  }

  if (!pushSupported()) throw new Error("Push not supported on this browser");
  if (!PUBLIC_VAPID_KEY) throw new Error("Push isn't configured yet — VAPID key missing");
  const reg = await navigator.serviceWorker.register("/sw.js");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications permission denied");
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8(PUBLIC_VAPID_KEY),
  });
  const json: any = sub.toJSON();
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: userId,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      } as any,
      { onConflict: "user_id,endpoint", ignoreDuplicates: false }
    );
  if (error) throw error;
};

export const disablePush = async (userId: string) => {
  if (Capacitor.isNativePlatform()) {
    await clearLocalNotifications();
    return;
  }

  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
};