import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { Fingerprint, Sparkles, Bell, FileText, Shield, Trash2, HelpCircle, Download, Loader2 } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { toast } from "sonner";
import { useEntitlement } from "@/hooks/useEntitlement";
import { isSimulateProUiAllowed, writeDevSimulatePro } from "@/lib/devEntitlement";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { ProFeatureHighlights } from "@/components/app/ProFeatureHighlights";
import { enablePush, disablePush, pushAvailability, pushAvailabilityCopy } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { triggerDownload } from "@/lib/reportExport";
import { useTour, TOUR_TODAY } from "@/components/app/Tour";
import { VisualMode, useVisualMode } from "@/lib/visualMode";
import { PerfDebugPanel } from "@/components/app/PerfDebugPanel";

export default function Settings() {
  const { profile, update } = useProfile();
  const { signOut, user } = useAuth();
  const tour = useTour();
  const nav = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const [hasPasskey, setHasPasskey] = useState(localStorage.getItem("daydraft.applock") === "true");
  const { entitlement, isPro, devSimulatePro, subscriptionPro, planQuotaUsed, planQuotaLimit, planQuotaRemaining } = useEntitlement();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [proSheetOpen, setProSheetOpen] = useState(false);

  const [visualMode, setVisualMode] = useVisualMode();
  const [pushState] = useState(() => pushAvailability());
  const pushReady = pushState === "ok";
  // Hidden developer panel — tap the version label 10× in 3s to open.
  const [versionTaps, setVersionTaps] = useState(0);
  const [perfPanelOpen, setPerfPanelOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-user-data");
      if (error) throw error;
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const filename = `daydraft-export-${new Date().toISOString().slice(0, 10)}.json`;
      await triggerDownload(blob, filename, "application/json");
      toast.success("Export downloaded");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };
  useEffect(() => {
    if (versionTaps === 0) return;
    const id = window.setTimeout(() => setVersionTaps(0), 3000);
    return () => window.clearTimeout(id);
  }, [versionTaps]);
  useEffect(() => { if (profile) setName(profile.display_name || ""); }, [profile]);

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
    try {
      const { isAvailable } = await NativeBiometric.isAvailable();
      if (!isAvailable) {
        toast.error("Biometrics not available or not configured on this device");
        return;
      }
      
      if (hasPasskey) {
        localStorage.removeItem("daydraft.applock");
        setHasPasskey(false);
        toast.success("App Lock disabled");
      } else {
        // Require them to authenticate once to enable it
        await NativeBiometric.verifyIdentity({
          reason: "Verify identity to enable App Lock",
          title: "Enable App Lock"
        });
        localStorage.setItem("daydraft.applock", "true");
        setHasPasskey(true);
        toast.success("App Lock enabled");
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to configure App Lock");
    }
  };

  const togglePush = async (v: boolean) => {
    if (!user) return;
    if (v && !pushReady) {
      // Don't toast — the inline helper under the row already explains why and
      // what to do. Toasting on every tap is noise.
      return;
    }
    try {
      if (v) {
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



  return (
    <>
      <div className="px-5 pt-[var(--content-inset-top)]">
        <header className="shrink-0 pb-5">
          <p className="eyebrow">Account</p>
          <h1 className="page-title mt-2 text-balance">Settings</h1>
        </header>

        <div className="space-y-8">
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
            <div className="rounded-[18px] border border-border/35 hero-glass divide-y divide-border/35 overflow-hidden">
              <div className="px-4 py-3">
                <div className="text-[11px] text-secondary-fg mb-1">Name</div>
                <Input value={name} onChange={e => setName(e.target.value)} onBlur={() => update({ display_name: name })}
                  className="h-9 bg-transparent border-0 px-0 focus-visible:ring-0 text-[14px]" />
              </div>
              <div className="px-4 py-3">
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
            <div className="rounded-[18px] border border-border/35 hero-glass divide-y divide-border/35 overflow-hidden">
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Bell className={`h-4 w-4 ${pushReady ? "text-secondary-fg" : "text-secondary-fg/55"}`} />
                    <div className="min-w-0">
                      <div className={`text-[14px] ${pushReady ? "" : "text-foreground/70"}`}>Daily nudges</div>
                      {pushReady && (
                        <div className="text-[11px] text-secondary-fg/75 mt-0.5">
                          Gentle pings as your day unfolds.
                        </div>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={pushReady && !!profile?.notifications_enabled}
                    disabled={!pushReady}
                    onCheckedChange={togglePush}
                  />
                </div>
                {!pushReady && (
                  <div className="mt-2.5 rounded-[10px] border border-primary/20 bg-primary/[0.06] px-3 py-2.5">
                    <div className="text-[12px] font-medium text-foreground/90 leading-snug">
                      {pushAvailabilityCopy[pushState].title}
                    </div>
                    <p className="text-[12px] text-secondary-fg mt-1 leading-relaxed">
                      {pushAvailabilityCopy[pushState].body}
                    </p>
                  </div>
                )}
              </div>

              <button onClick={togglePasskey}
                className="w-full flex items-center justify-between px-4 py-3 ios-row">
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
            <div className="rounded-[18px] border border-border/35 hero-glass divide-y divide-border/35 overflow-hidden">
              <button
                onClick={async () => {
                  await tour.resetAll();
                  nav("/home");
                  setTimeout(() => tour.start(TOUR_TODAY, { force: true }), 400);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 ios-row"
              >
                <HelpCircle className="h-4 w-4 text-secondary-fg" />
                <span className="text-[14px] flex-1 text-left">Replay tutorial</span>
                <span className="text-secondary-fg">›</span>
              </button>
              <Link to="/privacy" className="flex items-center gap-3 px-4 py-3 ios-row">
                <Shield className="h-4 w-4 text-secondary-fg" />
                <span className="text-[14px] flex-1">Privacy</span>
                <span className="text-secondary-fg">›</span>
              </Link>
              <Link to="/terms" className="flex items-center gap-3 px-4 py-3 ios-row">
                <FileText className="h-4 w-4 text-secondary-fg" />
                <span className="text-[14px] flex-1">Terms</span>
                <span className="text-secondary-fg">›</span>
              </Link>
              <button
                type="button"
                onClick={handleExportData}
                disabled={exporting}
                className="w-full flex items-center gap-3 px-4 py-3 ios-row text-left disabled:opacity-60"
              >
                {exporting
                  ? <Loader2 className="h-4 w-4 text-secondary-fg animate-spin" />
                  : <Download className="h-4 w-4 text-secondary-fg" />}
                <span className="text-[14px] flex-1">
                  {exporting ? "Preparing your export…" : "Export my data"}
                </span>
                <span className="text-secondary-fg">›</span>
              </button>
              <Link to="/settings/delete-account" className="flex items-center gap-3 px-4 py-3 ios-row text-destructive">
                <Trash2 className="h-4 w-4" />
                <span className="text-[14px] flex-1">Delete account</span>
                <span>›</span>
              </Link>
            </div>
          </Section>

          <Button onClick={signOut} variant="outline" className="w-full h-11 rounded-[14px] border-border/35 hero-glass hover:bg-white/[0.06] pressable text-[13px]">
            Sign out
          </Button>

          <button
            type="button"
            onClick={() => {
              setVersionTaps((n) => {
                const next = n + 1;
                if (next >= 10) {
                  setPerfPanelOpen(true);
                  return 0;
                }
                return next;
              });
            }}
            className="block w-full text-center text-[11px] text-secondary-fg pt-1 select-none"
            aria-label="App version"
          >
            DayDraft · v1.0
          </button>
          <PerfDebugPanel open={perfPanelOpen} onOpenChange={setPerfPanelOpen} />
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
    </>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="eyebrow mb-2">{title}</div>
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
  const isOverQuota = !isPro && Number.isFinite(planQuotaRemaining) && planQuotaRemaining <= 0;
  const lowFreeDays = !isPro && !isOverQuota && Number.isFinite(planQuotaRemaining) && planQuotaRemaining <= 2;
  // Visual cap: never show "7 of 5" — the over-quota state has its own message below.
  const displayUsed = !isPro && Number.isFinite(planQuotaLimit) ? Math.min(planQuotaUsed, planQuotaLimit) : planQuotaUsed;

  return (
    <div
      className={`rounded-[18px] border backdrop-blur-sm p-4 shadow-card surface-accent deep-float ${
        isOverQuota
          ? "border-primary/60 ring-1 ring-primary/20"
          : lowFreeDays
            ? "border-primary/50 ring-1 ring-primary/15"
            : "border-accent"
      }`}
      style={{ animationDelay: '0.2s' }}
    >
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-semibold text-primary uppercase tracking-[0.14em]">{badge}</span>
      </div>
      <div className="text-[15px] font-display font-semibold mt-2 text-foreground leading-tight">
        {isPro ? "You're on Pro" : isOverQuota ? "Free trial used up" : "Make planning unlimited"}
      </div>
      <div className="text-[13px] mt-1 text-secondary-fg leading-relaxed">
        {isPro
          ? "Calendar sync, pattern-aware AI, and every premium feature stay on."
          : isOverQuota
            ? `You've used all ${planQuotaLimit} free planning days. New plans are paused — upgrade to keep going.`
            : `${displayUsed} of ${planQuotaLimit} free planning days used — then new plans are paused until you upgrade.`}
      </div>
      {!isPro && lowFreeDays && (
        <p className="text-[12px] font-medium text-primary mt-2 leading-snug">
          {planQuotaRemaining === 1
            ? "Just 1 free planning day left. Upgrade so a busy week never blocks the next."
            : `Only ${planQuotaRemaining} free planning days left. Upgrade so a busy week never blocks the next.`}
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
      {!isPro && !isOverQuota && (
        <p className="text-[11px] text-secondary-fg mt-2.5 leading-relaxed">
          Each calendar day with tasks counts once. Re-planning or adding more tasks to the same day is free.
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
