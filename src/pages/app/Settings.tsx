import { Shell } from "@/components/app/Shell";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { peakWindow } from "@/lib/daydraft";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { Fingerprint, Sparkles, Bell, Calendar, FileText, Shield, Trash2, HelpCircle, MessageCircle, Clock, ChevronDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Link, useNavigate } from "react-router-dom";
import { clearStoredPasskey, enrollPasskey, getStoredPasskey, passkeySupported } from "@/lib/passkeys";
import { toast } from "sonner";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { enablePush, disablePush, pushSupported } from "@/lib/push";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { getWeekIntention, setWeekIntention } from "@/lib/weekIntention";
import { useCalmMode } from "@/lib/calmMode";

const energies = [
  { key: "morning" as const, label: "Morning person" },
  { key: "midday" as const, label: "Midday flow" },
  { key: "night" as const, label: "Night owl" },
];

const TONES: Array<{ key: NonNullable<ReturnType<typeof useProfile>["profile"]>["ai_tone"]; label: string; sub: string }> = [
  { key: "professional", label: "Professional", sub: "Clear, concise, practical" },
  { key: "coach", label: "Coach", sub: "Supportive and structured" },
  { key: "playful", label: "Playful", sub: "Light and friendly" },
  { key: "motivational", label: "Motivational", sub: "Energetic and momentum-first" },
  { key: "tough_love", label: "Tough love", sub: "Direct accountability" },
  { key: "philosophical", label: "Philosophical", sub: "Reflective and thoughtful" },
  { key: "custom", label: "Custom", sub: "Define your own voice" },
];

export default function Settings() {
  const { profile, update } = useProfile();
  const { signOut, user } = useAuth();
  const tour = useTour();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [hasPasskey, setHasPasskey] = useState(!!getStoredPasskey());
  const { entitlement, isPro, planQuotaUsed, planQuotaLimit } = useEntitlement();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [calConnecting, setCalConnecting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [calmMode, setCalmMode] = useCalmMode();
  useEffect(() => { if (profile) setName(profile.display_name || ""); }, [profile?.id]);

  useEffect(() => {
    if (window.location.hash !== "#week-intention") return;
    const id = requestAnimationFrame(() => {
      document.getElementById("week-intention")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const togglePasskey = async () => {
    if (hasPasskey) {
      clearStoredPasskey();
      setHasPasskey(false);
      update({ passkey_enabled: false } as any);
      toast.success("Face ID / fingerprint disabled");
      return;
    }
    if (!user) return;
    if (!passkeySupported()) { toast.error("Not supported on this device"); return; }
    try {
      await enrollPasskey({
        userId: user.id,
        userEmail: user.email || "user@daydraft.app",
        userName: profile?.display_name || user.email || "DayDraft user",
      });
      setHasPasskey(true);
      update({ passkey_enabled: true } as any);
      toast.success("Face ID / fingerprint enabled");
    } catch (e: any) {
      toast.error(e?.message || "Unable to enable passkey");
    }
  };

  const togglePush = async (v: boolean) => {
    if (!user) return;
    try {
      if (v) {
        if (!pushSupported()) { toast.error("Notifications not supported on this device"); return; }
        await enablePush(user.id);
        update({ notifications_enabled: true });
        toast.success("Notifications enabled");
      } else {
        await disablePush(user.id);
        update({ notifications_enabled: false });
      }
    } catch (e: any) {
      toast.error(e.message || "Unable to update notification settings");
    }
  };

  const connectCalendar = async () => {
    if (!isPro) { setUpgradeOpen(true); return; }
    setCalConnecting(true);
    try {
      const clientId = import.meta.env.VITE_GOOGLE_CALENDAR_CLIENT_ID as string | undefined;
      if (!clientId) {
        toast("Calendar sync is not configured yet. We will notify you when it becomes available.");
        return;
      }
      const redirect = `${window.location.origin}/settings`;
      const scope = encodeURIComponent("https://www.googleapis.com/auth/calendar.readonly");
      const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&access_type=offline&prompt=consent&scope=${scope}`;
      window.location.href = url;
    } finally {
      setCalConnecting(false);
    }
  };

  return (
    <Shell>
      <div className="px-6 pt-12">
        <p className="eyebrow">Account</p>
        <h1 className="font-display text-[26px] font-semibold tracking-tight mt-2 text-balance">Settings</h1>

        <div className="mt-8 space-y-8">
          {/* 1. Plan card — most important context */}
          <ProCard
            entitlement={entitlement} isPro={isPro}
            planQuotaUsed={planQuotaUsed} planQuotaLimit={planQuotaLimit}
            onUpgrade={() => setUpgradeOpen(true)}
          />

          <div id="week-intention" className="scroll-mt-28">
            <Section title="This week's focus">
              <WeekIntentionEditor />
            </Section>
          </div>

          {/* 2. Profile — name + appearance grouped */}
          <Section title="You">
            <div className="rounded-[18px] border border-soft surface-card backdrop-blur-sm divide-y divide-border/50 overflow-hidden">
              <div className="px-3 py-2.5">
                <div className="text-[11px] text-secondary-fg mb-1">Name</div>
                <Input value={name} onChange={e => setName(e.target.value)} onBlur={() => update({ display_name: name })}
                  className="h-9 bg-transparent border-0 px-0 focus-visible:ring-0 text-[14px]" />
              </div>
              <div className="px-3 py-3">
                <div className="text-[11px] text-secondary-fg mb-2">Appearance</div>
                <ThemeToggle />
              </div>
            </div>
          </Section>

          {/* 3. AI tone — single most-used preference */}
          <Section title="AI tone">
            <p className="text-[12px] text-secondary-fg mb-2 leading-relaxed">
              This affects how AI writes plans, task help, nudges, and recap insights.
            </p>
            <div className="rounded-[18px] border border-soft surface-card backdrop-blur-sm divide-y divide-border/50 overflow-hidden">
              {TONES.map(t => {
                const active = (profile?.ai_tone || "professional") === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => update({ ai_tone: t.key } as any)}
                    className={`w-full flex items-center justify-between px-4 py-3 pressable transition-colors ${active ? "surface-accent" : "hover:bg-surface-elevated"}`}
                  >
                    <div className="text-left">
                      <div className="text-[14px] text-foreground">{t.label}</div>
                      <div className="text-[11px] text-secondary-fg mt-0.5">{t.sub}</div>
                    </div>
                    {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </button>
                );
              })}
            </div>
            {profile?.ai_tone === "custom" && (
              <Textarea
                value={profile?.ai_tone_custom || ""}
                onChange={(e) => update({ ai_tone_custom: e.target.value } as any)}
                placeholder="e.g. talk to me like a calm Stoic mentor; no emojis; concise"
                className="mt-2 min-h-[70px] surface-card border-soft rounded-xl text-[13px]"
              />
            )}
          </Section>

          {/* 4. Notifications + Calendar — connected channels */}
          <Section title="Connections">
            <div className="rounded-[18px] border border-soft surface-card backdrop-blur-sm divide-y divide-border/50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <Bell className="h-4 w-4 text-secondary-fg" />
                  <div className="text-[14px]">Daily nudges</div>
                </div>
                <Switch checked={!!profile?.notifications_enabled} onCheckedChange={togglePush} />
              </div>
              <button onClick={connectCalendar}
                className="w-full flex items-center justify-between px-4 py-3 pressable hover:bg-surface-elevated">
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-secondary-fg" />
                  <div className="text-[14px] text-left">Google Calendar</div>
                </div>
                <span className="text-[12px] font-medium text-primary">{isPro ? "Connect" : "Pro"}</span>
              </button>
              <button onClick={togglePasskey}
                className="w-full flex items-center justify-between px-4 py-3 pressable hover:bg-surface-elevated">
                <div className="flex items-center gap-3">
                  <Fingerprint className="h-4 w-4 text-secondary-fg" />
                  <div className="text-[14px] text-left">Face ID / fingerprint</div>
                </div>
                <span className={`text-[12px] font-medium ${hasPasskey ? "text-success" : "text-secondary-fg"}`}>
                  {hasPasskey ? "On" : "Off"}
                </span>
              </button>
            </div>
          </Section>

          <Section title="Focus experience">
            <div className="rounded-[18px] border border-soft surface-card backdrop-blur-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[14px]">Calm mode</div>
                  <p className="text-[11px] text-secondary-fg mt-0.5">
                    Show only essential actions on Today and DayView.
                  </p>
                </div>
                <Switch checked={calmMode} onCheckedChange={setCalmMode} />
              </div>
            </div>
          </Section>

          {/* 5. Advanced — collapsed by default */}
          <Section title="Advanced">
            <button
              onClick={() => setAdvancedOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-[16px] border border-soft surface-card backdrop-blur-sm pressable hover:bg-surface-elevated/80"
            >
              <span className="text-[14px]">Active hours & energy</span>
              <ChevronDown className={`h-4 w-4 text-secondary-fg transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </button>
            {advancedOpen && (
              <div className="mt-2 space-y-2">
                <div className="app-card p-3 space-y-2.5">
                  <div className="text-[11px] text-secondary-fg">Active hours — when AI may schedule tasks.</div>
                  <div className="flex items-center gap-3">
                    <label className="flex-1">
                      <div className="text-[10px] text-secondary-fg mb-1">From</div>
                      <input
                        type="time"
                        value={profile?.active_hours_start || "09:00"}
                        onChange={(e) => update({ active_hours_start: e.target.value } as any)}
                        className="w-full h-9 px-3 rounded-lg bg-background border border-soft text-[13px] tabular-nums"
                      />
                    </label>
                    <label className="flex-1">
                      <div className="text-[10px] text-secondary-fg mb-1">To</div>
                      <input
                        type="time"
                        value={profile?.active_hours_end || "22:00"}
                        onChange={(e) => update({ active_hours_end: e.target.value } as any)}
                        className="w-full h-9 px-3 rounded-lg bg-background border border-soft text-[13px] tabular-nums"
                      />
                    </label>
                  </div>
                </div>
                <div className="rounded-[18px] border border-soft surface-card backdrop-blur-sm divide-y divide-border/50 overflow-hidden">
                  {energies.map(e => {
                    const active = profile?.energy_preference === e.key;
                    return (
                      <button key={e.key} onClick={() => update({ energy_preference: e.key })}
                        className={`w-full flex items-center justify-between px-4 py-3 pressable transition-colors ${active ? "surface-accent" : "hover:bg-surface-elevated"}`}>
                        <span className="text-[13px]">{e.label}</span>
                        <span className="text-[11px] text-secondary-fg tabular-nums">{peakWindow(e.key)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </Section>

          {/* 6. Help + legal — quiet, terminal items */}
          <Section title="More">
            <div className="rounded-[18px] border border-soft surface-card backdrop-blur-sm divide-y divide-border/50 overflow-hidden">
              <button
                onClick={async () => {
                  await tour.resetAll();
                  nav("/today");
                  setTimeout(() => tour.start(TOUR_TODAY, { force: true }), 400);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 pressable hover:bg-surface-elevated"
              >
                <HelpCircle className="h-4 w-4 text-secondary-fg" />
                <span className="text-[14px] flex-1 text-left">Replay tutorial</span>
                <span className="text-secondary-fg">›</span>
              </button>
              <Link to="/privacy" className="flex items-center gap-3 px-4 py-3 pressable hover:bg-surface-elevated">
                <Shield className="h-4 w-4 text-secondary-fg" />
                <span className="text-[14px] flex-1">Privacy</span>
                <span className="text-secondary-fg">›</span>
              </Link>
              <Link to="/terms" className="flex items-center gap-3 px-4 py-3 pressable hover:bg-surface-elevated">
                <FileText className="h-4 w-4 text-secondary-fg" />
                <span className="text-[14px] flex-1">Terms</span>
                <span className="text-secondary-fg">›</span>
              </Link>
              <Link to="/settings/delete-account" className="flex items-center gap-3 px-4 py-3 pressable hover:bg-surface-elevated text-destructive">
                <Trash2 className="h-4 w-4" />
                <span className="text-[14px] flex-1">Delete account</span>
                <span>›</span>
              </Link>
            </div>
          </Section>

          <Button onClick={signOut} variant="outline" className="w-full h-11 rounded-xl border-soft surface-card hover:bg-surface-elevated pressable text-[13px]">
            Sign out
          </Button>

          <p className="text-center text-[11px] text-secondary-fg pt-1">DayDraft · v1.0</p>
        </div>
      </div>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
    </Shell>
  );
}

function WeekIntentionEditor() {
  const [txt, setTxt] = useState("");
  useEffect(() => {
    setTxt(getWeekIntention()?.text ?? "");
  }, []);
  return (
    <div className="app-card overflow-hidden p-0 border-soft">
      <p className="text-[12.5px] text-secondary-fg px-4 pt-4 leading-relaxed">
        One line that stays pinned on <strong className="text-foreground font-medium">Today</strong> until Monday. Use it for a theme, a deadline, or how you want to feel — not a task list.
      </p>
      <Textarea
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        placeholder="e.g. Ship the beta · stay calm under load"
        className="mx-3 my-3 min-h-[72px] bg-background border-soft rounded-xl text-[13px]"
      />
      <div className="flex gap-2 px-3 pb-3">
        <Button
          type="button"
          className="flex-1 h-10 rounded-xl text-[13px]"
          onClick={() => {
            setWeekIntention(txt);
            window.dispatchEvent(new Event("dd-week-intent"));
            toast.success("Saved — check Today");
          }}
        >
          Save for this week
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 rounded-xl text-[12px] px-3"
          onClick={() => {
            setTxt("");
            setWeekIntention("");
            window.dispatchEvent(new Event("dd-week-intent"));
            toast("Weekly focus cleared");
          }}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="text-[10px] uppercase tracking-[0.14em] text-secondary-fg mb-2 font-medium">{title}</div>
    {children}
  </div>
);

const ProCard = ({ entitlement, isPro, planQuotaUsed, planQuotaLimit, onUpgrade }: {
  entitlement: ReturnType<typeof useEntitlement>["entitlement"];
  isPro: boolean;
  planQuotaUsed: number;
  planQuotaLimit: number;
  onUpgrade: () => void;
}) => {
  const tier = entitlement?.tier || "free";
  const badge = tier === "pro" ? "Pro"
    : tier === "trial" ? `Trial · ${entitlement?.daysLeftInTrial}d left`
    : "Free";
  return (
    <div className="rounded-[18px] border border-accent surface-accent backdrop-blur-sm p-4 shadow-card">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-semibold text-primary uppercase tracking-[0.14em]">{badge}</span>
      </div>
      <div className="text-[13px] mt-1.5 text-foreground">
        {isPro
          ? "Unlimited plans, calendar sync, and everything."
          : `${planQuotaUsed} of ${planQuotaLimit} free planning days used in the last 7 days.`}
      </div>
      {!isPro && (
        <p className="text-[11px] text-secondary-fg mt-2 leading-relaxed">
          Each calendar day you run <strong className="text-foreground font-medium">Generate plan</strong> counts once. Re-planning the same day doesn&apos;t cost extra slots.
        </p>
      )}
      {!isPro && (
        <Button onClick={onUpgrade} className="w-full mt-3 h-10 rounded-lg bg-primary hover:bg-primary/92 text-primary-foreground text-[13px] font-medium pressable">
          Start free trial
        </Button>
      )}
      {isPro && (
        <button onClick={() => toast("Subscription management will be available soon")}
          className="w-full mt-3 h-10 rounded-[12px] text-[12px] text-secondary-fg border border-soft surface-card pressable hover:text-foreground">
          Manage subscription
        </button>
      )}
    </div>
  );
};
