/**
 * FCM HTTP v1 sender.
 *
 * The HTTP v1 API requires an OAuth2 access token minted from a Firebase
 * service account JSON. We exchange the service-account JWT for an
 * access token via the Google OAuth endpoint and cache it until it
 * expires.
 *
 * Required env vars:
 *   FCM_SERVICE_ACCOUNT  — full JSON of the service-account key file
 *                          (one line, as Supabase secret)
 *   FCM_PROJECT_ID       — Firebase project id (also inside the JSON
 *                          as `project_id` — read from the JSON if not
 *                          set explicitly)
 */

const ACCESS_TOKEN_TTL_MS = 50 * 60 * 1000;

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;
let importedKey: CryptoKey | null = null;
let serviceAccount: ServiceAccount | null = null;

export type FcmPayload = {
  title: string;
  body: string;
  /** Custom data delivered to the app. Capacitor exposes it on
   *  `notification.data` — the client reads `deepLink` to navigate. */
  data?: Record<string, string>;
  /** Optional notification badge count (iOS-style, but FCM allows it). */
  badge?: number;
  sound?: string;
};

export type FcmResult =
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
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function getServiceAccount(): ServiceAccount {
  if (serviceAccount) return serviceAccount;
  const raw = envOrThrow("FCM_SERVICE_ACCOUNT");
  try {
    const json = JSON.parse(raw) as ServiceAccount;
    if (!json.client_email || !json.private_key || !json.project_id) {
      throw new Error("FCM_SERVICE_ACCOUNT missing required fields");
    }
    serviceAccount = json;
    return json;
  } catch (e) {
    throw new Error(`FCM_SERVICE_ACCOUNT is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
}

async function getPrivateKey(): Promise<CryptoKey> {
  if (importedKey) return importedKey;
  // The service-account JSON stores the private key with literal `\n`
  // escapes that JSON.parse turns back into real newlines. PEM parsing
  // strips both, so it doesn't matter — but we still need the binary.
  const sa = getServiceAccount();
  const binary = pemToBinary(sa.private_key);
  importedKey = await crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return importedKey;
}

async function mintAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const sa = getServiceAccount();
  const key = await getPrivateKey();

  const header = { alg: "RS256", typ: "JWT" };
  const iat = Math.floor(now / 1000);
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  };

  const enc = new TextEncoder();
  const headerB = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB}.${payloadB}`;

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    enc.encode(signingInput),
  );
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;

  // Exchange the JWT for an access token.
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FCM token exchange failed: ${res.status} ${text}`);
  }
  const tokenData = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    value: tokenData.access_token,
    expiresAt: now + Math.min(tokenData.expires_in * 1000, ACCESS_TOKEN_TTL_MS),
  };
  return cachedToken.value;
}

export async function sendFcm(deviceToken: string, payload: FcmPayload): Promise<FcmResult> {
  const sa = getServiceAccount();
  const projectId = Deno.env.get("FCM_PROJECT_ID") || sa.project_id;
  const accessToken = await mintAccessToken();

  // FCM v1 message shape. Keep notification + data both populated so
  // the OS shows the alert AND the app gets the custom data for
  // deep-linking on tap.
  const message: Record<string, unknown> = {
    token: deviceToken,
    notification: { title: payload.title, body: payload.body },
    data: payload.data ?? {},
    android: {
      priority: "HIGH",
      notification: {
        sound: payload.sound ?? "default",
        // Must match the client-created channel (src/lib/localNotifications.ts
        // → ANDROID_CHANNEL_ID). Without this, FCM drops the alert onto a
        // low-importance fallback channel that is silent and never vibrates.
        channel_id: "dd_reminders_v2",
        ...(typeof payload.badge === "number" ? { notification_count: payload.badge } : {}),
      },
    },
    apns: {
      payload: {
        aps: {
          sound: payload.sound ?? "default",
          ...(typeof payload.badge === "number" ? { badge: payload.badge } : {}),
        },
      },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        "authorization": `Bearer ${accessToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ message }),
    },
  );

  if (res.ok) return { ok: true, token: deviceToken };
  let reason: string | undefined;
  try {
    const txt = await res.text();
    if (txt) {
      const parsed = JSON.parse(txt);
      reason = parsed?.error?.status || parsed?.error?.message || txt;
    }
  } catch { /* ignore */ }
  return { ok: false, token: deviceToken, status: res.status, reason };
}

/** FCM tells us the token is dead via status code 404 ("UNREGISTERED"
 *  / "NOT_FOUND") or 400 with "INVALID_ARGUMENT". */
export function isFcmDeadToken(result: FcmResult): boolean {
  if (result.ok) return false;
  if (result.status === 404) return true;
  if (result.status === 400 && result.reason && /INVALID_ARGUMENT|invalid registration/i.test(result.reason)) return true;
  if (result.reason && /UNREGISTERED|NOT_FOUND/i.test(result.reason)) return true;
  return false;
}
