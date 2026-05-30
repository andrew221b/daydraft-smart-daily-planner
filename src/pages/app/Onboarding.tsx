import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProfile, writeOnboardedFlag } from "@/hooks/useProfile";
import {
  ArrowRight,
  Sparkles,
  ChevronLeft,
  Square,
  FileDown,
  Wallet,
  Zap,
  Compass,
  Layers,
  ChevronDown,
  Star,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { enablePush, pushSupported } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";

const PROGRESS_KEY = "dd_onboarding_progress_v6";
const STEPS = 3;
type StepIdx = 0 | 1 | 2;

type Progress = {
  step: StepIdx;
  aiAbout: string;
};

const readProgress = (): Progress => {
  try {
    const raw = sessionStorage.getItem(PROGRESS_KEY);
    if (!raw) throw new Error("empty");
    const p = JSON.parse(raw) as Partial<Progress>;
    const validStep = ([0, 1, 2] as StepIdx[]).includes(p.step as StepIdx);
    return {
      step: validStep ? (p.step as StepIdx) : 0,
      aiAbout: typeof p.aiAbout === "string" ? p.aiAbout : "",
    };
  } catch {
    return { step: 0, aiAbout: "" };
  }
};

export default function Onboarding() {
  const initial = useMemo(readProgress, []);
  const [step, setStep] = useState<StepIdx>(initial.step);
  const [aiAbout, setAiAbout] = useState(initial.aiAbout);
  const [plan, setPlan] = useState<"weekly" | "monthly" | "annual">("annual");
  const [finishing, setFinishing] = useState(false);
  const [busyCheckout, setBusyCheckout] = useState(false);

  const { profile, update, refresh } = useProfile();
  const nav = useNavigate();

  useEffect(() => {
    try {
      const snapshot: Partial<Progress> = { step, aiAbout };
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore — sessionStorage can fail in private mode */
    }
  }, [step, aiAbout]);

  const goTo = (s: StepIdx) => {
    haptics.selection();
    setStep(s);
  };
  const goBack = () => goTo(Math.max(0, step - 1) as StepIdx);

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
      };

      // Navigate immediately so the user sees the app without waiting for Supabase.
      // Profile update fires in the background — the app reads the local flag anyway.
      try { sessionStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
      haptics.notify("success");
      nav("/home");

      if (profile) {
        update(payload as never).catch(() => { /* non-critical */ });
      } else {
        supabase.auth.getSession().then(({ data: { session } }) => {
          const uid = session?.user?.id;
          if (uid) {
            supabase.from("profiles")
              .upsert({ id: uid, ...payload } as never, { onConflict: "id" })
              .then(({ error }) => { if (!error) refresh().catch(() => {}); });
          }
        });
      }
    } catch (e: unknown) {
      console.error("Onboarding finish error:", e);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) writeOnboardedFlag(session.user.id);
        sessionStorage.removeItem(PROGRESS_KEY);
      } catch { /* ignore */ }
      
      haptics.notify("success");
      nav("/home");
    } finally {
      setFinishing(false);
    }
  };

  const tryCheckout = async () => {
    if (busyCheckout) return;
    setBusyCheckout(true);
    haptics.tap();
    try {
      await startCheckout(plan, {
        onUnavailable: () => toast("Payments coming soon — you're set up for free."),
      });
    } finally {
      setBusyCheckout(false);
      finish(true);
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-background flex justify-center overflow-y-auto overscroll-y-contain no-scrollbar">
      <div className="relative w-full max-w-[440px] min-h-full flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px]" style={{ background: "var(--gradient-glow)" }} />

        <div className="relative z-10 flex-1 flex flex-col px-6 pt-[max(env(safe-area-inset-top),14px)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          {/* Nav bar */}
          <div className="flex items-center justify-between h-9 -mx-1 mb-4">
            {step === 1 ? (
              <button
                type="button"
                onClick={goBack}
                disabled={finishing}
                aria-label="Back"
                className="h-9 w-9 inline-flex items-center justify-center rounded-full text-secondary-fg hover:text-foreground hover:bg-foreground/5 pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
              </button>
            ) : (
              <span className="h-9 w-9" />
            )}

            {step < 2 ? (
              <button
                type="button"
                onClick={() => goTo(2)}
                disabled={finishing}
                className="h-9 px-3 text-[13px] font-medium text-secondary-fg hover:text-foreground pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                Skip
              </button>
            ) : (
              <span className="h-9 w-9" />
            )}
          </div>

          {/* Progress bar — 3 segments */}
          <div className="flex gap-1.5 mb-7">
            {Array.from({ length: STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${
                  i <= step ? "bg-primary" : "bg-border/70"
                }`}
              />
            ))}
          </div>

          <div className="flex-1 flex flex-col page-enter" key={step}>
            {step === 0 && (
              <WelcomeSetupStep
                aiAbout={aiAbout}
                onAiAbout={setAiAbout}
                onContinue={() => goTo(1)}
                disabled={finishing}
              />
            )}
            {step === 1 && (
              <FeaturesShowcaseStep
                onContinue={() => goTo(2)}
                disabled={finishing}
              />
            )}
            {step === 2 && (
              <PaywallStep
                plan={plan}
                onPlan={setPlan}
                onCheckout={tryCheckout}
                onSkip={() => finish(false)}
                onBack={() => goTo(1)}
                busyCheckout={busyCheckout}
                finishing={finishing}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ */
/*  SHARED PRIMITIVES                                                */
/* ================================================================ */

/**
 * AppAuraIcon — A premium, Apple-like fluid gradient aura replacing the chaotic
 * particle system. It breathes and morphs smoothly behind a glassmorphic app icon.
 */
function SparkParticle({ angle, delay, duration }: { angle: number, delay: number, duration: number }) {
  const dist = 500;
  const rad = (angle * Math.PI) / 180;
  const x = Math.cos(rad) * dist;
  const y = Math.sin(rad) * dist;
  
  return (
    <motion.div
      className="absolute top-1/2 left-1/2 w-1.5 h-1.5 rounded-full bg-white z-20 pointer-events-none"
      style={{
        boxShadow: "0 0 12px 3px rgba(255,255,255,0.8)",
        marginLeft: -3,
        marginTop: -3,
      }}
      initial={{ x, y, scale: 0, opacity: 0 }}
      animate={{ x: 0, y: 0, scale: [0, 2, 0], opacity: [0, 1, 0] }}
      transition={{ delay, duration, ease: "easeIn" }}
    />
  );
}

function AppAuraIcon() {
  const containerSize = 176;

  return (
    <div
      className="relative mx-auto flex items-center justify-center"
      style={{ width: containerSize, height: containerSize }}
      aria-hidden
    >
      {/* Sparks flying in to assemble the center */}
      <SparkParticle angle={-45} delay={0.2} duration={0.8} />
      <SparkParticle angle={15}  delay={0.3} duration={0.7} />
      <SparkParticle angle={135} delay={0.1} duration={0.9} />
      <SparkParticle angle={190} delay={0.4} duration={0.6} />
      <SparkParticle angle={260} delay={0.25} duration={0.75} />

      {/* Central flash when sparks hit (t=1.0s) */}
      <motion.div
        className="absolute top-1/2 left-1/2 w-[120px] h-[120px] bg-white rounded-full z-30 pointer-events-none"
        style={{ marginLeft: -60, marginTop: -60, filter: "blur(20px)" }}
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 2] }}
        transition={{ delay: 0.95, duration: 0.6, ease: "easeOut" }}
      />

      {/* Ambient fluid aura - scales up as sparks fly in */}
      <motion.div 
        className="absolute inset-0 flex items-center justify-center"
        initial={{ opacity: 0, scale: 0 }} 
        animate={{ opacity: 1, scale: 1 }} 
        transition={{ duration: 1.5, ease: "easeOut", delay: 0.4 }}
      >
        <div className="relative w-full h-full" style={{ filter: "blur(32px)" }}>
          <motion.div
            className="absolute top-[15%] left-[15%] w-[110px] h-[110px] rounded-full"
            style={{ background: "hsl(var(--primary))" }}
            animate={{ 
              scale: [1, 1.3, 1], 
              x: [0, 20, 0], 
              y: [0, -20, 0],
              opacity: [0.6, 0.9, 0.6]
            }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute bottom-[15%] right-[15%] w-[120px] h-[120px] rounded-full"
            style={{ background: "hsl(280, 100%, 65%)" }}
            animate={{ 
              scale: [1.2, 0.9, 1.2], 
              x: [0, -25, 0], 
              y: [0, 20, 0],
              opacity: [0.5, 0.8, 0.5]
            }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          />
          <motion.div
            className="absolute top-[25%] right-[25%] w-[90px] h-[90px] rounded-full"
            style={{ background: "hsl(200, 100%, 55%)" }}
            animate={{ 
              scale: [0.9, 1.4, 0.9], 
              x: [0, 15, 0], 
              y: [0, 15, 0],
              opacity: [0.4, 0.7, 0.4]
            }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          />
        </div>
      </motion.div>

      {/* Main Emblem — Assembles exactly when the flash hits */}
      <motion.div
        className="relative z-10 flex items-center justify-center rounded-[32px] bg-background/40 backdrop-blur-xl border border-white/20 dark:border-white/10"
        style={{
          width: 76,
          height: 76,
          background: "linear-gradient(135deg, hsl(var(--primary)/0.2) 0%, transparent 100%)",
          boxShadow: "0 16px 40px -8px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.5)",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ 
          scale: { type: "spring", stiffness: 300, damping: 20, delay: 1.0 },
          opacity: { duration: 0.2, delay: 1.0 },
        }}
      >
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="absolute inset-0 rounded-[32px] overflow-hidden pointer-events-none">
             <div className="absolute -top-4 -right-4 w-16 h-16 bg-white/40 rounded-full blur-[16px]" />
          </div>
          <Sparkles className="h-10 w-10 text-foreground drop-shadow-[0_0_12px_rgba(255,255,255,0.5)]" strokeWidth={1.5} />
        </motion.div>
      </motion.div>
    </div>
  );
}
// Removed SpiralOrb

/* ================================================================ */
/*  STEP 0 — Welcome + AI Setup (merged)                            */
/* ================================================================ */

/** Animates placeholder text for the textarea: types → pauses → erases → repeats. */
function useTypingPlaceholder(examples: string[], speed = 38) {
  const [display, setDisplay] = useState("");
  const idxRef = useRef(0);
  const dirRef = useRef<"typing" | "erasing">("typing");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const target = examples[idxRef.current];
      if (dirRef.current === "typing") {
        setDisplay((d) => {
          const next = target.slice(0, d.length + 1);
          if (next === target) {
            dirRef.current = "erasing";
            timer = setTimeout(tick, 1800);
          } else {
            timer = setTimeout(tick, speed);
          }
          return next;
        });
      } else {
        setDisplay((d) => {
          const next = d.slice(0, -1);
          if (next === "") {
            dirRef.current = "typing";
            idxRef.current = (idxRef.current + 1) % examples.length;
            timer = setTimeout(tick, 500);
          } else {
            timer = setTimeout(tick, speed * 0.55);
          }
          return next;
        });
      }
    };
    timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, [examples, speed]);

  return display;
}

const AI_EXAMPLES = [
  "e.g. I work from home, dog walk at 1 pm, no hard tasks after 4 pm.",
  "e.g. Freelance dev, most focused 9–12, gym on Mon/Wed/Fri.",
  "e.g. Student, mornings are best, part-time job 3–6 pm weekdays.",
];

function WelcomeSetupStep({
  aiAbout,
  onAiAbout,
  onContinue,
  disabled,
}: {
  aiAbout: string;
  onAiAbout: (v: string) => void;
  onContinue: () => void;
  disabled: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const placeholder = useTypingPlaceholder(AI_EXAMPLES);
  const mood = focused && aiAbout.length > 0 ? "happy" : focused ? "thinking" : "neutral";

  return (
    <div className="flex-1 flex flex-col">
      {/* ── AI Logo + headline ─────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center">
        <AppAuraIcon />

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, type: "spring", stiffness: 300, damping: 24 }}
        >
          <p className="eyebrow text-center mt-3">DayDraft</p>
          <h1 className="font-display text-[34px] font-semibold leading-[1.08] tracking-tight mt-3 text-balance text-center">
            Your day,<br />planned for you.
          </h1>
          <p className="text-secondary-fg mt-3 text-[15px] leading-[1.55] max-w-[19rem] mx-auto text-center text-balance">
            AI turns your goals into a realistic schedule. Track what shipped, and bill it.
          </p>
        </motion.div>

        {/* ── Divider ──────────────────────────────────── */}
        <motion.div 
          className="flex items-center gap-3 mt-7 mb-6"
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 1.4, duration: 0.6, ease: "easeOut" }}
        >
          <div className="flex-1 h-px bg-border/40 origin-right" />
          <span className="text-[11px] text-secondary-fg/55 font-medium flex items-center gap-1.5 shrink-0">
            <motion.span
              animate={{ rotate: [0, 20, -20, 0], scale: [1, 1.2, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 2 }}
              className="inline-block"
            >
              ✦
            </motion.span>
            Help AI plan better
          </span>
          <div className="flex-1 h-px bg-border/40 origin-left" />
        </motion.div>

        {/* ── AI context textarea ───────────────────────── */}
        <motion.div 
          className="relative"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, type: "spring", stiffness: 300, damping: 24 }}
        >
          <Textarea
            value={aiAbout}
            onChange={(e) => onAiAbout(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder + (focused ? "" : "▋")}
            maxLength={500}
            rows={3}
            className="min-h-[88px] surface-card border-soft rounded-2xl text-[14px] resize-none leading-relaxed transition-[border-color,box-shadow] duration-200 focus:border-primary/50 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
            autoFocus={false}
          />
          <p className="mt-1.5 text-[11px] text-secondary-fg/45 text-right">{aiAbout.length}/500</p>
        </motion.div>

        <motion.p 
          className="mt-2 text-[11px] text-secondary-fg/45 text-center leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.7, duration: 0.6 }}
        >
          Sent privately with each plan · never stored beyond your profile
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.8, type: "spring", stiffness: 340, damping: 26 }}
      >
        <Button
          disabled={disabled}
          onClick={onContinue}
          className="w-full h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-semibold shadow-[0_12px_32px_-8px_hsl(var(--primary)/0.6)] mt-6"
        >
          Let's go <ArrowRight className="h-4 w-4 ml-1.5" />
        </Button>
      </motion.div>
    </div>
  );
}

/* ================================================================ */
/*  STEP 1 — Features: Plan · Track · Bill (merged)                 */
/* ================================================================ */

const PLAN_BLOCKS = [
  { time: "9:00", title: "Design review", typeVar: "--type-deep",    mins: 45 },
  { time: "10:00", title: "Client call",   typeVar: "--type-comm",    mins: 30 },
  { time: "10:45", title: "Deep work",     typeVar: "--type-deep",    mins: 90 },
] as const;

/** A real-app-styled block row, matching SortableBlock aesthetics perfectly. */
function MockBlock({
  time,
  title,
  typeVar,
  mins,
  delay,
  glow = false,
  from = "bottom",
}: {
  time: string;
  title: string;
  typeVar: string;
  mins: number;
  delay: number;
  glow?: boolean;
  /** Which edge the block slides in from */
  from?: "left" | "right" | "bottom";
}) {
  const initial =
    from === "left"  ? { opacity: 0, x: -500, y: 0, scale: 0.95 } :
    from === "right" ? { opacity: 0, x:  500, y: 0, scale: 0.95 } :
                       { opacity: 0, x:   0, y: 400, scale: 0.95 };
  return (
    <motion.div
      initial={initial}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      transition={{ delay, type: "spring", stiffness: 320, damping: 24, mass: 0.8 }}
      className={[
        "group app-card rounded-[18px] px-3.5 py-3.5 shadow-sm border transition-[border-color,box-shadow,transform] duration-300",
        glow 
          ? "ring-[1.5px] ring-primary/40 bg-primary/[0.04] shadow-[0_0_32px_hsl(var(--primary)/0.12)] border-primary/20 scale-[1.02]" 
          : "bg-[linear-gradient(165deg,hsl(var(--type-deep)/.06)_0%,hsl(var(--surface)/.72)_58%,hsl(var(--surface-elevated)/.65)_100%)] border-[hsl(var(--type-deep)/.22)]"
      ].join(" ")}
      style={{
         ...(glow ? {} : {
            background: `linear-gradient(165deg, hsl(${typeVar} / .06) 0%, hsl(var(--surface) / .72) 58%, hsl(var(--surface-elevated) / .65) 100%)`,
            borderColor: `hsl(${typeVar} / .22)`
         })
      } as any}
    >
      <div className="flex items-start gap-2">
        {/* Invisible drag handle placeholder for exact padding match */}
        <div className="w-6 h-8 shrink-0 flex items-center justify-center text-secondary-fg/30" aria-hidden>
          {glow && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
        </div>

        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className="shrink-0 h-6 px-1.5 inline-flex items-center justify-center text-secondary-fg/70 text-[10px] font-mono-sf tabular-nums">
            {time}
          </div>

          {/* Accent stripe */}
          <div className="w-[4px] h-8 rounded-full shrink-0" style={{ background: `hsl(var(${typeVar}))` }} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 leading-tight text-[14px] font-medium text-foreground">
              <span className="flex-1 min-w-0 truncate">{title}</span>
              {!glow && <Layers className="h-3 w-3 text-secondary-fg shrink-0" aria-hidden />}
              {glow && <Sparkles className="h-3 w-3 text-primary/70 shrink-0" aria-hidden />}
            </div>
            <div className="text-[11px] text-secondary-fg mt-[3px] tabular-nums leading-none">
              <span className="text-faint">{mins}m</span>
            </div>
            
            {glow && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-success/15 text-success border border-success/25 px-2 py-0.5 text-[11px] font-medium leading-none"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Tracking now
              </motion.div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {glow ? (
              <button
                type="button"
                className="shrink-0 h-8 rounded-full bg-success/15 text-success border border-success/30 inline-flex items-center justify-center gap-1 px-2.5 text-[11px] font-medium"
              >
                <Square className="h-3 w-3" fill="currentColor" /> Stop
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="relative h-8 w-8 rounded-full border-[1.5px] border-border/60 shrink-0 shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)]"
                  aria-hidden
                />
                <div className="shrink-0 h-[18px] w-[18px] flex items-center justify-center text-secondary-fg/30 pointer-events-none">
                  <ChevronDown className="h-3 w-3" />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Live ticking tracker card matching HomeTrackerHero. */
function LiveTrackerCard({ baseElapsed }: { baseElapsed: number }) {
  const [elapsed, setElapsed] = useState(baseElapsed);
  const RATE = 80;

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const totalSecs = elapsed;
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const fmt = (n: number) => String(n).padStart(2, "0");
  const earnings = ((totalSecs / 3600) * RATE).toFixed(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 500, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.55, type: "spring", stiffness: 300, damping: 22, mass: 0.9 }}
      className="relative overflow-hidden rounded-[28px] hero-glass border border-[color-mix(in_srgb,var(--hero-accent)_45%,hsl(var(--border)/0.5))] px-5 pt-6 pb-5 tracker-hero-clock shadow-[0_12px_40px_-12px_rgba(0,0,0,0.5)]"
      style={{ "--hero-accent": "hsl(var(--type-deep))" } as any}
    >
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary-fg/70">
            Recording
          </span>
          <span className="text-[12px] font-medium text-secondary-fg/80">
            All stats →
          </span>
        </div>

        {/* Hero timer */}
        <div className="mt-4 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.07] px-3 py-1 border border-border/30">
            <span
              className="h-1.5 w-1.5 rounded-full animate-pulse shadow-[0_0_0_3px_color-mix(in_srgb,var(--hero-accent)_22%,transparent)]"
              style={{ background: "hsl(var(--type-deep))" }}
            />
            <span className="text-[12px] font-medium text-foreground/85 truncate">
              Design review
            </span>
          </div>

          <div className="mt-3 breathe">
            <div className="font-display text-[3.4rem] font-semibold tabular-nums leading-none tracking-[-0.04em] text-foreground">
              {fmt(h)}:{fmt(m)}:{fmt(s)}
            </div>
          </div>
          
          <div
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-success/10 border border-success/20 px-3 py-1 tabular-nums"
          >
            <span className="text-[11px] font-medium text-success/65">earned</span>
            <span className="text-[14px] font-semibold text-success">${earnings}</span>
          </div>

          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-7 py-3 text-[14px] font-semibold shadow-[0_8px_22px_-12px_rgba(0,0,0,0.45)]">
            <Square className="h-3.5 w-3.5" fill="currentColor" />
            Stop
          </div>
        </div>
      </div>
    </motion.div>
  );
}


function FeaturesShowcaseStep({
  onContinue,
  disabled,
}: {
  onContinue: () => void;
  disabled: boolean;
}) {
  const BASE_ELAPSED = 5432;

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col">
        {/* ── Header copy ──────────────────────────────── */}
        <motion.p
          className="eyebrow"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          Plan · Track · Bill
        </motion.p>
        <motion.h1
          className="font-display text-[26px] font-semibold leading-tight tracking-tight mt-2 text-balance"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.06 }}
        >
          Everything your day needs, in one place.
        </motion.h1>

        {/* ── Showcase area ────────────────────────────── */}
        <div className="mt-6 flex-1 relative">
          {/* Two task blocks: first from left, second from right */}
          <div className="space-y-3 relative z-10">
            {PLAN_BLOCKS.slice(0, 2).map((b, i) => (
              <MockBlock
                key={b.title}
                time={b.time}
                title={b.title}
                typeVar={b.typeVar}
                mins={b.mins}
                delay={0.15 + i * 0.22}
                glow={false}
                from={i === 0 ? "left" : "right"}
              />
            ))}
          </div>

          {/* Small static divider — no animation, no bouncing dots */}
          <div className="flex justify-center py-2.5">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="h-[4px] w-[4px] rounded-full bg-primary/35"
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.65 + i * 0.06, type: "spring", stiffness: 400, damping: 20 }}
                />
              ))}
            </div>
          </div>

          <div className="relative z-20">
            <LiveTrackerCard baseElapsed={BASE_ELAPSED} />
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.5, type: "spring", stiffness: 340, damping: 22 }}
      >
        <Button
          disabled={disabled}
          onClick={onContinue}
          className="w-full h-[54px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/92 pressable text-[15px] font-semibold shadow-card mt-6"
        >
          Continue <ArrowRight className="h-4 w-4 ml-1.5" />
        </Button>
      </motion.div>
    </div>
  );
}

/* ================================================================ */
/*  STEP 2 — Paywall (enhanced animations)                          */
/* ================================================================ */

const FEATURES = [
  { label: "Unlimited AI Planning", icon: Zap },
  { label: "Smart Drift Nudges", icon: Compass },
  { label: "Polished PDF & CSV Reports", icon: FileDown },
  { label: "Billing & Rate Estimation", icon: Wallet },
];

function PaywallStep({
  plan,
  onPlan,
  onCheckout,
  onSkip,
  onBack,
  busyCheckout,
  finishing,
}: {
  plan: "weekly" | "monthly" | "annual";
  onPlan: (p: "weekly" | "monthly" | "annual") => void;
  onCheckout: () => void;
  onSkip: () => void;
  onBack: () => void;
  busyCheckout: boolean;
  finishing: boolean;
}) {
  const busy = busyCheckout || finishing;

  return (
    <div className="flex-1 flex flex-col fade-in">
      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="self-start -mt-2 mb-2 h-9 px-2 inline-flex items-center gap-1 rounded-full text-[13px] text-secondary-fg hover:text-foreground pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.4} /> Back
      </button>

      <div className="flex-1 flex flex-col items-center">
        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 24 }}
          className="font-display text-[28px] font-semibold leading-tight tracking-tight mt-3 text-center text-balance"
        >
          Unlock the full DayDraft.
        </motion.h1>

        {/* Social proof */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 360, damping: 30, delay: 0.15 }}
          className="mt-4 flex items-center justify-center gap-2.5 rounded-2xl border border-border/40 bg-surface-elevated/40 backdrop-blur-sm px-4 py-3 relative z-10 w-full"
        >
          <div className="flex gap-0.5 shrink-0">
            {[0, 1, 2, 3, 4].map((s) => (
              <Star key={s} className="h-3.5 w-3.5 fill-amber-400 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
            ))}
          </div>
          <p className="text-[12px] text-foreground/85 leading-tight font-medium">
            Join thousands of organized professionals.
          </p>
        </motion.div>

        {/* Feature cards (Vertical Stack) */}
        <div className="flex flex-col gap-2 w-full mt-4">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.06, type: "spring", stiffness: 320, damping: 24 }}
                className="flex items-center gap-3.5 rounded-[18px] border border-border/30 bg-surface-elevated/60 px-4 py-3.5"
              >
                <div className="shrink-0 h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <p className="text-[14px] font-medium text-foreground/90">{f.label}</p>
              </motion.div>
            );
          })}
        </div>

        {/* Pricing */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38, type: "spring", stiffness: 280, damping: 26 }}
          className="flex flex-col gap-2.5 w-full mt-5"
        >
          <PlanCard
            active={plan === "annual"} onClick={() => onPlan("annual")}
            title="Annual" price="$59.99" sub="$4.99/mo · save 50%" badge="Best Value"
          />
          <div className="grid grid-cols-2 gap-2.5">
            <PlanCard
              active={plan === "monthly"} onClick={() => onPlan("monthly")}
              title="Monthly" price="$9.99" sub="per month"
            />
            <PlanCard
              active={plan === "weekly"} onClick={() => onPlan("weekly")}
              title="Weekly" price="$3.99" sub="per week"
            />
          </div>
        </motion.div>
      </div>

      {/* CTAs */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.48, type: "spring", stiffness: 280, damping: 26 }}
        className="mt-5 flex flex-col gap-2.5"
      >
        <Button
          onClick={onCheckout}
          disabled={busy}
          className="w-full h-[54px] rounded-[18px] bg-primary hover:bg-primary/92 text-primary-foreground text-[16px] font-semibold pressable shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.6)]"
        >
          {busyCheckout ? "Opening checkout…" : "Start with Pro"}
        </Button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="w-full h-[48px] rounded-[18px] border border-border/35 bg-transparent text-[14px] font-medium text-secondary-fg/80 hover:text-foreground hover:bg-foreground/[0.04] pressable disabled:opacity-50 disabled:pointer-events-none transition-colors"
        >
          Continue with Free
        </button>
        <p className="text-[11px] text-secondary-fg/50 text-center">
          Cancel anytime · No surprise add-ons
        </p>
      </motion.div>
    </div>
  );
}

/* ================================================================ */
/*  SHARED: Pricing card                                             */
/* ================================================================ */

function PlanCard({
  active,
  onClick,
  title,
  price,
  sub,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  price: string;
  sub: string;
  badge?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className={[
        "relative text-left rounded-[18px] p-4 transition-all duration-200 overflow-hidden w-full app-card group",
        active
          ? "border-primary/50 bg-primary/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_24px_-8px_hsl(var(--primary)/0.35)]"
          : "hover:border-primary/30",
      ].join(" ")}
    >
      {badge && (
        <span className="absolute top-0 right-0 text-[10px] font-bold px-2.5 py-1 rounded-bl-[12px] bg-primary text-primary-foreground uppercase tracking-wider">
          {badge}
        </span>
      )}
      <div className={`text-[12px] font-medium uppercase tracking-wide ${active ? "text-primary" : "text-secondary-fg"}`}>
        {title}
      </div>
      <div className={`font-display text-[22px] font-bold tabular-nums mt-1 ${active ? "text-foreground" : "text-foreground/90"}`}>
        {price}
      </div>
      <div className={`text-[12px] mt-0.5 ${active ? "text-primary/80" : "text-secondary-fg/80"}`}>
        {sub}
      </div>
    </motion.button>
  );
}
