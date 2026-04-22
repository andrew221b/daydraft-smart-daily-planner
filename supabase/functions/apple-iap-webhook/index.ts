// Reference scaffold for App Store Server Notifications V2.
// Apple POSTs a signedPayload (JWS) describing subscription lifecycle events:
// SUBSCRIBED, DID_RENEW, DID_CHANGE_RENEWAL_STATUS, EXPIRED, REFUND, REVOKE, etc.
//
// Configure the URL in App Store Connect → App Information → App Store Server
// Notifications (Production + Sandbox).
//
// This endpoint MUST be public (verify_jwt = false in supabase/config.toml).
// Signature verification against Apple's root CA is omitted in this scaffold —
// implement it before going live (parse x5c chain in JWS header).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  try {
    const body = await req.json().catch(() => ({} as any));
    const signedPayload = body?.signedPayload as string | undefined;
    if (!signedPayload) return new Response("missing signedPayload", { status: 400 });

    const notif = decodeJws(signedPayload);
    if (!notif) return new Response("invalid JWS", { status: 400 });

    // notif fields: notificationType, subtype, data { signedTransactionInfo, signedRenewalInfo, environment, bundleId }
    const data = notif.data || {};
    const tx = data.signedTransactionInfo ? decodeJws(data.signedTransactionInfo) : null;
    const renewal = data.signedRenewalInfo ? decodeJws(data.signedRenewalInfo) : null;
    if (!tx) return new Response("missing transaction", { status: 400 });

    const env = (data.environment ?? "Sandbox").toLowerCase() === "production"
      ? "production" : "sandbox";
    const status = mapStatus(notif.notificationType, notif.subtype, renewal);
    const expiresMs = Number(tx.expiresDate ?? 0);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // We don't have user_id from Apple — match by original_transaction_id.
    const origTx = String(tx.originalTransactionId ?? "");
    if (!origTx) return new Response("missing originalTransactionId", { status: 400 });

    const { data: row } = await admin.from("subscriptions")
      .select("user_id").eq("apple_original_transaction_id", origTx).maybeSingle();
    if (!row?.user_id) {
      // No prior verify-apple-iap call linked this transaction to a user yet.
      // Acknowledge so Apple stops retrying; the next client launch will reconcile.
      return new Response("ok (unlinked)", { status: 200 });
    }

    await admin.from("subscriptions").upsert({
      user_id: row.user_id,
      platform: "apple",
      environment: env,
      status,
      plan: tx.productId ?? null,
      apple_product_id: tx.productId ?? null,
      apple_original_transaction_id: origTx,
      apple_latest_transaction_id: String(tx.transactionId ?? ""),
      current_period_end: expiresMs ? new Date(expiresMs).toISOString() : null,
      last_notification_type: `${notif.notificationType}${notif.subtype ? "." + notif.subtype : ""}`,
      last_event_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    return new Response("ok");
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
});

function decodeJws(jws: string): Record<string, any> | null {
  try {
    const part = jws.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}

function mapStatus(type?: string, subtype?: string, renewal?: any): string {
  switch (type) {
    case "SUBSCRIBED":
    case "DID_RENEW":
      return "active";
    case "OFFER_REDEEMED":
      return "active";
    case "DID_CHANGE_RENEWAL_STATUS":
      return renewal?.autoRenewStatus === 1 ? "active" : "canceled";
    case "EXPIRED":
      return "expired";
    case "GRACE_PERIOD_EXPIRED":
      return "expired";
    case "REFUND":
    case "REVOKE":
      return "refunded";
    case "DID_FAIL_TO_RENEW":
      return subtype === "GRACE_PERIOD" ? "active" : "past_due";
    default:
      return "active";
  }
}