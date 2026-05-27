import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProfile } from "@/hooks/useProfile";
import { ArrowRight, Sparkles, Sun, Moon, Tag, Check } from "lucide-react";
import { enablePush, pushSupported } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";

const PROGRESS_KEY = "dd_onboarding_progress_v4";
const STEPS = 4;
type StepIdx = 0 | 1 | 2 | 3;

const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";

const CATEGORY_SUGGESTIONS: Array<{ name: string; color: string }> = [
  { name: "Design", color: "#7C3AED" },
  { name: "Development", color: "#0EA5E9" },
  { name: "Writing", color: "#F59E0B" },
  { name: "Client work", color: "#10B981" },
  { name: "Meetings", color: "#EC4899" },
  { name: "Study", color: "#6366F1" },
  { name: "Admin", color: "#64748B" },
  { name: "Side project", color: "#F43F5E" },
];

type Progress = {
  step: StepIdx;
  aiAbout: string;
  hoursStart: string;
  hoursEnd: string;
  categoryName: string;
  categoryColor: string;
};

const readProgress = (): Progress => {
  try {
    const raw = sessionStorage.getItem(PROGRESS_KEY);
    if (!raw) throw new Error("empty");
    const p = JSON.parse(raw) as Partial<Progress>;
    return {
      step: ([0, 1, 2, 3] as StepIdx[]).includes(p.step as StepIdx) ? (p.step as StepIdx) : 0,
      aiAbout: typeof p.aiAbout === "string" ? p.aiAbout : "",
      hoursStart: typeof p.hoursStart === "string" ? p.hoursStart : DEFAULT_START,
      hoursEnd: typeof p.hoursEnd === "string" ? p.hoursEnd : DEFAULT_END,
      categoryName: typeof p.categoryName === "string" ? p.categoryName : "",
      categoryColor: typeof p.categoryColor === "string" ? p.categoryColor : CATEGORY_SUGGESTIONS[0].color,
    };
  } catch {
    return {
      step: 0,
      aiAbout: "",
      hoursStart: DEFAULT_START,
      hoursEnd: DEFAULT_END,
      categoryName: "",
      categoryColor: CATEGORY_SUGGESTIONS[0].color,
    };
  }
};

export default function Onboarding() {
  const initial = useMemo(readProgress, []);
  const [step, setStep] = useState<StepIdx>(initial.step);
  const [aiAbout, setAiAbout] = useState(initial.aiAbout);
  const [hoursStart, setHoursStart] = useState(initial.hoursStart);
  const [hoursEnd, setHoursEnd] = useState(initial.hoursEnd);
  const [categoryName, setCategoryName] = useState(initial.categoryName);
  const [categoryColor, setCategoryColor] = useState(initial.categoryColor);
  const [finishing, setFinishing] = useState(false);

  const { profile, update, refresh } = useProfile();
  const nav = useNavigate();

  useEffect(() => {
    try {
      const snapshot: Progress = { step, aiAbout, hoursStart, hoursEnd, categoryName, categoryColor };
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore — sessionStorage can fail in private mode */
    }
  }, [step, aiAbout, hoursStart, hoursEnd, categoryName, categoryColor]);

  const next = (s: StepIdx) => {
    haptics.selection();
    setStep(s);
  };

  const finish = async (notif: boolean) => {
    if (finishing) return;
    setFinishing(true);
    let pushEnabled = false;
    try {
      if (notif && pushSupported()) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            await enablePush(session.user.id);
            pushEnabled = true;
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : null;
          if (msg && !/VAPID|configured/i.test(msg)) toast(msg);
        }
      }

      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();
      try { localStorage.setItem("dd_ai_tone", "professional"); } catch { /* ignore */ }

      const payload = {
        ai_tone: "professional",
        ai_context_custom: aiAbout.trim() || null,
        notifications_enabled: pushEnabled,
        onboarded: true,
        timezone: tz,
        active_hours_start: hoursStart,
        active_hours_end: hoursEnd,
      };

      // Profile update
      if (profile) {
        await update(payload as never);
      } else {
        // No profile row yet (auth trigger missed). Upsert so the user never
        // gets stuck looping back here on accounts where the trigger raced
        // with the OAuth session.
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

      // First category (best-effort — never block onboarding on a failure here).
      const trimmedCat = categoryName.trim();
      if (trimmedCat) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const uid = session?.user?.id;
          if (uid) {
            await supabase.from("time_categories").insert({
              user_id: uid,
              name: trimmedCat,
              color: categoryColor,
            } as never);
          }
        } catch (e) {
          console.warn("[onboarding] first category insert failed", e);
        }
      }

      try { sessionStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
      haptics.notify("success");
      nav("/home");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not finish onboarding. Please try again.";
      toast.error(msg);
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
            {Array.from({ length: STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${
                  i <= step ? "bg-primary" : "bg-border/70"
                }`}
              />
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
              <Button
                disabled={finishing}
                onClick={() => next(1)}
                className="w-full h-[52px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium shadow-card"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="flex-1 flex flex-col fade-in">
              <div className="flex-1 flex flex-col justify-center">
                <p className="eyebrow">Working hours</p>
                <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight mt-2 text-balance">
                  When does your day usually run?
                </h1>
                <p className="text-secondary-fg mt-3 text-[14px] leading-[1.55] max-w-xs">
                  AI uses this to schedule deep work inside your real day, not random hours.
                  You can change it anytime in Settings.
                </p>

                <div className="mt-7 grid grid-cols-2 gap-3">
                  <label className="app-card px-4 py-3.5 space-y-1.5 block">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70 inline-flex items-center gap-1.5">
                      <Sun className="h-3 w-3 text-amber-400" /> Start
                    </span>
                    <input
                      type="time"
                      value={hoursStart}
                      onChange={(e) => setHoursStart(e.target.value || DEFAULT_START)}
                      className="w-full bg-transparent text-[20px] font-display font-semibold tabular-nums tracking-tight focus:outline-none"
                    />
                  </label>
                  <label className="app-card px-4 py-3.5 space-y-1.5 block">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-secondary-fg/70 inline-flex items-center gap-1.5">
                      <Moon className="h-3 w-3 text-indigo-400" /> End
                    </span>
                    <input
                      type="time"
                      value={hoursEnd}
                      onChange={(e) => setHoursEnd(e.target.value || DEFAULT_END)}
                      className="w-full bg-transparent text-[20px] font-display font-semibold tabular-nums tracking-tight focus:outline-none"
                    />
                  </label>
                </div>
              </div>
              <Button
                disabled={finishing}
                onClick={() => next(2)}
                className="w-full h-[52px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium shadow-card"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="flex-1 flex flex-col fade-in">
              <div className="flex-1 flex flex-col justify-center">
                <p className="eyebrow">First category</p>
                <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight mt-2 text-balance">
                  What do you track time on?
                </h1>
                <p className="text-secondary-fg mt-3 text-[14px] leading-[1.55] max-w-xs">
                  Pick a starter — you can rename, add more, or set hourly rates later. Skip if you'd rather start fresh.
                </p>

                <div className="mt-6 flex flex-wrap gap-1.5">
                  {CATEGORY_SUGGESTIONS.map((s) => {
                    const selected = categoryName === s.name;
                    return (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => {
                          haptics.selection();
                          setCategoryName(s.name);
                          setCategoryColor(s.color);
                        }}
                        className={[
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-[border-color,background-color,transform] pressable",
                          selected
                            ? "border-transparent bg-primary/12 text-foreground shadow-[0_0_0_1.5px_hsl(var(--primary)/0.45),0_8px_18px_-12px_hsl(var(--primary)/0.5)]"
                            : "border-border/40 bg-card/45 text-foreground/80 hover:border-border/65 hover:bg-card/65",
                        ].join(" ")}
                      >
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                        {s.name}
                        {selected && <Check className="h-3 w-3 text-primary" strokeWidth={3} />}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 app-card px-3.5 py-3 flex items-center gap-2.5">
                  <Tag className="h-3.5 w-3.5 text-secondary-fg shrink-0" />
                  <Input
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    placeholder="Or type your own…"
                    className="flex-1 h-8 bg-transparent border-0 px-0 text-[14px] focus-visible:ring-0 shadow-none"
                    maxLength={40}
                  />
                </div>
              </div>
              <Button
                disabled={finishing}
                onClick={() => next(3)}
                className="w-full h-[52px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium shadow-card"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
              <button
                type="button"
                disabled={finishing}
                onClick={() => { setCategoryName(""); next(3); }}
                className="mt-3 text-[12px] text-secondary-fg hover:text-foreground mx-auto disabled:opacity-50 disabled:pointer-events-none"
              >
                Skip
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="flex-1 flex flex-col min-h-0 items-center text-center fade-in">
              <div className="relative w-28 h-28 flex items-center justify-center mb-6 mt-2">
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/60 via-purple-500/50 to-blue-500/60 blur-[18px] ai-blob-1" />
                <div className="absolute inset-1 rounded-full bg-gradient-to-bl from-accent/70 via-primary/50 to-indigo-400/60 blur-[14px] ai-blob-2" />
                <div className="absolute inset-3 rounded-full bg-primary/40 blur-[10px] ai-blob-3" />
                <div className="relative z-10 w-14 h-14 rounded-[1.25rem] bg-background/90 border border-soft backdrop-blur-xl flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.12)]" style={{ animation: "deepFloat 4s ease-in-out infinite" }}>
                  <Sparkles className="h-6 w-6 text-primary" style={{ animation: "softBreathe 3s ease-in-out infinite" }} />
                </div>
              </div>

              <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-balance">
                Teach the AI about you
              </h1>
              <p className="text-secondary-fg mt-3 text-[14px] leading-[1.55] max-w-xs mx-auto text-balance">
                This context is secretly passed to the AI every time you plan your day, so your schedules fit your actual lifestyle.
              </p>
              <div className="mt-7 flex-1 min-h-0 w-full text-left">
                <Textarea
                  value={aiAbout}
                  onChange={(e) => setAiAbout(e.target.value)}
                  placeholder="e.g. I work from home, I have a dog that needs walking at 1pm, and I prefer to avoid hard tasks after 4pm."
                  maxLength={500}
                  className="min-h-[120px] surface-card border-soft rounded-xl text-[14px] resize-none"
                />
                <p className="mt-1.5 text-[11px] text-secondary-fg/80">{aiAbout.length}/500</p>
              </div>
              <Button
                disabled={finishing}
                onClick={() => finish(true)}
                className="w-full h-[52px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-medium mt-5 shadow-card shrink-0"
              >
                Enable smart planning
              </Button>
              <button
                type="button"
                disabled={finishing}
                onClick={() => finish(false)}
                className="mt-4 pb-2 text-secondary-fg text-[13px] hover:text-foreground transition-colors mx-auto disabled:opacity-60 disabled:pointer-events-none"
              >
                Skip for now
              </button>
            </div>
          )}

          {step > 0 && (
            <button
              type="button"
              disabled={finishing}
              onClick={() => setStep((s) => Math.max(0, (s - 1) as StepIdx) as StepIdx)}
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
