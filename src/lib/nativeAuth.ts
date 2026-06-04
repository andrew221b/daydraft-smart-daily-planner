import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { supabase } from "@/integrations/supabase/client";

/**
 * Native iOS/Android sign-in for Google and Apple.
 *
 * Browser-broker OAuth (the existing `@lovable.dev/cloud-auth-js` path)
 * doesn't work inside a Capacitor WebView because the broker can't
 * redirect back to `capacitor://localhost`. Instead we let the native
 * platform present its own sign-in sheet (Apple's system dialog / Google's
 * native flow), receive an *identity token* + nonce, and hand it to
 * Supabase via `signInWithIdToken`. Supabase verifies the token against
 * the provider and creates the session — no broker round-trip needed.
 *
 * The web build keeps using the Lovable broker (better UX in browsers,
 * already works). Only native iOS/Android calls into this module.
 *
 * Required configuration the user must do once, outside the code:
 *   1. Apple Developer:
 *      - Enable "Sign In with Apple" on the App ID (`dev.daydraft.app`).
 *      - Create a Services ID + key for Supabase's Apple provider.
 *      - Xcode: add the "Sign in with Apple" capability (Targets → App →
 *        Signing & Capabilities → "+ Capability").
 *   2. Google Cloud Console:
 *      - Create an OAuth 2.0 client of type "iOS" with bundle ID
 *        `dev.daydraft.app`. Note the Client ID and the reversed URL
 *        scheme.
 *      - Add the reversed scheme to `ios/App/App/Info.plist`
 *        (placeholder block already added).
 *      - Set `VITE_GOOGLE_IOS_CLIENT_ID` in the env so the plugin can
 *        request the right token audience.
 *   3. Supabase Auth dashboard:
 *      - Enable Apple provider (paste Service ID + private key).
 *      - Enable Google provider (paste Web client ID). In the "Authorized
 *        client IDs" field add the iOS client ID too, so tokens minted by
 *        the iOS app are accepted.
 */

let initialized = false;

const GOOGLE_IOS_CLIENT_ID = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID as string | undefined;
const GOOGLE_WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined;

/** Idempotent — safe to call from many entry points. Runs once per app session. */
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (!Capacitor.isNativePlatform()) {
    initialized = true;
    return;
  }
  console.info("[nativeAuth] initializing SocialLogin plugin", {
    googleConfigured: !!GOOGLE_IOS_CLIENT_ID,
  });
  try {
    await SocialLogin.initialize({
      google: GOOGLE_IOS_CLIENT_ID || GOOGLE_WEB_CLIENT_ID
        ? {
            // Used to request an ID token whose audience matches the iOS
            // client. Supabase's Google provider must list this client ID
            // in its "Authorized client IDs" field.
            iOSClientId: GOOGLE_IOS_CLIENT_ID,
            // Required for Android native authentication via Capgo
            webClientId: GOOGLE_WEB_CLIENT_ID,
            // The mode determines what we receive. "online" returns an
            // accessToken + idToken — Supabase needs the idToken.
            mode: "online",
          }
        : undefined,
      // Apple needs no init config on iOS — the system handles it.
      // On Android, an empty object throws "apple.android.redirectUrl is null".
      apple: Capacitor.getPlatform() === "ios" ? {} : undefined,
    });
    initialized = true;
    console.info("[nativeAuth] SocialLogin plugin initialized");
  } catch (e) {
    // Initialization failures are rare but possible on the simulator
    // without proper bundle configuration. Surface as a normal error to
    // the caller so the UI can fall back gracefully.
    initialized = false;
    console.error("[nativeAuth] SocialLogin.initialize failed", e);
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export function isNativeAuthAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export function isNativeGoogleConfigured(): boolean {
  return Capacitor.isNativePlatform() && (!!GOOGLE_IOS_CLIENT_ID || !!GOOGLE_WEB_CLIENT_ID);
}

/**
 * Clear cached native provider sessions on sign-out / account deletion.
 *
 * Why this exists: Supabase's `auth.signOut()` only flushes the Supabase
 * session token. The NATIVE provider (Google / Apple) is a separate piece
 * of state — Google in particular caches the picked account on the device
 * via GoogleSignIn-iOS so the next tap on "Continue with Google" silently
 * reuses that account and the user gets re-logged-in to the same identity
 * they thought they'd just signed out from (or worse: deleted).
 *
 * SocialLogin.logout({provider}) tells the native SDK to drop its cached
 * grant + account selection. Result: the next "Continue with Google" shows
 * the OS account picker again, letting the user pick a fresh account.
 *
 * Wrapped in try/catch + Promise.allSettled so a single provider failure
 * never blocks the sign-out chain — the Supabase signOut + nav redirect
 * are far more important than this best-effort cleanup.
 */
export async function clearNativeSocialSessions(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await ensureInitialized();
  } catch {
    return;
  }
  await Promise.allSettled([
    (async () => {
      try {
        await SocialLogin.logout({ provider: "google" });
      } catch (e) {
        console.info("[nativeAuth] Google logout skipped", e);
      }
    })(),
    (async () => {
      if (Capacitor.getPlatform() !== "ios") return;
      try {
        await SocialLogin.logout({ provider: "apple" });
      } catch (e) {
        console.info("[nativeAuth] Apple logout skipped", e);
      }
    })(),
  ]);
}

/**
 * Native Google sign-in. Returns the Supabase session result (same shape
 * as `supabase.auth.signInWithIdToken`).
 *
 * Why this is so finicky — and the bug we kept reintroducing:
 *
 * The @capgo plugin has TWO paths in its iOS Google login (see
 * GoogleProvider.swift line 81):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ if hasPreviousSignIn && !forceAuthCode && mode != OFFLINE │
 *   │   → restorePreviousSignIn   (silent, IGNORES our nonce)   │
 *   │ else                                                       │
 *   │   → signIn(presenting:, nonce:)   (uses our nonce)         │
 *   └──────────────────────────────────────────────────────────┘
 *
 * `restorePreviousSignIn` returns a CACHED user with a refreshed id_token.
 * That refreshed token may carry a nonce from an earlier OAuth flow that
 * WE don't have the raw form of — so when we then pass our freshly-
 * generated rawNonce to Supabase, the hash never matches → server error
 * "Nonces mismatch". This is exactly the symptom users reported after we
 * added pre-login `SocialLogin.logout()` to force the account picker:
 * `signOut()` clears the in-memory user but does NOT clear the keychain,
 * so `hasPreviousSignIn()` still returns true and the cached path kept
 * winning.
 *
 * Fix: pass `forcePrompt: true` to the plugin. That sets `forceAuthCode`,
 * skips `restorePreviousSignIn` entirely, and routes us through the real
 * OAuth flow where our nonce is actually honored.
 *
 * Nonce protocol — mirrors Apple (see `signInWithAppleNative`):
 *   1. Generate rawNonce locally.
 *   2. SHA-256 it as HEX and pass that to the plugin so Google embeds it
 *      verbatim in the id_token's `nonce` claim. Hex is mandatory because
 *      Supabase auth (gotrue) verifies with `fmt.Sprintf("%x", sha256(...))`.
 *   3. Pass rawNonce to Supabase. Server computes hex(sha256(rawNonce)) and
 *      compares against the id_token's nonce claim — match → session.
 */
export async function signInWithGoogleNative(): Promise<{ error?: Error | null }> {
  if (!Capacitor.isNativePlatform()) {
    return { error: new Error("Native Google sign-in is only available on iOS / Android") };
  }
  if (!GOOGLE_IOS_CLIENT_ID && !GOOGLE_WEB_CLIENT_ID) {
    return { error: new Error("Google sign-in isn't configured for this build (missing VITE_GOOGLE_IOS_CLIENT_ID or VITE_GOOGLE_WEB_CLIENT_ID)") };
  }
  try {
    await ensureInitialized();

    const rawNonce = generateNonce();
    const hashedNonce = await sha256Hex(rawNonce);

    // Best-effort keychain cleanup. The plugin's `logout()` only calls
    // `GIDSignIn.signOut()` which clears in-memory state, not keychain — so
    // this alone isn't enough to force the picker. The real lever is
    // `forcePrompt: true` below, which makes the plugin bypass
    // `restorePreviousSignIn` regardless of keychain state.
    try {
      await SocialLogin.logout({ provider: "google" });
    } catch (e) {
      console.info("[nativeAuth] Google: pre-login logout skipped", e);
    }

    console.info("[nativeAuth] Google: calling SocialLogin.login");
    const res = await SocialLogin.login({
      provider: "google",
      options: Capacitor.getPlatform() === "ios" ? {
        scopes: ["email", "profile"],
        nonce: hashedNonce,
        // CRITICAL: forces the plugin into the `signIn(presenting:nonce:)`
        // branch instead of `restorePreviousSignIn`. Without this, the
        // cached path runs, returns a refreshed id_token whose nonce we
        // can't reproduce, and Supabase rejects with "Nonces mismatch".
        forcePrompt: true,
      } : undefined,
    });

    const idToken = (res as { result?: { idToken?: string } })?.result?.idToken;
    const claims = idToken ? decodeJwtPayload(idToken) : null;
    const tokenNonceClaim = typeof claims?.nonce === "string" ? (claims.nonce as string) : "";
    const tokenHasNonce = tokenNonceClaim.length > 0;
    const tokenNonceMatchesOurs = tokenHasNonce && tokenNonceClaim === hashedNonce;

    console.info("[nativeAuth] Google: plugin returned", {
      hasIdToken: !!idToken,
      tokenAud: claims?.aud,
      tokenNoncePresent: tokenHasNonce,
      tokenNonceMatchesOurs,
      sentHashedNoncePreview: hashedNonce.slice(0, 16) + "…",
      tokenNoncePreview: tokenHasNonce ? tokenNonceClaim.slice(0, 16) + "…" : null,
    });

    if (!idToken) {
      return { error: new Error("Google sign-in didn't return an ID token") };
    }

    // Only forward rawNonce when the id_token's nonce claim is exactly the
    // hashedNonce we sent. That confirms the cached path was skipped and
    // Supabase's hex(sha256(rawNonce)) will match. If the token has a nonce
    // we don't own (cached path slipped through), we have no choice but to
    // skip nonce — Supabase will then bail with the "either both exist or
    // not" error, which is at least an honest failure rather than a
    // silently-wrong session.
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
      ...(tokenNonceMatchesOurs ? { nonce: rawNonce } : {}),
    });

    if (error) console.error("[nativeAuth] Google: signInWithIdToken error", error);
    else console.info("[nativeAuth] Google: signInWithIdToken ok");
    return { error: error ?? null };
  } catch (e) {
    console.error("[nativeAuth] Google: caught error", e);
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Native Apple sign-in. Apple's system sheet handles the entire flow.
 * Identity token comes back signed by Apple; Supabase verifies it.
 *
 * Nonce protocol — the part you'll get wrong twice if you don't read this:
 *   1. We generate a raw random nonce.
 *   2. We SHA-256 it ourselves to a hex string ("hashedNonce") and pass
 *      THAT to the plugin. The plugin sets `request.nonce = hashedNonce`.
 *      Apple's iOS SDK embeds whatever we hand it *verbatim* in the
 *      `nonce` claim of the id_token.
 *   3. We pass the RAW (un-hashed) nonce to Supabase. Supabase hashes our
 *      raw nonce server-side and compares against the id_token's nonce
 *      claim (which is the hash). Match → session.
 *
 * Why both halves: if we'd passed the raw value to both, Apple would put
 * the raw value in the id_token and Supabase would produce a hash from
 * its own nonce param — mismatch → "passed nonce and nonce in id_token
 * should either both exist or not". This is the exact bug we're fixing.
 */
export async function signInWithAppleNative(): Promise<{ error?: Error | null }> {
  if (Capacitor.getPlatform() !== "ios") {
    return { error: new Error("Native Apple sign-in is only available on iOS") };
  }
  try {
    await ensureInitialized();
    const rawNonce = generateNonce();
    const hashedNonce = await sha256Hex(rawNonce);
    console.info("[nativeAuth] Apple: calling SocialLogin.login", {
      rawNonceLen: rawNonce.length,
      hashedNoncePreview: hashedNonce.slice(0, 12) + "…",
    });
    const res = await SocialLogin.login({
      provider: "apple",
      options: {
        scopes: ["email", "name"],
        nonce: hashedNonce,
      },
    });
    const idToken = (res as { result?: { idToken?: string } })?.result?.idToken;
    const claims = idToken ? decodeJwtPayload(idToken) : null;
    console.info("[nativeAuth] Apple: plugin returned", {
      hasIdToken: !!idToken,
      tokenAud: claims?.aud,
      tokenNoncePresent: !!claims?.nonce,
      tokenNoncePreview: typeof claims?.nonce === "string" ? (claims.nonce as string).slice(0, 12) + "…" : null,
    });
    if (!idToken) {
      return { error: new Error("Apple sign-in didn't return an ID token") };
    }
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: idToken,
      nonce: rawNonce,
    });
    if (error) console.error("[nativeAuth] Apple: signInWithIdToken error", error);
    else console.info("[nativeAuth] Apple: signInWithIdToken ok");
    return { error: error ?? null };
  } catch (e) {
    console.error("[nativeAuth] Apple: caught error", e);
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** Random URL-safe nonce — input to SHA-256, kept raw to hand to Supabase. */
function generateNonce(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let out = "";
  for (const b of bytes) out += charset[b % charset.length];
  return out;
}

/**
 * SHA-256 → lowercase hex.
 *
 * This encoding MUST match what Supabase auth (gotrue) uses server-side
 * when verifying the nonce: it computes `fmt.Sprintf("%x", sha256.Sum256(...))`
 * on the rawNonce we send and compares it byte-for-byte to the `nonce` claim
 * inside the id_token. The provider (Apple / Google) embeds whatever hashed
 * value we hand to its SDK verbatim — so the SDK must receive lowercase hex,
 * not base64url, or every fresh sign-in fails with "Nonces mismatch".
 *
 * History note: an earlier commit (da16526) switched this to URL-safe base64
 * thinking Google wanted that format. It worked silently for cached sessions
 * because GoogleSignIn-iOS would drop the nonce in code flow and the token
 * came back without one. New accounts trigger the full OIDC flow where the
 * nonce IS round-tripped — at which point the format mismatch surfaces.
 */
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(hashBuf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Best-effort decode of a JWT's payload claims. Returns `null` on any parse
 * failure — used purely for debug logging to confirm what's in the
 * provider-issued token before handing it to Supabase.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}
