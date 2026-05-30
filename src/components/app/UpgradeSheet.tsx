import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Sparkles, Zap, Compass, Clock, FileDown, Wallet,
  Shield, Check, Star, Focus, History
} from "lucide-react";
import { startCheckout } from "@/hooks/useEntitlement";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { haptics } from "@/lib/haptics";

export type UpgradeReason = "quota" | "feature" | "trial-banner" | "momentum";

const PAYWALL_COOLDOWN_KEY = "dd_paywall_last_open";
const PAYWALL_COOLDOWN_MS = 1000 * 60 * 30;
export const canShowPassivePaywall = () => {
  try {
    const last = Number(localStorage.getItem(PAYWALL_COOLDOWN_KEY) || 0);
    return !last || Date.now() - last > PAYWALL_COOLDOWN_MS;
  } catch { return true; }
};

/* ─── Feature cards data ──────────────────────────────────────── */
const FEATURES = [
  {
    id: "unlimited",
    Icon: Zap,
    accent: "211 95% 60%", // Blue
    title: "Unlimited AI planning",
    desc: "Generate full schedules and chat with the AI assistant any day, no caps.",
    Preview: () => (
      <div className="flex flex-col gap-2 pt-1.5">
        {["w-[80%]", "w-[50%]", "w-[70%]"].map((w, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-[hsl(211_95%_60%/0.8)] shadow-[0_0_8px_hsl(211_95%_60%/0.6)]" />
            <div className={`h-1.5 ${w} rounded-full bg-[hsl(211_95%_60%/0.25)]`} />
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "drift",
    Icon: Compass,
    accent: "38 90% 54%", // Amber
    title: "Smart drift nudges",
    desc: "When your day slips, get a gentle heads-up and one-tap replan options.",
    Preview: () => (
      <div
        className="rounded-lg px-2.5 py-2 text-left relative overflow-hidden mt-0.5"
        style={{ background: "hsl(38 90% 54% / 0.12)", border: "1px solid hsl(38 90% 54% / 0.28)" }}
      >
        <motion.div 
          animate={{ x: ["-100%", "200%"] }} 
          transition={{ duration: 3.5, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 bg-gradient-to-r from-transparent via-[hsl(38_90%_54%/0.2)] to-transparent" 
        />
        <p className="text-[10px] font-semibold tracking-wide" style={{ color: "hsl(38 90% 54%)" }}>Running 24 min late</p>
        <p className="text-[9px] mt-0.5 opacity-80 leading-tight">Compress 2 tasks or defer 1?</p>
      </div>
    ),
  },
  {
    id: "timer_reschedule",
    Icon: Clock,
    accent: "155 70% 44%", // Emerald
    title: "Timer-smart replans",
    desc: "After tracking time, get micro-adjustments to keep the rest of your day on track.",
    Preview: () => (
      <div className="space-y-2 mt-2">
        <div className="h-2 w-full rounded-full bg-[hsl(155_70%_44%/0.18)] overflow-hidden">
          <motion.div 
            initial={{ width: "20%" }}
            whileInView={{ width: "62%" }}
            transition={{ duration: 1.2, ease: "easeOut", delay: 0.1 }}
            className="h-full rounded-full bg-[hsl(155_70%_44%/0.8)] shadow-[0_0_10px_hsl(155_70%_44%/0.5)]" 
          />
        </div>
        <p className="text-[9.5px] font-medium tracking-wide" style={{ color: "hsl(155 70% 44%)" }}>62% done · Adjust remaining?</p>
      </div>
    ),
  },
  {
    id: "focus_mode",
    Icon: Focus,
    accent: "316 70% 50%", // Pink
    title: "One Thing Mode",
    desc: "A distraction-free focus screen that forces you to tackle one task at a time.",
    Preview: () => (
      <div className="flex items-center justify-center h-full pt-1">
        <motion.div 
          animate={{ scale: [0.95, 1.1, 0.95] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="h-10 w-10 rounded-full flex items-center justify-center"
          style={{ background: "radial-gradient(circle, hsl(316 70% 50% / 0.3) 0%, transparent 70%)" }}
        >
          <div className="h-3 w-3 rounded-full bg-[hsl(316_70%_50%)] shadow-[0_0_14px_hsl(316_70%_50%)]" />
        </motion.div>
      </div>
    )
  },
  {
    id: "pdf_export",
    Icon: FileDown,
    accent: "265 80% 62%", // Violet
    title: "Professional PDF reports",
    desc: "Export your tracked time as polished, branded PDF reports — ready for clients.",
    Preview: () => (
      <div
        className="rounded-lg px-2.5 py-2 space-y-2 mt-0.5"
        style={{ background: "hsl(265 80% 62% / 0.10)", border: "1px solid hsl(265 80% 62% / 0.25)" }}
      >
        <div className="flex justify-between items-center mb-1">
          <div className="h-1.5 w-14 rounded-full bg-[hsl(265_80%_62%/0.7)] shadow-[0_0_6px_hsl(265_80%_62%/0.4)]" />
          <div className="h-1.5 w-6 rounded-full bg-[hsl(265_80%_62%/0.3)]" />
        </div>
        {["w-[90%]", "w-[60%]"].map((w, i) => (
          <div key={i} className={`h-1 ${w} rounded-full bg-[hsl(265_80%_62%/0.3)]`} />
        ))}
      </div>
    ),
  },
  {
    id: "billing_reports",
    Icon: Wallet,
    accent: "335 75% 58%", // Rose
    title: "Billing & Payment Info",
    desc: "Include hourly rates, earned totals, and your payment details (e.g. Bank/PayPal) on every invoice.",
    Preview: () => (
      <div
        className="rounded-lg px-2.5 py-2 relative overflow-hidden mt-0.5"
        style={{ background: "hsl(335 75% 58% / 0.10)", border: "1px solid hsl(335 75% 58% / 0.25)" }}
      >
        <div className="flex justify-between items-end mb-1.5">
          <div>
            <p className="text-[7.5px] font-semibold uppercase tracking-[0.1em] opacity-80" style={{ color: "hsl(335 75% 58%)" }}>Invoice Total</p>
            <p className="text-[12px] font-bold mt-0.5" style={{ color: "hsl(335 75% 58%)" }}>$625.00</p>
          </div>
          <motion.div 
            initial={{ opacity: 0.5, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.2, type: "spring" }}
            className="flex items-center gap-1 bg-[hsl(335_75%_58%/0.2)] px-1.5 py-0.5 rounded text-[7.5px] font-bold"
            style={{ color: "hsl(335 75% 58%)" }}
          >
            <Wallet className="w-2 h-2" /> Pay Details
          </motion.div>
        </div>
        <div className="h-0.5 w-full bg-[hsl(335_75%_58%/0.25)] rounded-full" />
      </div>
    ),
  },
  {
    id: "debrief_history",
    Icon: History,
    accent: "190 90% 50%", // Cyan
    title: "Unlimited Debrief History",
    desc: "Access all your past daily recaps. Review trends, accomplishments, and long-term habits.",
    Preview: () => (
      <div className="flex gap-1.5 items-end h-[42px] pt-1">
        {[40, 70, 45, 95, 60].map((h, i) => (
          <motion.div
            key={i}
            initial={{ height: "0%" }}
            whileInView={{ height: `${h}%` }}
            transition={{ duration: 0.6, delay: i * 0.08, type: "spring", stiffness: 200 }}
            className="flex-1 rounded-t-sm bg-[hsl(190_90%_50%/0.4)] border-t border-[hsl(190_90%_50%)]"
            style={{ boxShadow: "0 -2px 10px hsl(190 90% 50% / 0.25)" }}
          />
        ))}
      </div>
    )
  }
] as const;

/* ─── Plan data ────────────────────────────────────────────────── */
const PLANS = [
  {
    id: "annual" as const,
    label: "Annual",
    price: "$59.99",
    pricePerMonth: "$4.99",
    period: "/year",
    badge: "Save 50%",
    tagline: "Most popular",
    highlight: true,
  },
  {
    id: "monthly" as const,
    label: "Monthly",
    price: "$9.99",
    pricePerMonth: "$9.99",
    period: "/month",
    badge: null,
    tagline: null,
    highlight: false,
  },
  {
    id: "weekly" as const,
    label: "Weekly",
    price: "$3.99",
    pricePerMonth: null,
    period: "/week",
    badge: null,
    tagline: null,
    highlight: false,
  },
] as const;

type Plan = (typeof PLANS)[number]["id"];

/* ─── Headline copy per reason ─────────────────────────────────── */
const HEADLINE: Record<UpgradeReason, { h: string; sub: string }> = {
  quota: { h: "Keep the streak going.", sub: "You've used your free days. Pro removes every limit and adds the tools serious planners rely on." },
  feature: { h: "The full version of DayDraft.", sub: "Pro opens the planning cap, AI assistant, smart nudges, and billing-ready reports — all in one upgrade." },
  "trial-banner": { h: "Stay in control.", sub: "Don't lose your planning flow. Pro keeps you on unlimited days plus every feature you've already been using." },
  momentum: { h: "Protect your momentum.", sub: "One busy week shouldn't block the next. Pro keeps plans, nudges, and exports uncapped — forever." },
};

/* ─── UpgradeSheet ─────────────────────────────────────────────── */
export const UpgradeSheet = ({
  open,
  onOpenChange,
  reason = "feature",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reason?: UpgradeReason;
}) => {
  const [plan, setPlan] = useState<Plan>("annual");
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const isDev = import.meta.env.DEV;

  const checkout = async () => {
    haptics.impact();
    setBusy(true);
    try {
      await startCheckout(plan, {
        onUnavailable: () => toast("Payments coming soon — we'll let you know."),
      });
    } finally {
      setBusy(false);
    }
  };

  const simulatePro = async () => {
    if (!user) return;
    const { error } = await supabase.from("subscriptions").upsert(
      {
        user_id: user.id, status: "active", plan: "annual",
        current_period_end: new Date(Date.now() + 365 * 86400000).toISOString(),
      } as any,
      { onConflict: "user_id" },
    );
    if (error) { toast.error(error.message); return; }
    toast.success("Simulated Pro · refresh to see");
    onOpenChange(false);
    setTimeout(() => location.reload(), 600);
  };

  useEffect(() => {
    if (!open) return;
    try { localStorage.setItem(PAYWALL_COOLDOWN_KEY, String(Date.now())); } catch { /* ignore */ }
  }, [open]);

  const activePlan = PLANS.find((p) => p.id === plan)!;
  const { h, sub } = HEADLINE[reason];

  const ctaLabel = busy
    ? "Opening…"
    : activePlan.id === "annual"
      ? "Unlock Pro · $4.99/mo"
      : activePlan.id === "monthly"
        ? "Unlock Pro · $9.99/mo"
        : "Unlock Pro · $3.99/wk";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[32px] border-border/20 bg-background max-h-[96vh] flex flex-col p-0 overflow-hidden shadow-2xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        <SheetTitle className="sr-only">Upgrade to Pro</SheetTitle>

        {/* ─── Drag handle ─────────────────────────────────────── */}
        <div className="absolute top-0 inset-x-0 shrink-0 flex justify-center pt-3 pb-2 z-50 bg-gradient-to-b from-background via-background to-transparent pointer-events-none">
          <div className="h-1.5 w-12 rounded-full bg-foreground/20 pointer-events-auto" />
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-none pt-4 pb-8" style={{ scrollBehavior: "smooth" }}>
          {/* ─── Hero / Header ────────────────────────────────────────────── */}
          <div className="relative px-6 pt-6 pb-2 overflow-hidden text-center flex flex-col items-center">
            {/* Rich Aurora Glowing Background */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <motion.div
                className="absolute top-[-20%] left-[-10%] w-[140%] h-[120%] opacity-40 blur-[80px]"
                style={{
                  background: "radial-gradient(ellipse at top, hsl(var(--primary) / 0.5) 0%, hsl(var(--primary-glow) / 0.3) 40%, transparent 70%)"
                }}
                animate={{ rotate: [0, 5, 0, -5, 0], scale: [1, 1.05, 1] }}
                transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>

            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 mb-5 shadow-[0_0_20px_hsl(var(--primary)/0.2)] backdrop-blur-md relative z-10"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
              <span className="text-[12px] font-bold tracking-[0.12em] uppercase text-primary">
                DayDraft Pro
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h2
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.05 }}
              className="font-display text-[32px] sm:text-[36px] font-bold leading-[1.1] tracking-tight text-foreground relative z-10 max-w-sm"
            >
              {h}
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.10 }}
              className="text-[15px] text-secondary-fg/90 mt-3 leading-[1.5] relative z-10 max-w-sm"
            >
              {sub}
            </motion.p>
          </div>

          {/* ─── Social proof ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 360, damping: 30, delay: 0.15 }}
            className="mx-6 mt-4 flex items-center justify-center gap-2.5 rounded-2xl border border-border/40 bg-surface-elevated/40 backdrop-blur-sm px-4 py-3 relative z-10"
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

          {/* ─── Feature cards (Vertical Stack) ──────────── */}
          <div className="mt-8 relative z-10">
            <div className="px-6 flex items-center justify-center mb-5 opacity-70">
              <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent flex-1" />
              <span className="px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary-fg">Everything included</span>
              <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent flex-1" />
            </div>

            <div className="px-5 flex flex-col gap-4 pb-2">
              {FEATURES.map((feat, i) => (
                <FeatureCard key={feat.id} feat={feat} index={i} />
              ))}
            </div>
          </div>

          {/* ─── Plan selector ────────────────────────────────────── */}
          <div className="px-5 mt-8 space-y-3 relative z-10">
            {/* Annual — big card */}
            <AnnualCard
              active={plan === "annual"}
              onClick={() => { haptics.selection(); setPlan("annual"); }}
            />
            {/* Monthly + Weekly — smaller row */}
            <div className="grid grid-cols-2 gap-3">
              {PLANS.filter((p) => p.id !== "annual").map((p) => (
                <SmallPlanCard
                  key={p.id}
                  plan={p}
                  active={plan === p.id}
                  onClick={() => { haptics.selection(); setPlan(p.id); }}
                />
              ))}
            </div>
          </div>

          {/* ─── CTA ─────────────────────────────────────────────── */}
          <div className="px-5 mt-6 relative z-10">
            <button
              type="button"
              onClick={checkout}
              disabled={busy}
              className="btn-volumetric pressable relative w-full h-[60px] rounded-[20px] text-[16px] font-bold tracking-wide text-primary-foreground disabled:opacity-70 overflow-hidden shadow-[0_12px_24px_-8px_hsl(var(--primary)/0.6)] border border-primary-foreground/10"
            >
              {/* Animated shimmer on the button */}
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background: "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.25) 50%, transparent 65%)",
                }}
                animate={{ x: ["-100%", "200%"] }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 1 }}
              />
              <span className="relative flex items-center justify-center gap-2">
                <Sparkles className="h-5 w-5" strokeWidth={2.2} />
                {ctaLabel}
              </span>
            </button>

            {/* Trust row */}
            <div className="flex items-center justify-center gap-5 mt-4">
              {[
                { Icon: Shield, text: "Cancel anytime" },
                { Icon: Check, text: "7-day free trial" },
              ].map(({ Icon, text }) => (
                <span key={text} className="flex items-center gap-1.5 text-[11px] text-secondary-fg/75 font-semibold tracking-wide">
                  <Icon className="h-3.5 w-3.5 opacity-80 text-primary" strokeWidth={2.5} />
                  {text}
                </span>
              ))}
            </div>

            {isDev && (
              <button
                onClick={simulatePro}
                className="block mx-auto mt-6 text-[11px] text-secondary-fg/30 hover:text-primary transition-colors underline"
              >
                dev: simulate Pro
              </button>
            )}

            {/* Bottom safe area */}
            <div style={{ height: "max(24px, env(safe-area-inset-bottom, 0px))" }} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

/* ─── FeatureCard ──────────────────────────────────────────────── */
function FeatureCard({
  feat,
  index,
}: {
  feat: (typeof FEATURES)[number];
  index: number;
}) {
  const { Icon, accent, title, desc, Preview } = feat;
  return (
    <motion.div
      initial={{ opacity: 0, y: 25, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ type: "spring", stiffness: 350, damping: 25, delay: 0.05 }}
      className="rounded-[22px] p-4.5 flex flex-col sm:flex-row gap-4 relative overflow-hidden group"
      style={{
        background: `linear-gradient(145deg, hsl(${accent} / 0.10) 0%, hsl(${accent} / 0.03) 100%)`,
        boxShadow: [
          `inset 0 1px 0 hsl(0 0% 100% / 0.06)`,
          `0 0 0 1px hsl(${accent} / 0.15)`,
          `0 8px 24px -12px hsl(${accent} / 0.20)`,
        ].join(", "),
      }}
    >
      {/* Background glow accent */}
      <motion.div
        className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-[45px] pointer-events-none opacity-40"
        style={{ background: `hsl(${accent})` }}
      />

      <div className="flex-1 flex flex-col gap-1.5 z-10">
        <div className="flex items-center gap-3.5">
          <span
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px]"
            style={{
              background: `linear-gradient(180deg, hsl(${accent} / 0.25) 0%, hsl(${accent} / 0.10) 100%)`,
              boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.15), inset 0 -1px 0 hsl(${accent} / 0.20), 0 0 0 1px hsl(${accent} / 0.35)`,
              color: `hsl(${accent})`,
            }}
          >
            <Icon className="h-5 w-5 drop-shadow-[0_0_8px_currentColor]" strokeWidth={2.2} />
          </span>
          <p className="text-[16px] font-bold text-foreground tracking-tight leading-tight">{title}</p>
        </div>
        <p className="text-[13px] text-secondary-fg/90 leading-relaxed pl-[56px] font-medium">{desc}</p>
      </div>

      {/* Mini preview container */}
      <div className="w-full sm:w-[150px] h-[52px] shrink-0 ml-[56px] sm:ml-0 mt-1 sm:mt-0 z-10 flex items-center">
        <div className="w-full">
          <Preview />
        </div>
      </div>
    </motion.div>
  );
}

/* ─── AnnualCard ───────────────────────────────────────────────── */
function AnnualCard({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <div className="relative">
      {/* Animated glow border when active */}
      {active && (
        <motion.div
          className="absolute -inset-[2px] rounded-[22px] bg-gradient-to-r from-primary via-primary-glow to-primary blur-[6px] opacity-60"
          animate={{ opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      
      <button
        type="button"
        onClick={onClick}
        className="relative w-full text-left rounded-[20px] p-5 pressable overflow-hidden transition-all duration-300 block"
        style={
          active
            ? {
                background: "linear-gradient(145deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--primary) / 0.08) 100%)",
                backdropFilter: "blur(12px)",
                boxShadow: [
                  "inset 0 1px 0 hsl(0 0% 100% / 0.15)",
                  "0 0 0 1.5px hsl(var(--primary) / 0.7)",
                  "0 12px 36px -12px hsl(var(--primary) / 0.5)",
                ].join(", "),
              }
            : {
                background: "hsl(var(--surface-elevated) / 0.6)",
                boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.08), 0 0 0 1px hsl(var(--border) / 0.6)",
              }
        }
      >
        {/* Save badge — top right corner */}
        <span
          className="absolute top-0 right-0 rounded-bl-[16px] rounded-tr-[20px] px-3.5 py-1.5 text-[10.5px] font-black uppercase tracking-[0.15em] shadow-sm"
          style={{
            background: active
              ? "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary-glow)) 100%)"
              : "hsl(var(--foreground) / 0.1)",
            color: active ? "hsl(var(--primary-foreground))" : "hsl(var(--secondary-fg))",
          }}
        >
          Save 50%
        </span>

        <div className="flex items-end gap-3 pr-20 relative z-10">
          <div>
            <p className={`text-[11px] font-bold uppercase tracking-[0.16em] mb-1.5 ${active ? "text-primary-glow" : "text-secondary-fg/60"}`}>
              Most popular
            </p>
            <div className="flex items-baseline gap-1.5">
              <span className={`font-display text-[34px] font-black tabular-nums leading-none tracking-tight ${active ? "text-foreground drop-shadow-md" : "text-foreground/90"}`}>
                $4.99
              </span>
              <span className={`text-[14px] font-bold ${active ? "text-primary/90" : "text-secondary-fg/70"}`}>
                /month
              </span>
            </div>
            <p className={`text-[12.5px] mt-1.5 font-medium ${active ? "text-secondary-fg/90" : "text-secondary-fg/60"}`}>
              Billed annually · $59.99/year
            </p>
          </div>
        </div>

        <AnimatePresence>
          {active && (
            <motion.span
              initial={{ scale: 0, opacity: 0, rotate: -15 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
              className="absolute bottom-5 right-5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_16px_hsl(var(--primary)/0.6)]"
            >
              <Check className="h-4 w-4" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </div>
  );
}

/* ─── SmallPlanCard ────────────────────────────────────────────── */
function SmallPlanCard({
  plan,
  active,
  onClick,
}: {
  plan: (typeof PLANS)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative text-left rounded-[18px] p-4 pressable overflow-hidden transition-all duration-300"
      style={
        active
          ? {
              background: "linear-gradient(145deg, hsl(var(--primary) / 0.12) 0%, hsl(var(--primary) / 0.04) 100%)",
              boxShadow: "0 0 0 1.5px hsl(var(--primary) / 0.6), 0 8px 20px -8px hsl(var(--primary) / 0.3)",
            }
          : {
              background: "hsl(var(--surface-elevated) / 0.6)",
              boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.08), 0 0 0 1px hsl(var(--border) / 0.5)",
            }
      }
    >
      <p className={`text-[10.5px] font-bold uppercase tracking-[0.14em] mb-1.5 ${active ? "text-primary/90" : "text-secondary-fg/60"}`}>
        {plan.label}
      </p>
      <div className="flex items-baseline gap-1">
        <span className={`font-display text-[22px] font-bold tabular-nums leading-none tracking-tight ${active ? "text-foreground" : "text-foreground/85"}`}>
          {plan.price}
        </span>
      </div>
      <p className={`text-[11px] mt-1 font-medium ${active ? "text-secondary-fg/80" : "text-secondary-fg/60"}`}>
        {plan.period}
      </p>

      <AnimatePresence>
        {active && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 440, damping: 28 }}
            className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_3px_8px_hsl(var(--primary)/0.4)]"
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
