import { supabase } from "@/integrations/supabase/client";

export const PUBLIC_VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

const urlBase64ToUint8 = (b64: string) => {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
};

export const enablePush = async (userId: string) => {
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
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
};