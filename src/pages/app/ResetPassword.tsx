import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ResetPassword() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    // Supabase puts tokens in the URL hash for recovery flows. Detect a recovery session.
    const sub = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => sub.data.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) return toast.error("Password must be at least 6 characters");
    if (pw !== pw2) return toast.error("Passwords don't match");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      toast.success("Password updated");
      nav("/today", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Couldn't update password");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[400px] min-h-screen flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[200px]" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative z-10 flex-1 flex flex-col px-6 pt-16 pb-10">
          <h1 className="font-display text-[26px] font-semibold leading-tight text-balance">New password</h1>
          <p className="text-secondary-fg mt-2.5 text-[13px] leading-[1.55]">
            {ready ? "Pick something you'll remember." : "Verifying reset link..."}
          </p>
          {ready && (
            <form onSubmit={submit} className="mt-9 space-y-3">
              <Input type="password" required minLength={6} value={pw} onChange={e => setPw(e.target.value)} placeholder="New password"
                className="h-12 surface-card border-soft rounded-[14px]" />
              <Input type="password" required minLength={6} value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Confirm password"
                className="h-12 surface-card border-soft rounded-[14px]" />
              <Button type="submit" disabled={busy} className="w-full h-12 rounded-[14px] bg-primary text-primary-foreground hover:bg-primary/90 pressable text-base font-medium shadow-card">
                {busy ? "..." : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}