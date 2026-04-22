import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Blobs } from "@/components/app/Blobs";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { Fingerprint } from "lucide-react";
import { getStoredPasskey, passkeySupported, verifyPasskey } from "@/lib/passkeys";

export default function Auth() {
  const { user, loading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [resending, setResending] = useState(false);
  const nav = useNavigate();
  const stored = typeof window !== "undefined" ? getStoredPasskey() : null;
  const canUsePasskey = passkeySupported() && !!stored;

  useEffect(() => {
    if (loading || (user && profileLoading)) return;
    if (!user) return;
    nav(profile?.onboarded ? "/today" : "/onboarding", { replace: true });
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

  const oauth = async (provider: "google" | "apple") => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin });
      if (result.error) throw result.error;
      // result.redirected handled by browser; otherwise tokens set, useEffect navigates
    } catch (err: any) {
      toast.error(err.message || `Couldn't sign in with ${provider}`);
      setBusy(false);
    }
  };

  const passkeyLogin = async () => {
    setBusy(true);
    try {
      const { ok, userEmail } = await verifyPasskey();
      if (!ok || !userEmail) throw new Error("Couldn't verify");
      // Passkey verifies device identity; for now, prefill email and ask for password.
      // (Full passwordless requires server-side challenge — out of scope here.)
      setEmail(userEmail);
      setMode("signin");
      toast.success("Identity verified — enter your password to continue");
    } catch (e: any) {
      toast.error("Face ID / fingerprint failed");
    } finally { setBusy(false); }
  };

  if (loading || (user && profileLoading)) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[390px] min-h-screen flex flex-col">
        <Blobs />
        <div className="relative z-10 flex-1 flex flex-col px-6 pt-20 pb-10">
          <div className="text-secondary-fg text-sm tracking-widest uppercase">DayDraft</div>
          <h1 className="text-4xl font-semibold mt-3 leading-tight">
            {awaitingConfirmation ? "Check your email." : mode === "signup" ? "Design your days." : "Welcome back."}
          </h1>
          <p className="text-secondary-fg mt-2">
            {awaitingConfirmation
              ? `We sent a confirmation link to ${email}. Open it to finish creating your account.`
              : mode === "signup"
                ? "Turn raw lists into focused, intelligent schedules."
                : "Pick up where you left off."}
          </p>

          {!awaitingConfirmation ? (
            <>
              <div className="mt-8 space-y-2">
                <button onClick={() => oauth("google")} disabled={busy}
                  className="w-full h-12 rounded-xl bg-surface-elevated border border-border text-foreground hover:bg-surface pressable text-sm font-medium inline-flex items-center justify-center gap-2">
                  <GoogleIcon /> Continue with Google
                </button>
                <button onClick={() => oauth("apple")} disabled={busy}
                  className="w-full h-12 rounded-xl bg-foreground text-background hover:opacity-90 pressable text-sm font-medium inline-flex items-center justify-center gap-2">
                  <AppleIcon /> Continue with Apple
                </button>
                {canUsePasskey && (
                  <button onClick={passkeyLogin} disabled={busy}
                    className="w-full h-12 rounded-xl bg-surface border border-primary/30 text-primary hover:bg-surface-elevated pressable text-sm font-medium inline-flex items-center justify-center gap-2">
                    <Fingerprint className="h-4 w-4" /> Use Face ID / fingerprint
                  </button>
                )}
              </div>
              <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-secondary-fg">
                <div className="flex-1 h-px bg-border" />
                <span>or continue with email</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <form onSubmit={submit} className="space-y-3">
                {mode === "signup" && (
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="h-12 bg-surface border-border rounded-xl" />
                )}
                <Input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="h-12 bg-surface border-border rounded-xl" />
                <Input type="password" required minLength={6} value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" className="h-12 bg-surface border-border rounded-xl" />
                <Button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 pressable text-base font-medium shadow-glow">
                  {busy ? "..." : mode === "signup" ? "Create account" : "Sign in"}
                </Button>
              </form>

              <div className="mt-6 flex items-center justify-between">
                <button
                  onClick={() => {
                    setAwaitingConfirmation(false);
                    setMode(mode === "signup" ? "signin" : "signup");
                  }}
                  className="text-secondary-fg text-sm hover:text-foreground transition-colors"
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
                className="w-full h-12 rounded-xl bg-surface border border-border text-foreground hover:bg-surface pressable text-base font-medium"
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
