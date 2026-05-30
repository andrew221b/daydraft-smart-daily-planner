// Reference scaffold — verifies a StoreKit 2 signed transaction (JWS) sent
// from the native iOS client and upserts the entitlement into `subscriptions`.
//
// Required env (set later in Cursor / native build):
//   APPLE_BUNDLE_ID         e.g. com.yourname.daydraft
//   APPLE_ISSUER_ID         App Store Connect Issuer ID
//   APPLE_KEY_ID            10-char Key ID
//   APPLE_PRIVATE_KEY       contents of the .p8 file (PEM, with newlines)
//   APPLE_ENVIRONMENT       "sandbox" | "production"  (optional, default sandbox)
//
// Client call (Swift):
//   POST { signedTransaction: "<JWS string from Transaction.latest>" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dd-dev-pro",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    if (!token) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userRes } = await userClient.auth.getUser(token);
    const user = userRes?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const signed = body?.signedTransaction as string | undefined;
    if (!signed) return json({ error: "signedTransaction required" }, 400);

    // Decode JWS payload (header.payload.signature) — payload is base64url JSON.
    // NOTE: signature verification against Apple's root CA is intentionally
    // omitted here. Implement with x5c chain check before going live.
    const payload = decodeJwsPayload(signed);
    if (!payload) return json({ error: "invalid JWS" }, 400);

    const bundleId = Deno.env.get("APPLE_BUNDLE_ID");
    if (bundleId && payload.bundleId !== bundleId) {
      return json({ error: "bundle mismatch" }, 400);
    }

    const env = (payload.environment ?? Deno.env.get("APPLE_ENVIRONMENT") ?? "Sandbox")
      .toLowerCase() === "production" ? "production" : "sandbox";

    const expiresMs = Number(payload.expiresDate ?? 0);
    const isActive = expiresMs > Date.now();
    const status = isActive ? "active" : "expired";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: upErr } = await admin.from("subscriptions").upsert(
      {
        user_id: user.id,
        platform: "apple",
        environment: env,
        status,
        plan: payload.productId ?? null,
        apple_product_id: payload.productId ?? null,
        apple_original_transaction_id: String(payload.originalTransactionId ?? ""),
        apple_latest_transaction_id: String(payload.transactionId ?? ""),
        current_period_end: expiresMs ? new Date(expiresMs).toISOString() : null,
        last_event_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (upErr) return json({ error: upErr.message }, 500);

    return json({ ok: true, status, environment: env, expiresAt: expiresMs });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeJwsPayload(jws: string): Record<string, any> | null {
  try {
    const part = jws.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}