import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProfile } from "@/hooks/useProfile";
import { ArrowRight, Sparkles } from "lucide-react";
import { enablePush, pushSupported } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
const PROGRESS_KEY = "dd_onboarding_progress_v3";

export default function Onboarding() {
  const initial = (() => {
    try {
      const raw = sessionStorage.getItem(PROGRESS_KEY);
      if (!raw) return { step: 0, aiAbout: "" };
      const p = JSON.parse(raw);
      const step = [0, 1].includes(p.step) ? p.step : 0;
      const aiAbout = typeof p.aiAbout === "string" ? p.aiAbout : "";
      return { step, aiAbout };
    } catch {
      return { step: 0, aiAbout: "" };
    }
  })();

  const [step, setStep] = useState<number>(initial.step);
  const [aiAbout, setAiAbout] = useState(initial.aiAbout);
  const [finishing, setFinishing] = useState(false);
  const { profile, update, refresh } = useProfile();
  const nav = useNavigate();

  useEffect(() => {
    try {
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, aiAbout }));
    } catch { /* ignore */ }
  }, [step, aiAbout]);

  const finish = async (notif: boolean) => {
    if (finishing) return;
    setFinishing(true);
    let enabled = false;
    try {
      if (notif && pushSupported()) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) { await enablePush(session.user.id); enabled = true; }
        } catch (e: any) {
          if (e?.message && !/VAPID|configured/i.test(e.message)) toast(e.message);
        }
      }
      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();
      try { localStorage.setItem("dd_ai_tone", "professional"); } catch { /* ignore */ }
      const payload = {
        ai_tone: "professional" as any,
        ai_context_custom: aiAbout.trim() || null,
        notifications_enabled: enabled,
        onboarded: true,
        timezone: tz,
      };
      if (profile) {
        await update(payload as any);
      } else {
        // No profile row yet (auth trigger missed). Upsert so the user never
        // gets stuck looping back to /onboarding for accounts where the auth
        // trigger didn't fire (e.g. historical sign-ups before the trigger
        // existed, or OAuth flows where the trigger raced with the session).
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (uid) {
          const { error } = await supabase
            .from("profiles")
            .upsert({ id: uid, ...payload } as never, { onConflict: "id" });
          if (error) throw error;
          await refresh();
        }
      }
      try { sessionStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
      nav("/home");
    } catch (e: any) {
      toast.error(e?.message || "Could not finish onboarding. Please try again.");
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-background flex justify-center overflow-y-auto overscroll-y-contain no-scrollbar">
      <div className="relative w-full max-w-[440px] min-h-full flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[240px]" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative z-10 flex-1 flex flex-col px-6 pt-14 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] page-enter" key={step}>
          <div className="flex gap-1.5 mb-8">
            {[0, 1].map((i) => (
              <div key={i} className={`h-[3px] flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-border/70"}`} />
            ))}
          </div>

          {step === 0 && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex flex-col justify-center">
                <p className="eyebrow">DayDraft</p>
                <h1 className="font-display text-[38px] font-semibold leading-[1.05] tracking-tight mt-3 text-balance">
                  Your day, distilled.
                </h1>
                <p className="text-secondary-fg mt-5 text-[15px] leading-[1.55] max-w-sm">
                  Track time, plan tasks your way, ask AI only when you want a nudge.
                </p>
                <div className="mt-6 app-card px-4 py-5 space-y-2 fade-in">
                  <div className="text-[11px] uppercase tracking-wider text-secondary-fg inline-flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Quiet by default
                  </div>
                  <div className="text-[13px] text-subtle">No auto-planning. No noise. You're in control.</div>
                </div>
              </div>
              <Button disabled={finishing} onClick={() => setStep(1)} className="w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium shadow-card">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}



          {step === 1 && (
            <div className="flex-1 flex flex-col min-h-0 items-center text-center fade-in">
              <div className="relative w-28 h-28 flex items-center justify-center mb-6 mt-2">
                {/* Aura layers */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/60 via-purple-500/50 to-blue-500/60 blur-[18px] ai-blob-1" />
                <div className="absolute inset-1 rounded-full bg-gradient-to-bl from-accent/70 via-primary/50 to-indigo-400/60 blur-[14px] ai-blob-2" />
                <div className="absolute inset-3 rounded-full bg-primary/40 blur-[10px] ai-blob-3" />

                {/* Core floating element */}
                <div className="relative z-10 w-14 h-14 rounded-[1.25rem] bg-background/90 border border-soft backdrop-blur-xl flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.12)]" style={{ animation: 'deepFloat 4s ease-in-out infinite' }}>
                  <Sparkles className="h-6 w-6 text-primary" style={{ animation: 'softBreathe 3s ease-in-out infinite' }} />
                </div>
              </div>
              
              <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-balance">
                Teach the AI about you
              </h1>
              <p className="text-secondary-fg mt-3 text-[13.5px] leading-[1.55] max-w-xs mx-auto text-balance">
                This context is secretly passed to the AI every time you plan your day, so your schedules fit your actual lifestyle.
              </p>
              <div className="mt-7 flex-1 min-h-0 w-full text-left">
                <Textarea
                  value={aiAbout}
                  onChange={(e) => setAiAbout(e.target.value)}
                  placeholder="e.g. I work from home, I have a dog that needs walking at 1pm, and I prefer to avoid hard tasks after 4pm."
                  maxLength={500}
                  className="min-h-[120px] surface-card border-soft rounded-xl text-[13.5px] resize-none"
                />
                <p className="mt-1.5 text-[10.5px] text-secondary-fg/80">{aiAbout.length}/500</p>
              </div>
              <Button disabled={finishing} onClick={() => finish(true)} className="w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium mt-5 shadow-card shrink-0">
                Enable smart planning
              </Button>
              <button disabled={finishing} onClick={() => finish(false)} className="mt-4 pb-2 text-secondary-fg text-[13px] hover:text-foreground transition-colors mx-auto disabled:opacity-60 disabled:pointer-events-none">
                Skip for now
              </button>
            </div>
          )}

          {step > 0 && (
            <button
              type="button"
              disabled={finishing}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="mt-4 text-[12px] text-secondary-fg hover:text-foreground mx-auto disabled:opacity-50 disabled:pointer-events-none"
            >
              Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
