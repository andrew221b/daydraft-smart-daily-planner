import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Blobs } from "@/components/app/Blobs";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";

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
              <form onSubmit={submit} className="mt-10 space-y-3">
                {mode === "signup" && (
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="h-12 bg-surface border-border rounded-xl" />
                )}
                <Input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="h-12 bg-surface border-border rounded-xl" />
                <Input type="password" required minLength={6} value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" className="h-12 bg-surface border-border rounded-xl" />
                <Button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 pressable text-base font-medium shadow-glow">
                  {busy ? "..." : mode === "signup" ? "Create account" : "Sign in"}
                </Button>
              </form>

              <button
                onClick={() => {
                  setAwaitingConfirmation(false);
                  setMode(mode === "signup" ? "signin" : "signup");
                }}
                className="mt-6 text-secondary-fg text-sm hover:text-foreground transition-colors"
              >
                {mode === "signup" ? "I already have an account" : "Create a new account"}
              </button>
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
