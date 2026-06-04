import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast.success("Check your email for a reset link");
    } catch (err) {
      toast.error(err.message || "Something went wrong");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[400px] min-h-screen flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[200px]" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative z-10 flex-1 flex flex-col px-6 pt-16 pb-10">
          <button onClick={() => nav("/auth")} className="inline-flex items-center gap-1 text-[13px] text-secondary-fg hover:text-foreground pressable">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h1 className="font-display text-[26px] font-semibold mt-6 leading-tight text-balance">Reset password</h1>
          <p className="text-secondary-fg mt-2.5 text-[13px] leading-[1.55]">
            {sent ? `Reset link sent to ${email}. Open it on this device.` : "We'll email you a link to set a new password."}
          </p>

          {!sent && (
            <form onSubmit={submit} className="mt-9 space-y-3">
              <Input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email"
                className="h-12 surface-card border-soft rounded-[14px]" />
              <Button type="submit" disabled={busy} className="w-full h-12 rounded-[14px] bg-primary text-primary-foreground hover:bg-primary/90 pressable text-base font-medium shadow-card">
                {busy ? "..." : "Send reset link"}
              </Button>
            </form>
          )}

          {sent && (
            <Button onClick={() => nav("/auth")} variant="outline" className="mt-8 h-12 rounded-[14px] border-soft">
              Back to sign in
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}