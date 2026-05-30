/**
 * Dual-channel push dispatch + once-per-day dedup.
 *
 * Why this exists: the cron nudges historically only spoke Web Push
 * (`push_subscriptions` + VAPID). The native iOS/Android app registers
 * APNs/FCM tokens in `push_tokens`, so those users received NOTHING from the
 * daily/overrun crons. This module fans a single nudge out to BOTH channels
 * from one call, retires dead tokens/subscriptions on the spot, and gates
 * each (user, kind, day) to a single send so overlapping cron windows can't
 * double-fire.
 *
 * The same nudge carries two link shapes because the two channels resolve
 * taps differently:
 *   • Web Push     → the service worker reads `payload.url` ("/today")
 *   • Native Push  → the client reads `data.deepLink` ("daydraft://today")
 *                    and runs it through resolveDeepLink()
 * We derive the native scheme URL from the web path so callers pass one path.
 */

import webpush from "npm:web-push@3.6.7";
import { sendApns, isApnsDeadToken } from "./apns.ts";
import { sendFcm, isFcmDeadToken } from "./fcm.ts";

/** Minimal shape of the supabase-js client we actually use. Keeps this
 *  module decoupled from a specific createClient import/version. */
// deno-lint-ignore no-explicit-any
type Admin = any;

export type Nudge = {
  title: string;
  body: string;
  /** In-app path, e.g. "/today" or "/today/plan". Used verbatim for Web Push
   *  and converted to a `daydraft://` deep link for native. */
  url: string;
  badge?: number;
  /** Extra key/values delivered to the native app alongside the deep link. */
  data?: Record<string, unknown>;
};

export type DispatchResult = {
  /** false when this (user, kind, day) was already sent — nothing dispatched. */
  fired: boolean;
  nativeSent: number;
  webSent: number;
  deadNative: number;
  deadWeb: number;
};

/** Path "/today/plan" → "daydraft://today/plan" (resolveDeepLink parses host
 *  + path back into the same segments). */
function pathToDeepLink(path: string): string {
  return "daydraft://" + String(path || "/home").replace(/^\/+/, "");
}

let vapidReady = false;
let vapidChecked = false;
/** Configure web-push once per cold start. Returns false in dry-run (no keys),
 *  so callers silently skip the web channel instead of throwing. */
function ensureVapid(): boolean {
  if (vapidChecked) return vapidReady;
  vapidChecked = true;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const priv = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@daydraft.app";
  if (!pub || !priv) return false;
  try {
    webpush.setVapidDetails(subject, pub, priv);
    vapidReady = true;
  } catch {
    vapidReady = false;
  }
  return vapidReady;
}

/**
 * Reserve the (user, kind, day) slot. Returns true if WE won the slot (caller
 * should send), false if it was already taken. Implemented as an insert that
 * trips the UNIQUE constraint on a re-run — atomic enough to survive two cron
 * invocations racing in the same minute.
 */
export async function claimNotificationSlot(
  admin: Admin,
  userId: string,
  kind: string,
  localDate: string,
): Promise<boolean> {
  const { error } = await admin
    .from("notification_log")
    .insert({ user_id: userId, kind, local_date: localDate });
  if (!error) return true;
  // 23505 = unique_violation → someone already claimed it. Anything else is a
  // real error; treat it as "don't send" so we never spam on a flaky DB.
  return false;
}

/** Send one nudge to every native token the user has. Dead tokens are deleted. */
async function dispatchNative(admin: Admin, userId: string, n: Nudge): Promise<{ sent: number; dead: number }> {
  const { data: tokens } = await admin
    .from("push_tokens")
    .select("id, platform, token")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (!tokens?.length) return { sent: 0, dead: 0 };

  const data: Record<string, unknown> = { ...(n.data ?? {}), deepLink: pathToDeepLink(n.url) };
  // FCM only accepts a string→string data map; APNs takes arbitrary JSON.
  const fcmData: Record<string, string> = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
  );

  const results = await Promise.all(
    // deno-lint-ignore no-explicit-any
    tokens.map(async (row: any) => {
      try {
        if (row.platform === "ios") {
          const r = await sendApns(row.token, { title: n.title, body: n.body, badge: n.badge, data });
          return { id: row.id as string, ok: r.ok, dead: isApnsDeadToken(r) };
        }
        const r = await sendFcm(row.token, { title: n.title, body: n.body, badge: n.badge, data: fcmData });
        return { id: row.id as string, ok: r.ok, dead: isFcmDeadToken(r) };
      } catch {
        return { id: row.id as string, ok: false, dead: false };
      }
    }),
  );

  const deadIds = results.filter((r) => r.dead).map((r) => r.id);
  if (deadIds.length) await admin.from("push_tokens").delete().in("id", deadIds);
  return { sent: results.filter((r) => r.ok).length, dead: deadIds.length };
}

/** Send one nudge to every Web Push subscription. Expired ones are deleted. */
async function dispatchWeb(admin: Admin, userId: string, n: Nudge): Promise<{ sent: number; dead: number }> {
  if (!ensureVapid()) return { sent: 0, dead: 0 };
  const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
  if (!subs?.length) return { sent: 0, dead: 0 };

  const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url });
  let sent = 0;
  let dead = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        // deno-lint-ignore no-explicit-any
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any,
        payload,
        { TTL: 600 },
      );
      sent += 1;
    } catch (e) {
      // deno-lint-ignore no-explicit-any
      const code = Number((e as any)?.statusCode || (e as any)?.status || 0);
      if (code === 404 || code === 410) {
        await admin.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", s.endpoint);
        dead += 1;
      }
    }
  }
  return { sent, dead };
}

/**
 * The one call a cron makes per user/slot: claim the slot, then fan out to
 * both channels. Pass `kind` + `localDate` to enforce once-per-day; pass
 * `dedup: false` to skip the gate (e.g. a manual test send).
 */
export async function dispatchNudge(
  admin: Admin,
  userId: string,
  kind: string,
  localDate: string,
  n: Nudge,
  opts?: { dedup?: boolean },
): Promise<DispatchResult> {
  const dedup = opts?.dedup !== false;
  if (dedup) {
    const won = await claimNotificationSlot(admin, userId, kind, localDate);
    if (!won) return { fired: false, nativeSent: 0, webSent: 0, deadNative: 0, deadWeb: 0 };
  }
  const [native, web] = await Promise.all([
    dispatchNative(admin, userId, n),
    dispatchWeb(admin, userId, n),
  ]);
  return {
    fired: true,
    nativeSent: native.sent,
    webSent: web.sent,
    deadNative: native.dead,
    deadWeb: web.dead,
  };
}
