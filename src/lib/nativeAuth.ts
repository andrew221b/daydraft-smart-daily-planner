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
      google: GOOGLE_IOS_CLIENT_ID
        ? {
            // Used to request an ID token whose audience matches the iOS
            // client. Supabase's Google provider must list this client ID
            // in its "Authorized client IDs" field.
            iOSClientId: GOOGLE_IOS_CLIENT_ID,
            // The mode determines what we receive. "online" returns an
            // accessToken + idToken — Supabase needs the idToken.
            mode: "online",
          }
        : undefined,
      // Apple needs no init config on iOS — the system handles it.
      apple: {},
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
  return Capacitor.isNativePlatform() && !!GOOGLE_IOS_CLIENT_ID;
}

/**
 * Native Google sign-in. Returns the Supabase session result (same shape
 * as `supabase.auth.signInWithIdToken`).
 *
 * Nonce protocol — same as Apple (see `signInWithAppleNative` for the
 * detailed explanation). Modern `GoogleSignIn` iOS SDK ALSO includes a
 * `nonce` claim in the id_token even when one isn't requested explicitly
 * — and Supabase, when it sees a nonce in the id_token, *requires* a
 * matching `nonce` param on the request. Otherwise:
 *   "passed nonce and nonce in id_token should either both exist or not"
 *
 * The fix: hand the plugin a SHA-256 hash of our raw nonce; the plugin
 * forwards it to Google, Google embeds it verbatim in the id_token's
 * nonce claim. Then we pass the raw nonce to Supabase, Supabase hashes
 * it server-side and the two hashes match.
 */
export async function signInWithGoogleNative(): Promise<{ error?: Error | null }> {
  if (!Capacitor.isNativePlatform()) {
    return { error: new Error("Native Google sign-in is only available on iOS / Android") };
  }
  if (!GOOGLE_IOS_CLIENT_ID) {
    return { error: new Error("Google sign-in isn't configured for this build (missing VITE_GOOGLE_IOS_CLIENT_ID)") };
  }
  try {
    await ensureInitialized();
    const rawNonce = generateNonce();
    const hashedNonce = await sha256Hex(rawNonce);
    console.info("[nativeAuth] Google: calling SocialLogin.login");
    const res = await SocialLogin.login({
      provider: "google",
      options: {
        // Request the standard set so Supabase can build a profile.
        scopes: ["email", "profile"],
        nonce: hashedNonce,
      },
    });
    console.info("[nativeAuth] Google: plugin returned", {
      hasIdToken: !!(res as any)?.result?.idToken,
      keys: res && typeof res === "object" ? Object.keys(res as object) : [],
    });
    const idToken = (res as any)?.result?.idToken as string | undefined;
    if (!idToken) {
      return { error: new Error("Google sign-in didn't return an ID token") };
    }
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
      nonce: rawNonce,
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
  if (!Capacitor.isNativePlatform()) {
    return { error: new Error("Native Apple sign-in is only available on iOS") };
  }
  try {
    await ensureInitialized();
    const rawNonce = generateNonce();
    const hashedNonce = await sha256Hex(rawNonce);
    console.info("[nativeAuth] Apple: calling SocialLogin.login");
    const res = await SocialLogin.login({
      provider: "apple",
      options: {
        scopes: ["email", "name"],
        nonce: hashedNonce,
      },
    });
    console.info("[nativeAuth] Apple: plugin returned", {
      hasIdToken: !!(res as any)?.result?.idToken,
      keys: res && typeof res === "object" ? Object.keys(res as object) : [],
    });
    const idToken = (res as any)?.result?.idToken as string | undefined;
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

/** SHA-256 → lowercase hex. Used to satisfy Apple's nonce-in-id_token contract. */
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
