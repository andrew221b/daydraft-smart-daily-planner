import { Shell } from "@/components/app/Shell";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { Fingerprint, Sparkles, Bell, Calendar, FileText, Shield, Trash2, HelpCircle } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { clearStoredPasskey, enrollPasskey, getStoredPasskey, passkeySupported } from "@/lib/passkeys";
import { toast } from "sonner";
import { useEntitlement } from "@/hooks/useEntitlement";
import { isSimulateProUiAllowed, writeDevSimulatePro } from "@/lib/devEntitlement";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { ProFeatureHighlights } from "@/components/app/ProFeatureHighlights";
import { enablePush, disablePush, pushSupported } from "@/lib/push";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { VisualMode, useVisualMode } from "@/lib/visualMode";

export default function Settings() {
  const { profile, update } = useProfile();
  const { signOut, user } = useAuth();
  const tour = useTour();
  const nav = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const [hasPasskey, setHasPasskey] = useState(!!getStoredPasskey());
  const { entitlement, isPro, devSimulatePro, subscriptionPro, planQuotaUsed, planQuotaLimit, planQuotaRemaining } = useEntitlement();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [proSheetOpen, setProSheetOpen] = useState(false);
  const [calConnecting, setCalConnecting] = useState(false);
  const [visualMode, setVisualMode] = useVisualMode();
  useEffect(() => { if (profile) setName(profile.display_name || ""); }, [profile?.id]);

  useEffect(() => {
    const hash = location.hash;
    if (hash === "#pro-features") {
      setProSheetOpen(true);
      return;
    }
    if (hash !== "#week-intention") return;
    const id = requestAnimationFrame(() => {
      document.getElementById("week-intention")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [location.hash]);

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
        <h1 className="type-title mt-2 text-balance">Settings</h1>

        <div className="mt-8 space-y-8">
          <ProCard
            entitlement={entitlement} isPro={isPro} subscriptionPro={subscriptionPro} devSimulatePro={devSimulatePro}
            planQuotaUsed={planQuotaUsed} planQuotaLimit={planQuotaLimit} planQuotaRemaining={planQuotaRemaining}
            onUpgrade={() => setUpgradeOpen(true)}
            onOpenDetails={!isPro ? () => setProSheetOpen(true) : undefined}
          />
          {isSimulateProUiAllowed() && (
            <Section title="Developer">
              <div className="rounded-[14px] border border-dashed border-soft surface-card px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[14px] text-foreground">Simulate Pro</div>
                    <p className="text-[11px] text-secondary-fg mt-1 leading-relaxed">
                      Unlocks Pro UI in this browser. Server planning quota still follows your real subscription unless you enable this for testing.
                    </p>
                  </div>
                  <Switch
                    checked={!!devSimulatePro}
                    onCheckedChange={(v) => writeDevSimulatePro(v)}
                  />
                </div>
              </div>
            </Section>
          )}

          {/* 2. Profile — name + appearance grouped */}
          <Section title="You">
            <div className="rounded-[14px] border border-soft surface-card backdrop-blur-sm divide-y divide-border/50 overflow-hidden">
              <div className="px-3 py-2.5">
                <div className="text-[11px] text-secondary-fg mb-1">Name</div>
                <Input value={name} onChange={e => setName(e.target.value)} onBlur={() => update({ display_name: name })}
                  className="h-9 bg-transparent border-0 px-0 focus-visible:ring-0 text-[14px]" />
              </div>
              <div className="px-3 py-3">
                <div className="text-[11px] text-secondary-fg mb-2">Appearance</div>
                <ThemeToggle />
                <div className="mt-3">
                  <div className="text-[11px] text-secondary-fg mb-1.5">Visual mode</div>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { key: "standard", label: "Standard" },
                      { key: "neon", label: "Neon" },
                    ] as Array<{ key: VisualMode; label: string }>).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setVisualMode(opt.key)}
                        className={`h-9 rounded-lg border text-[11px] font-medium pressable ${
                          visualMode === opt.key
                            ? "surface-accent border-accent text-primary"
                            : "surface-soft border-soft text-secondary-fg"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-secondary-fg leading-relaxed">
                    Standard — calm, clean interface. Neon — brighter accents and glow.
                  </p>
                </div>
              </div>
            </div>
          </Section>

          {/* 4. Notifications + Calendar — connected channels */}
          <Section title="Connections">
            <div className="rounded-[14px] border border-soft surface-card backdrop-blur-sm divide-y divide-border/50 overflow-hidden">
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
      <Sheet open={proSheetOpen} onOpenChange={setProSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-[24px] border-soft max-h-[85vh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-[17px]">Included with Pro</SheetTitle>
            <SheetDescription className="text-[13px]">
              Full list — same features you unlock at checkout.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 pb-6">
            <ProFeatureHighlights onUpgrade={() => { setProSheetOpen(false); setUpgradeOpen(true); }} />
          </div>
        </SheetContent>
      </Sheet>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
    </Shell>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="text-[10px] uppercase tracking-[0.14em] text-secondary-fg mb-2 font-medium">{title}</div>
    {children}
  </div>
);

const ProCard = ({ entitlement, isPro, subscriptionPro, devSimulatePro, planQuotaUsed, planQuotaLimit, planQuotaRemaining, onUpgrade, onOpenDetails }: {
  entitlement: ReturnType<typeof useEntitlement>["entitlement"];
  isPro: boolean;
  subscriptionPro: boolean;
  devSimulatePro: boolean;
  planQuotaUsed: number;
  planQuotaLimit: number;
  planQuotaRemaining: number;
  onUpgrade: () => void;
  onOpenDetails?: () => void;
}) => {
  const tier = entitlement?.tier || "free";
  const badge = devSimulatePro && !subscriptionPro
    ? "Pro (simulated)"
    : tier === "pro" ? "Pro"
    : tier === "trial" ? `Trial · ${entitlement?.daysLeftInTrial}d left`
    : "Free";
  const lowFreeDays = !isPro && Number.isFinite(planQuotaRemaining) && planQuotaRemaining <= 2;

  return (
    <div
      className={`rounded-[18px] border backdrop-blur-sm p-4 shadow-card surface-accent ${
        lowFreeDays ? "border-primary/50 ring-1 ring-primary/15" : "border-accent"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-semibold text-primary uppercase tracking-[0.14em]">{badge}</span>
      </div>
      <div className="text-[15px] font-display font-semibold mt-2 text-foreground leading-tight">
        {isPro ? "You're on Pro" : "Make planning unlimited"}
      </div>
      <div className="text-[13px] mt-1 text-secondary-fg leading-relaxed">
        {isPro
          ? "Calendar sync, pattern-aware AI, and every premium feature stay on."
          : `${planQuotaUsed} of ${planQuotaLimit} free planning days used — then AI planning pauses until you upgrade.`}
      </div>
      {!isPro && lowFreeDays && (
        <p className="text-[12px] font-medium text-primary mt-2 leading-snug">
          Only {planQuotaRemaining} free planning day{planQuotaRemaining === 1 ? "" : "s"} left. Upgrade so a busy week never blocks the next.
        </p>
      )}
      {!isPro && onOpenDetails && (
        <button
          type="button"
          id="pro-features"
          onClick={onOpenDetails}
          className="mt-3 text-[12px] font-medium text-primary pressable block"
        >
          What&apos;s included · Full list
        </button>
      )}
      {!isPro && (
        <p className="text-[11px] text-secondary-fg mt-2.5 leading-relaxed">
          Each calendar day you run <strong className="text-foreground font-medium">Generate plan</strong> counts once. Re-planning the same day is free.
        </p>
      )}
      {!isPro && (
        <Button onClick={onUpgrade} className="w-full mt-3 h-11 rounded-xl bg-primary hover:bg-primary/92 text-primary-foreground text-[14px] font-semibold pressable shadow-card">
          See Pro & unlock everything
        </Button>
      )}
      {isPro && subscriptionPro && (
        <button onClick={() => toast("Subscription management will be available soon")}
          className="w-full mt-3 h-10 rounded-[12px] text-[12px] text-secondary-fg border border-soft surface-card pressable hover:text-foreground">
          Manage subscription
        </button>
      )}
    </div>
  );
};
