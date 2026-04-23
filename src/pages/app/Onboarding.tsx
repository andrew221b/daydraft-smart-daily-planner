import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Blobs } from "@/components/app/Blobs";
import { useProfile } from "@/hooks/useProfile";
import { Check, Bell } from "lucide-react";
import { enablePush, pushSupported } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const energies = [
  { key: "morning" as const, emoji: "🌅", title: "Morning person", sub: "Peak 8am – 12pm" },
  { key: "midday" as const, emoji: "☀️", title: "Midday flow", sub: "Peak 11am – 3pm" },
  { key: "night" as const, emoji: "🌙", title: "Night owl", sub: "Peak 7pm – 11pm" },
];

const PROGRESS_KEY = "dd_onboarding_progress";

export default function Onboarding() {
  // Restore in-progress onboarding so refresh mid-flow doesn't lose the user.
  const initial = (() => {
    try {
      const raw = sessionStorage.getItem(PROGRESS_KEY);
      if (!raw) return { step: 0, pick: "morning" as const };
      const p = JSON.parse(raw);
      const step = [0,1,2].includes(p.step) ? p.step : 0;
      const pick = ["morning","midday","night"].includes(p.pick) ? p.pick : "morning";
      return { step, pick };
    } catch { return { step: 0, pick: "morning" as const }; }
  })();
  const [step, setStep] = useState<number>(initial.step);
  const [pick, setPick] = useState<"morning" | "midday" | "night">(initial.pick);
  const { update } = useProfile();
  const nav = useNavigate();

  useEffect(() => {
    try { sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, pick })); } catch {/* ignore */}
  }, [step, pick]);

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
        // Push isn't configured yet (no VAPID) or user denied — keep onboarding moving.
        if (e?.message && !/VAPID|configured/i.test(e.message)) toast(e.message);
      }
    }
    const tz = (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; }
    })();
    await update({ energy_preference: pick, notifications_enabled: enabled, onboarded: true, timezone: tz });
    try { sessionStorage.removeItem(PROGRESS_KEY); } catch {/* ignore */}
    nav("/today");
  };

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[390px] min-h-screen flex flex-col">
        <Blobs />
        <div className="relative z-10 flex-1 flex flex-col px-6 pt-16 pb-10 page-enter" key={step}>
          <div className="flex gap-1.5 mb-10">
            {[0,1,2].map(i => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-border"}`} />
            ))}
          </div>

          {step === 0 && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex flex-col justify-center">
                <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">Your day,<br/>designed.</h1>
                <p className="text-secondary-fg mt-5 text-lg leading-relaxed">DayDraft turns your messy task list into a focused, intelligent schedule.</p>
              </div>
              <Button onClick={() => setStep(1)} className="w-full h-13 py-3.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 pressable text-base font-medium shadow-glow">
                Get Started
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="flex-1 flex flex-col">
              <h1 className="text-3xl font-semibold leading-tight">When are you sharpest?</h1>
              <p className="text-secondary-fg mt-2">We'll schedule deep work around your peak hours.</p>
              <div className="space-y-3 mt-8 flex-1">
                {energies.map(e => {
                  const active = pick === e.key;
                  return (
                    <button key={e.key} onClick={() => setPick(e.key)}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 pressable transition-all ${active ? "border-primary bg-surface-elevated shadow-glow" : "border-border bg-surface"}`}>
                      <span className="text-2xl">{e.emoji}</span>
                      <div className="flex-1 text-left">
                        <div className="font-medium">{e.title}</div>
                        <div className="text-sm text-secondary-fg">{e.sub}</div>
                      </div>
                      <span className={`h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all ${active ? "border-primary bg-primary" : "border-border"}`}>
                        {active && <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Button onClick={() => setStep(2)} className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 pressable text-base font-medium shadow-glow mt-6">
                Continue
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="relative h-32 w-20 rounded-[28px] border-2 border-border bg-surface flex items-center justify-center mb-8">
                  <div className="absolute -top-3 -right-10 px-3 py-2 bg-primary rounded-xl shadow-glow text-xs font-medium text-primary-foreground ring-pulse flex items-center gap-1.5">
                    <Bell className="h-3 w-3" /> 8:00
                  </div>
                  <div className="h-1 w-8 rounded-full bg-border" />
                </div>
                <h1 className="text-3xl font-semibold leading-tight">Stay on track</h1>
                <p className="text-secondary-fg mt-2 max-w-xs">DayDraft sends one morning nudge to start your day.</p>
              </div>
              <Button onClick={() => finish(true)} className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 pressable text-base font-medium shadow-glow">
                Enable Notifications
              </Button>
              <button onClick={() => finish(false)} className="mt-4 text-secondary-fg text-sm hover:text-foreground transition-colors">Maybe Later</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
