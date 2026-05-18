import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProfile } from "@/hooks/useProfile";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { enablePush, pushSupported } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TONE_OPTIONS, type Tone } from "@/lib/tone";

const PROGRESS_KEY = "dd_onboarding_progress_v3";
const TONE_KEYS = TONE_OPTIONS.map((o) => o.key);

export default function Onboarding() {
  const initial = (() => {
    try {
      const raw = sessionStorage.getItem(PROGRESS_KEY);
      if (!raw) return { step: 0, tone: "professional" as Tone, aiAbout: "" };
      const p = JSON.parse(raw);
      const step = [0, 1, 2].includes(p.step) ? p.step : 0;
      const tone = TONE_KEYS.includes(p.tone) ? (p.tone as Tone) : ("professional" as Tone);
      const aiAbout = typeof p.aiAbout === "string" ? p.aiAbout : "";
      return { step, tone, aiAbout };
    } catch {
      return { step: 0, tone: "professional" as Tone, aiAbout: "" };
    }
  })();

  const [step, setStep] = useState<number>(initial.step);
  const [tone, setTone] = useState<Tone>(initial.tone);
  const [aiAbout, setAiAbout] = useState(initial.aiAbout);
  const [finishing, setFinishing] = useState(false);
  const { update } = useProfile();
  const nav = useNavigate();

  useEffect(() => {
    try {
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, tone, aiAbout }));
    } catch { /* ignore */ }
  }, [step, tone, aiAbout]);

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
      try { localStorage.setItem("dd_ai_tone", tone); } catch { /* ignore */ }
      await update({
        ai_tone: tone as any,
        ai_context_custom: aiAbout.trim() || null,
        notifications_enabled: enabled,
        onboarded: true,
        timezone: tz,
      } as any);
      try { sessionStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
      nav("/home");
    } catch (e: any) {
      toast.error(e?.message || "Could not finish onboarding. Please try again.");
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[440px] min-h-screen flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[240px]" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative z-10 flex-1 flex flex-col px-6 pt-14 pb-10 page-enter" key={step}>
          <div className="flex gap-1.5 mb-8">
            {[0, 1, 2].map((i) => (
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
            <div className="flex-1 flex flex-col">
              <p className="eyebrow">Step 2 of 3</p>
              <h1 className="font-display text-[26px] font-semibold leading-tight mt-2 tracking-tight text-balance">
                Pick the AI voice
              </h1>
              <p className="text-secondary-fg mt-2 text-[13px] leading-[1.55]">
                Used only when you ask for help.
              </p>
              <div className="space-y-2 mt-5 flex-1 overflow-y-auto">
                {TONE_OPTIONS.map((e) => {
                  const active = tone === e.key;
                  return (
                    <button
                      key={e.key}
                      onClick={() => setTone(e.key)}
                      className={`w-full flex items-center gap-3 p-3.5 rounded-[16px] border pressable transition-all backdrop-blur-sm ${active ? "border-accent surface-accent" : "border-soft surface-card hover:border-strong"}`}
                    >
                      <span className="text-lg">{e.emoji}</span>
                      <div className="flex-1 text-left">
                        <div className="font-medium text-[14px]">{e.title}</div>
                        <div className="text-[11.5px] text-secondary-fg leading-snug mt-0.5">{e.sub}</div>
                      </div>
                      <span className={`h-[18px] w-[18px] rounded-full border flex items-center justify-center transition-all shrink-0 ${active ? "border-primary bg-primary" : "border-soft"}`}>
                        {active && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Button disabled={finishing} onClick={() => setStep(2)} className="w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium mt-5 shadow-card">
                Continue
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="flex-1 flex flex-col min-h-0">
              <p className="eyebrow">Step 3 of 3</p>
              <h1 className="font-display text-[26px] font-semibold leading-tight mt-2 tracking-tight text-balance">
                A line about you (optional)
              </h1>
              <p className="text-secondary-fg mt-2 text-[13px] leading-[1.55]">
                Helps AI answers land right. Skip if you'd rather not.
              </p>
              <div className="mt-5 flex-1 min-h-0">
                <Textarea
                  value={aiAbout}
                  onChange={(e) => setAiAbout(e.target.value)}
                  placeholder="e.g. I'm a parent of a 4yo, work remote, prefer deep work after lunch."
                  maxLength={500}
                  className="min-h-[120px] surface-card border-soft rounded-xl text-[13px] resize-none"
                />
                <p className="mt-1 text-[10px] text-secondary-fg">{aiAbout.length}/500</p>
              </div>
              <Button disabled={finishing} onClick={() => finish(true)} className="w-full h-[52px] rounded-[16px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium mt-5 shadow-card shrink-0">
                Enable nudges & finish
              </Button>
              <button disabled={finishing} onClick={() => finish(false)} className="mt-3 text-secondary-fg text-[13px] hover:text-foreground transition-colors mx-auto disabled:opacity-60 disabled:pointer-events-none">
                Finish without nudges
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
