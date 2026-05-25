import { Capacitor } from "@capacitor/core";
import { forwardRef, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import {
  isNativeAuthAvailable,
  isNativeGoogleConfigured,
  signInWithAppleNative,
  signInWithGoogleNative,
} from "@/lib/nativeAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageFallback } from "@/components/app/PageFallback";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Fingerprint } from "lucide-react";


export default function Auth() {
  const { user, loading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<"google" | "apple" | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [confirmedFor, setConfirmedFor] = useState<string>("");
  const [resending, setResending] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (loading || (user && profileLoading)) return;
    if (!user) return;
    // Only send the user straight to /today when we're confident they're
    // already onboarded. For fresh sign-ups the profile row might not have
    // propagated yet (trigger race or Lovable preview slowness) — onboarding
    // upserts on commit, so routing there first is the safe default. The
    // sticky localStorage flag also counts as onboarded so a flaky profile
    // fetch can't re-route a returning user through onboarding.
    let stickyOnboarded = false;
    try {
      stickyOnboarded = localStorage.getItem(`dd_onboarded_uid_${user.id}`) === "1";
    } catch { /* ignore */ }
    const onboarded = profile?.onboarded === true || stickyOnboarded;
    nav(onboarded ? "/today" : "/onboarding", { replace: true });
  }, [loading, nav, profile?.onboarded, profileLoading, user]);

  const getErrorMessage = (message: string) => {
    if (/(leaked|breach|pwned|compromised)/i.test(message)) {
      return "This password has appeared in known data breaches. Please choose a stronger one.";
    }
    return message;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password: pw,
          options: { emailRedirectTo: window.location.origin, data: { display_name: name || email.split("@")[0] } },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Welcome to DayDraft");
          nav("/onboarding");
        } else {
          setAwaitingConfirmation(true);
          setConfirmedFor(email);
          toast.success("Check your email to confirm your account");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
        nav("/today");
      }
    } catch (err: any) {
      toast.error(getErrorMessage(err.message || "Something went wrong"));
    } finally { setBusy(false); }
  };

  const resendConfirmation = async () => {
    if (!email) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      toast.success("Confirmation email sent again");
    } catch (err: any) {
      toast.error(getErrorMessage(err.message || "Something went wrong"));
    } finally {
      setResending(false);
    }
  };

  // OAuth has two distinct paths now, picked at click time:
  //
  //   • Web (browser): goes through the Lovable OAuth broker
  //     (oauth.lovable.app), which redirects back to `window.location.origin`.
  //     This is what's wired today and works for any real https origin.
  //   • Native (Capacitor iOS/Android): uses the native sign-in sheet via
  //     `@capgo/capacitor-social-login`, gets an identity token, and exchanges
  //     it for a Supabase session via `signInWithIdToken`. No broker, no
  //     redirect — fixes the "404 inside the WebView" dead-end the broker hit
  //     when trying to round-trip to `capacitor://localhost`.
  //
  // The Lovable preview (`lovable.dev`) is still blocked because the broker
  // refuses to round-trip to that host either; users there can use email +
  // password or open the deployed app.
  const oauthBlockedReason = (() => {
    if (typeof window === "undefined") return null;
    // Native path is fine — don't block.
    if (isNativeAuthAvailable()) return null;
    try {
      const host = window.location.hostname;
      if (host.includes("lovable") || host.includes("localhost")) {
        return "Google / Apple sign-in only works on the published app URL — not inside the Lovable preview or localhost. Use email & password here, or open the live app to use OAuth.";
      }
    } catch { /* ignore */ }
    return null;
  })();

  const oauth = async (provider: "google" | "apple") => {
    console.info(`[auth] oauth tap`, { provider, native: isNativeAuthAvailable(), blocked: oauthBlockedReason });
    if (oauthBlockedReason) {
      toast(oauthBlockedReason, { duration: 6000 });
      return;
    }
    setOauthBusy(provider);
    try {
      if (isNativeAuthAvailable()) {
        // Native flow: Apple is always available on iOS; Google needs the
        // iOS client ID env to be set. Fall through to a friendly error if
        // not configured.
        if (provider === "apple") {
          console.info("[auth] starting native Apple sign-in");
          const { error } = await signInWithAppleNative();
          if (error) throw error;
          console.info("[auth] native Apple sign-in returned cleanly");
          // signInWithIdToken populates the session — useEffect navigates.
          return;
        }
        if (provider === "google") {
          if (!isNativeGoogleConfigured()) {
            toast.error("Google sign-in isn't fully configured for this build yet — try Apple, or email & password.");
            return;
          }
          console.info("[auth] starting native Google sign-in");
          const { error } = await signInWithGoogleNative();
          if (error) throw error;
          console.info("[auth] native Google sign-in returned cleanly");
          return;
        }
      }
      // Web fallback — Lovable OAuth broker round-trip.
      const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin });
      if (result.error) throw result.error;
      // result.redirected handled by browser; otherwise tokens set, useEffect navigates
    } catch (err: any) {
      console.error(`[auth] ${provider} sign-in failed`, err);
      // Detect real user-cancellation only — narrow patterns so we don't
      // swallow legit errors like "URL canceled by system" or
      // "user not signed in iCloud". Apple's `ASAuthorizationError.canceled`
      // surfaces as code 1001; the @capgo plugin maps it to the strings
      // matched below. Anything else gets surfaced to the user.
      const msg = String(err?.message || "");
      const code = String(err?.code || (err as any)?.errorMessage || "");
      const userCancelled =
        /user.*cancell?ed|sign.?in.*cancell?ed|the operation was cancelled by the user|ASAuthorizationError.*canceled|com\.apple\.AuthenticationServices.*1001/i
          .test(`${msg} ${code}`);
      if (!userCancelled) {
        toast.error(msg || `Couldn't sign in with ${provider}`);
      }
    } finally {
      setOauthBusy(null);
    }
  };



  if (loading || (user && profileLoading)) {
    return <PageFallback />;
  }

  return (
    <div className="h-[100dvh] w-full bg-background flex justify-center overflow-y-auto overscroll-y-contain no-scrollbar">
      <div className="relative w-full max-w-[400px] min-h-full flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[200px]" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative z-10 flex-1 flex flex-col px-6 pt-16 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
          <p className="eyebrow">DayDraft</p>
          <h1 className="font-display text-[28px] font-semibold mt-3 leading-[1.1] tracking-tight text-balance">
            {awaitingConfirmation ? "Check your email." : mode === "signup" ? "Design your days." : "Welcome back."}
          </h1>
          <p className="text-secondary-fg mt-2.5 text-[13px] leading-[1.55]">
            {awaitingConfirmation
              ? `We sent a confirmation link to ${confirmedFor || email}. Open it to finish creating your account.`
              : mode === "signup"
                ? "Turn raw lists into focused, intelligent schedules."
                : "Pick up where you left off."}
          </p>

          {!awaitingConfirmation ? (
            <>
              {/* space-y-2 (8px) was tight enough that iOS WebView's fuzzy
                  hit-test could deliver a tap on Google to Apple. Bumped to
                  space-y-3 (12px) to clear the fuzziness window. */}
              <div className="mt-8 space-y-3">
                <button onClick={(e) => { if (busy || oauthBusy || oauthBlockedReason) return; oauth("google"); }}
                  className={`w-full h-12 rounded-[14px] bg-background text-foreground border border-border hover:bg-muted/50 pressable pressable-instant text-sm font-medium inline-flex items-center justify-center gap-2 shadow-sm ${oauthBlockedReason || busy || oauthBusy ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={oauthBlockedReason || undefined}>
                  <GoogleIcon /> {oauthBusy === "google" ? "..." : "Continue with Google"}
                </button>
                {(!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") && (
                  <button onClick={(e) => { if (busy || oauthBusy || oauthBlockedReason) return; oauth("apple"); }}
                    className={`w-full h-12 rounded-[14px] bg-foreground text-background hover:opacity-90 pressable pressable-instant text-sm font-medium inline-flex items-center justify-center gap-2 shadow-card ${oauthBlockedReason || busy || oauthBusy ? "opacity-50 cursor-not-allowed" : ""}`}
                    title={oauthBlockedReason || undefined}>
                    <AppleIcon /> {oauthBusy === "apple" ? "..." : "Continue with Apple"}
                  </button>
                )}

                {oauthBlockedReason && (
                  <p className="text-[11px] leading-snug text-secondary-fg/85 px-1 pt-1">
                    {oauthBlockedReason}
                  </p>
                )}
              </div>
              <div className="my-6 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary-fg">
                <div className="flex-1 h-px bg-border/50" />
                <span className="shrink-0">or email</span>
                <div className="flex-1 h-px bg-border/50" />
              </div>

              <form onSubmit={submit} className="space-y-3">
                {mode === "signup" && (
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="h-12 surface-card border-soft rounded-[14px]" />
                )}
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    // If the user changes the email after a pending confirmation,
                    // hide the stale "Check your email at <old>" panel.
                    if (awaitingConfirmation && e.target.value !== confirmedFor) {
                      setAwaitingConfirmation(false);
                    }
                  }}
                  placeholder="Email"
                  className="h-12 surface-card border-soft rounded-[14px]"
                />
                <Input type="password" required minLength={6} value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" className="h-12 surface-card border-soft rounded-[14px]" />
                <Button type="submit" disabled={busy || !!oauthBusy} className="w-full h-12 rounded-[14px] bg-primary text-primary-foreground hover:bg-primary/90 btn-volumetric pressable pressable-instant text-base font-medium shadow-card">
                  {busy ? "..." : mode === "signup" ? "Create account" : "Sign in"}
                </Button>
              </form>

              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setAwaitingConfirmation(false);
                    setMode(mode === "signup" ? "signin" : "signup");
                  }}
                  className="text-secondary-fg text-sm hover:text-foreground transition-colors pressable pressable-instant px-2 py-1 -ml-2 rounded-lg"
                >
                  {mode === "signup" ? "I already have an account" : "Create a new account"}
                </button>
                {mode === "signin" && (
                  <Link to="/forgot-password" className="text-secondary-fg text-sm hover:text-foreground transition-colors">
                    Forgot password?
                  </Link>
                )}
              </div>
            </>
          ) : (
            <div className="mt-10 space-y-3">
              <Button
                type="button"
                onClick={resendConfirmation}
                disabled={resending}
                className="w-full h-12 rounded-[14px] bg-primary text-primary-foreground hover:bg-primary/90 btn-volumetric pressable pressable-instant text-base font-medium shadow-card"
              >
                {resending ? "Sending..." : "Resend confirmation email"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setAwaitingConfirmation(false);
                  setMode("signin");
                }}
                className="w-full text-center text-secondary-fg text-sm hover:text-foreground transition-colors"
              >
                Already confirmed? Sign in
              </button>
              <button
                type="button"
                onClick={() => setAwaitingConfirmation(false)}
                className="w-full text-center text-secondary-fg text-sm hover:text-foreground transition-colors"
              >
                Use a different email
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const GoogleIcon = forwardRef<SVGSVGElement>((_, ref) => (
  <svg ref={ref} width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.7 0 19.5-8.7 19.5-19.5 0-1.2-.1-2.3-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.7 19 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 16.3 4.5 9.7 8.7 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 43.5c5.1 0 9.8-1.9 13.3-5.1l-6.1-5.2C29.2 34.7 26.7 35.5 24 35.5c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.5 39.3 16.2 43.5 24 43.5z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.1 5.2C41.5 34.5 43.5 29.6 43.5 24c0-1.2-.1-2.3-.4-3.5z"/>
  </svg>
));
GoogleIcon.displayName = "GoogleIcon";

const AppleIcon = forwardRef<SVGSVGElement>((_, ref) => (
  <svg ref={ref} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.365 1.43c0 1.14-.42 2.21-1.13 3-.74.83-1.95 1.47-3.13 1.38-.13-1.14.42-2.31 1.12-3.04.78-.81 2.06-1.43 3.14-1.34zM20.5 17.34c-.55 1.27-.81 1.84-1.52 2.97-.99 1.58-2.39 3.55-4.13 3.57-1.55.02-1.95-1.01-4.05-1-2.1.01-2.54 1.02-4.09 1-1.74-.02-3.07-1.79-4.06-3.37C-.05 16.5-.34 11.27 1.41 8.5c1.25-1.97 3.22-3.13 5.07-3.13 1.88 0 3.07 1.04 4.62 1.04 1.51 0 2.42-1.04 4.6-1.04 1.65 0 3.4.9 4.65 2.45-4.08 2.24-3.42 8.06.15 9.52z"/>
  </svg>
));
AppleIcon.displayName = "AppleIcon";
