/**
 * APNs HTTP/2 sender — token-based authentication (.p8 key).
 *
 * Apple requires every request to carry a short-lived ES256 JWT signed
 * with your APNs Auth Key. We mint a fresh one on each cold start and
 * cache it for up to 50 minutes (Apple's hard ceiling is 60).
 *
 * Required env vars:
 *   APNS_KEY_ID          — the 10-char key id from Developer Console
 *   APNS_TEAM_ID         — the 10-char Apple Developer Team id
 *   APNS_PRIVATE_KEY     — the full contents of the .p8 file (PEM)
 *   APNS_BUNDLE_ID       — defaults to "dev.daydraft.app"
 *   APNS_USE_SANDBOX     — "true" for dev push, anything else = prod
 */

const TOKEN_TTL_MS = 50 * 60 * 1000;

let cachedToken: { value: string; expiresAt: number } | null = null;
let importedKey: CryptoKey | null = null;

export type ApnsPayload = {
  title: string;
  body: string;
  badge?: number;
  sound?: string;
  threadId?: string;
  /** Arbitrary key/value data delivered to the app. The client reads
   *  `data.deepLink` to navigate when the user taps. */
  data?: Record<string, unknown>;
};

export type ApnsResult =
  | { ok: true; token: string }
  | { ok: false; token: string; status: number; reason?: string };

function envOrThrow(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToBinary(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getPrivateKey(): Promise<CryptoKey> {
  if (importedKey) return importedKey;
  const pem = envOrThrow("APNS_PRIVATE_KEY");
  const binary = pemToBinary(pem);
  importedKey = await crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return importedKey;
}

async function mintProviderToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const keyId = envOrThrow("APNS_KEY_ID");
  const teamId = envOrThrow("APNS_TEAM_ID");
  const key = await getPrivateKey();

  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = { iss: teamId, iat: Math.floor(now / 1000) };

  const enc = new TextEncoder();
  const headerB = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB}.${payloadB}`;

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(signingInput),
  );
  const token = `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
  cachedToken = { value: token, expiresAt: now + TOKEN_TTL_MS };
  return token;
}

function apnsHost(): string {
  const sandbox = (Deno.env.get("APNS_USE_SANDBOX") || "").toLowerCase() === "true";
  return sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
}

/** Deliver one push to one device token. */
export async function sendApns(deviceToken: string, payload: ApnsPayload): Promise<ApnsResult> {
  const providerToken = await mintProviderToken();
  const bundleId = Deno.env.get("APNS_BUNDLE_ID") || "dev.daydraft.app";

  // APNs aps payload shape — alert + sound + badge are top-level
  // properties under `aps`; everything else is delivered as custom
  // data to the app.
  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
    sound: payload.sound ?? "default",
  };
  if (typeof payload.badge === "number") aps.badge = payload.badge;
  if (payload.threadId) aps["thread-id"] = payload.threadId;

  const body = JSON.stringify({ aps, ...(payload.data ?? {}) });

  const res = await fetch(`https://${apnsHost()}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      "authorization": `bearer ${providerToken}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json; charset=utf-8",
    },
    body,
  });

  if (res.status === 200) return { ok: true, token: deviceToken };
  let reason: string | undefined;
  try {
    const txt = await res.text();
    if (txt) reason = JSON.parse(txt)?.reason ?? txt;
  } catch { /* ignore */ }
  return { ok: false, token: deviceToken, status: res.status, reason };
}

/** APNs status codes that mean the device token is dead and the row
 *  should be removed (or disabled) in `push_tokens`. */
export const APNS_DEAD_REASONS = new Set([
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
  "Unregistered",
  "ExpiredProviderToken",
]);

export function isApnsDeadToken(result: ApnsResult): boolean {
  if (result.ok) return false;
  if (result.status === 410) return true;
  return !!result.reason && APNS_DEAD_REASONS.has(result.reason);
}
