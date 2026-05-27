import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { resolveDeepLink } from "@/lib/deepLinks";

/**
 * Native push registration (APNs on iOS, FCM on Android).
 *
 * Lifecycle:
 *   1. App boots and the user is authenticated → `registerNativePush()`
 *      is called once. It requests permission (no-op if already
 *      granted/denied), registers with APNs/FCM, and writes the
 *      resulting token to `push_tokens` so the server can target it.
 *   2. iOS / Android may rotate the token at any later point — the
 *      same listener catches the new value and upserts it.
 *   3. The app receives a push while in the foreground → we surface it
 *      as an in-app event (handled by callers, not here).
 *   4. The user taps a push from the lock-screen → `pushNotificationActionPerformed`
 *      fires with the notification's `data.deepLink` field, and we
 *      navigate via the deep-link bridge.
 *
 * This module is a no-op on web — web push lives in `lib/push.ts` and
 * uses VAPID + the Service Worker. Calling `registerNativePush()` on
 * the web simply returns without side effects.
 */

let attached = false;
let lastToken: string | null = null;

type DeepLinkCallback = (path: string) => void;
let deepLinkCallback: DeepLinkCallback | null = null;

export function setPushDeepLinkHandler(fn: DeepLinkCallback | null): void {
  deepLinkCallback = fn;
}

export async function registerNativePush(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!userId) return;

  try {
    const [{ PushNotifications }, { Device }] = await Promise.all([
      import("@capacitor/push-notifications"),
      import("@capacitor/device"),
    ]);

    const perm = await PushNotifications.checkPermissions();
    let status = perm.receive;
    if (status === "prompt" || status === "prompt-with-rationale") {
      const req = await PushNotifications.requestPermissions();
      status = req.receive;
    }
    if (status !== "granted") return;

    if (!attached) {
      attached = true;

      PushNotifications.addListener("registration", async (token) => {
        const value = token?.value;
        if (!value || value === lastToken) return;
        lastToken = value;
        try {
          const deviceInfo = await Device.getInfo();
          const deviceIdResult = await Device.getId();
          const platform = deviceInfo.platform === "ios" ? "ios" : "android";
          await supabase.from("push_tokens").upsert(
            {
              user_id: userId,
              platform,
              token: value,
              device_id: deviceIdResult.identifier ?? null,
              device_model: deviceInfo.model ?? null,
              enabled: true,
            } as never,
            { onConflict: "user_id,token" },
          );
        } catch (e) {
          console.warn("[nativePush] token persist failed", e);
        }
      });

      PushNotifications.addListener("registrationError", (err) => {
        console.warn("[nativePush] registration error", err);
      });

      PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const data = action?.notification?.data as { deepLink?: string } | undefined;
        const link = data?.deepLink;
        if (!link) return;
        const route = resolveDeepLink(link);
        if (route && deepLinkCallback) deepLinkCallback(route);
      });
    }

    await PushNotifications.register();
  } catch (e) {
    console.warn("[nativePush] register failed", e);
  }
}

/** Remove the token for the current device — call on sign-out so the
 *  server stops sending pushes to this install. */
export async function unregisterNativePush(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || !userId || !lastToken) return;
  try {
    await supabase
      .from("push_tokens")
      .delete()
      .eq("user_id", userId)
      .eq("token", lastToken);
    lastToken = null;
  } catch (e) {
    console.warn("[nativePush] unregister failed", e);
  }
}
