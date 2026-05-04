import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
// Blobs removed in pro redesign — clean surface only.
import { useProfile } from "@/hooks/useProfile";
import { Check } from "lucide-react";
import { enablePush, pushSupported } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TONE_OPTIONS, type Tone } from "@/lib/tone";

const PROGRESS_KEY = "dd_onboarding_progress";
const TONE_KEYS = TONE_OPTIONS.map(o => o.key);

export default function Onboarding() {
  // Onboarding is intentionally minimal — busy pros don't have patience for
  // 5-step flows. Two steps: welcome + tone choice (also enables notifications
  // inline). Energy-of-day was removed — it just nagged users.
  const initial = (() => {
    try {
      const raw = sessionStorage.getItem(PROGRESS_KEY);
      if (!raw) return { step: 0, tone: "professional" as Tone };
      const p = JSON.parse(raw);
      const step = [0, 1].includes(p.step) ? p.step : 0;
      const tone = TONE_KEYS.includes(p.tone) ? (p.tone as Tone) : ("professional" as Tone);
      return { step, tone };
    } catch { return { step: 0, tone: "professional" as Tone }; }
  })();
  const [step, setStep] = useState<number>(initial.step);
  const [tone, setTone] = useState<Tone>(initial.tone);
  const { update } = useProfile();
  const nav = useNavigate();

  useEffect(() => {
    try { sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, tone })); } catch {/* ignore */}
  }, [step, tone]);

  const finish = async (notif: boolean) => {
    let enabled = false;
    if (notif && pushSupported()) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await enablePush(session.user.id);
          enabled = true;
        }
      } catch (e: any) {
        if (e?.message && !/VAPID|configured/i.test(e.message)) toast(e.message);
      }
    }
    const tz = (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; }
    })();
    try { localStorage.setItem("dd_ai_tone", tone); } catch {/* ignore */}
    await update({
      ai_tone: tone as any,
      notifications_enabled: enabled,
      onboarded: true,
      timezone: tz,
    } as any);
    try { sessionStorage.removeItem(PROGRESS_KEY); } catch {/* ignore */}
    nav("/today");
  };

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[400px] min-h-screen flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[200px]" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative z-10 flex-1 flex flex-col px-6 pt-14 pb-10 page-enter" key={step}>
          <div className="flex gap-1.5 mb-9">
            {[0,1].map(i => (
              <div key={i} className={`h-[3px] flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-border/70"}`} />
            ))}
          </div>

          {step === 0 && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex flex-col justify-center">
                <p className="eyebrow">DayDraft</p>
                <h1 className="font-display text-[40px] font-semibold leading-[1.05] tracking-tight mt-3 text-balance">Your day, designed.</h1>
                <p className="text-secondary-fg mt-5 text-[15px] leading-[1.55] max-w-sm">
                  Built for focused professionals. Add your tasks and get a realistic schedule in seconds.{" "}
                  <span className="text-subtle">Four tabs at the bottom</span> guide you through planning, focus, history, and settings.
                </p>
              </div>
              <Button onClick={() => setStep(1)} className="w-full h-12 rounded-[14px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium shadow-card">
                Get started
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="flex-1 flex flex-col">
              <p className="eyebrow">Step 2 of 2</p>
              <h1 className="font-display text-[26px] font-semibold leading-tight mt-2 tracking-tight text-balance">How should we talk to you?</h1>
              <p className="text-secondary-fg mt-2 text-[13px] leading-[1.55]">This style is applied to plans, nudges, AI help, and recap insights. You can change it anytime in Settings.</p>
              <div className="space-y-2 mt-6 flex-1 overflow-y-auto">
                {TONE_OPTIONS.map(e => {
                  const active = tone === e.key;
                  return (
                    <button key={e.key} onClick={() => setTone(e.key)}
                      className={`w-full flex items-center gap-3 p-3.5 rounded-[16px] border pressable transition-all backdrop-blur-sm ${active ? "border-accent surface-accent" : "border-soft surface-card hover:border-strong"}`}>
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
              <Button onClick={() => finish(true)} className="w-full h-12 rounded-[14px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium mt-5 shadow-card">
                Enable nudges & continue
              </Button>
              <button onClick={() => finish(false)} className="mt-3 text-secondary-fg text-[13px] hover:text-foreground transition-colors mx-auto">Skip nudges</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
