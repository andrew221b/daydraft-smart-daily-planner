import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Blobs } from "@/components/app/Blobs";
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
      <div className="relative w-full max-w-[390px] min-h-screen flex flex-col">
        <Blobs />
        <div className="relative z-10 flex-1 flex flex-col px-6 pt-16 pb-10 page-enter" key={step}>
          <div className="flex gap-1.5 mb-10">
            {[0,1].map(i => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-border"}`} />
            ))}
          </div>

          {step === 0 && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex flex-col justify-center">
                <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">Your day,<br/>designed.</h1>
                <p className="text-secondary-fg mt-5 text-lg leading-relaxed">For busy pros. Drop your tasks, get a focused, intelligent schedule.</p>
              </div>
              <Button onClick={() => setStep(1)} className="w-full h-13 py-3.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 pressable text-base font-medium shadow-glow">
                Get started
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="flex-1 flex flex-col">
              <h1 className="text-3xl font-semibold leading-tight">How should we talk to you?</h1>
              <p className="text-secondary-fg mt-2">Sets the tone for nudges, plans and recaps. Change anytime in Settings.</p>
              <div className="space-y-2 mt-6 flex-1 overflow-y-auto">
                {TONE_OPTIONS.map(e => {
                  const active = tone === e.key;
                  return (
                    <button key={e.key} onClick={() => setTone(e.key)}
                      className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 pressable transition-all ${active ? "border-primary bg-surface-elevated shadow-glow" : "border-border bg-surface"}`}>
                      <span className="text-xl">{e.emoji}</span>
                      <div className="flex-1 text-left">
                        <div className="font-medium text-[15px]">{e.title}</div>
                        <div className="text-[12px] text-secondary-fg leading-snug">{e.sub}</div>
                      </div>
                      <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${active ? "border-primary bg-primary" : "border-border"}`}>
                        {active && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Button onClick={() => finish(true)} className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 pressable text-base font-medium shadow-glow mt-4">
                Enable nudges & continue
              </Button>
              <button onClick={() => finish(false)} className="mt-3 text-secondary-fg text-sm hover:text-foreground transition-colors mx-auto">Skip nudges</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
