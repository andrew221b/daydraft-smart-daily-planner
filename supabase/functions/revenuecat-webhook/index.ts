// RevenueCat webhook → keeps `subscriptions` in sync with the user's real
// store entitlement (App Store / Google Play, both via RevenueCat).
//
// Why this is the server source of truth: the client trusts RevenueCat's
// entitlement for instant UI, but server-side gating (generate-plan, the
// entitlement query in useEntitlement) reads `subscriptions.status`. This
// webhook is what writes it.
//
// Setup:
//   • RevenueCat → Project → Integrations → Webhooks
//       URL  = https://<ref>.supabase.co/functions/v1/revenuecat-webhook
//       Auth = a secret string (set it as REVENUECAT_WEBHOOK_SECRET below)
//   • This endpoint MUST be public — verify_jwt = false in supabase/config.toml.
//   • The client calls Purchases.logIn(supabaseUserId), so RevenueCat's
//     `app_user_id` IS the Supabase user id — we upsert by it directly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

type RCEvent = {
  type?: string;
  app_user_id?: string;
  product_id?: string;
  period_type?: string;          // NORMAL | TRIAL | INTRO
  expiration_at_ms?: number;
  purchased_at_ms?: number;
};

/** Map a RevenueCat event to our `subscriptions.status` vocabulary. */
function deriveStatus(ev: RCEvent, nowMs: number): "active" | "trialing" | "expired" {
  const exp = Number(ev.expiration_at_ms ?? 0);
  const ended = ev.type === "EXPIRATION" || (exp > 0 && exp < nowMs);
  if (ended) return "expired";              // → free tier (useEntitlement)
  if (ev.period_type === "TRIAL") return "trialing";
  return "active";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  // Shared-secret check — RevenueCat sends the Authorization header you set in
  // the dashboard. Reject anything else so the endpoint can't be spoofed.
  const expected = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  if (expected && req.headers.get("Authorization") !== expected) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const ev = (body?.event ?? {}) as RCEvent;

    const appUserId = String(ev.app_user_id ?? "");
    // Ignore anonymous ids (purchases made before Purchases.logIn) — there's no
    // Supabase user to attach them to; a later aliased event will carry the id.
    if (!appUserId || appUserId.startsWith("$RCAnonymousID")) {
      return new Response(JSON.stringify({ ok: true, skipped: "anonymous" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const nowMs = Date.now();
    const status = deriveStatus(ev, nowMs);
    const expIso = ev.expiration_at_ms ? new Date(Number(ev.expiration_at_ms)).toISOString() : null;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await admin.from("subscriptions").upsert(
      {
        user_id: appUserId,
        status,
        plan: ev.product_id ?? null,
        current_period_end: status === "active" ? expIso : null,
        trial_ends_at: status === "trialing" ? expIso : null,
      },
      { onConflict: "user_id" },
    );
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, user: appUserId, status }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
