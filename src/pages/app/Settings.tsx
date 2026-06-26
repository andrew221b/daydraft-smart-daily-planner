import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { Input, DebouncedInput } from "@/components/ui/input";
import { DebouncedTextarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { BiometricAura } from "@/components/app/BiometricAura";
import { Sparkles, AlarmClock, FileText, Shield, Trash2, Download, Loader2, ScanFace, Fingerprint, Lock, Vibrate, Lightbulb, LifeBuoy, ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import {
  getAppLockEnabled, setAppLockEnabled,
  getGatePref, setGatePref,
  getBiometricInfo, type BiometricInfo,
} from "@/lib/biometricGate";
import { haptics, getHapticsEnabled, setHapticsEnabled } from "@/lib/haptics";
import { toast } from "sonner";
import { useEntitlement } from "@/hooks/useEntitlement";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { ProFeatureHighlights } from "@/components/app/ProFeatureHighlights";
import { SupportDialog } from "@/components/app/SupportDialog";
import { pushAvailability, pushAvailabilityCopy } from "@/lib/push";
import {
  getNotificationsEnabled,
  setNotificationsEnabled,
  getDailyNudgesEnabled,
  setDailyNudgesEnabled,
  syncDailyNudges,
  cancelDailyNudges,
} from "@/lib/localNotifications";
import { supabase } from "@/integrations/supabase/client";
import { triggerDownload } from "@/lib/reportExport";
import { useHints } from "@/hooks/useHints";


export default function Settings() {
  const { profile, update } = useProfile();
  const { signOut } = useAuth();
  const hints = useHints();
  const location = useLocation();
  const [name, setName] = useState("");
  // "About you" — sent to AI alongside every plan / morning insight so it can
  // tailor advice to the user's actual life. Saved on demand (not on blur),
  // because the input is multi-line and accidental focus losses on mobile
  // would otherwise spam writes mid-thought.
  const [aboutDraft, setAboutDraft] = useState("");
  const [aboutSaving, setAboutSaving] = useState(false);
  const { entitlement, isPro, subscriptionPro, planQuotaUsed, planQuotaLimit, planQuotaRemaining, refresh: refreshEntitlement } = useEntitlement();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [proSheetOpen, setProSheetOpen] = useState(false);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);

  const [pushState, setPushState] = useState(() => pushAvailability());
  const pushReady = pushState === "ok";

  // ── Biometric / Security ──────────────────────────────────────────────────
  const [bioInfo, setBioInfo] = useState<BiometricInfo | null>(null);
  const [appLockOn, setAppLockOn] = useState<boolean>(() => getGatePref() === "on");
  const [bioTogglingLock, setBioTogglingLock] = useState(false);
  const [hapticsOn, setHapticsOn] = useState<boolean>(() => getHapticsEnabled());
  const [taskRemindersOn, setTaskRemindersOn] = useState<boolean>(() => getNotificationsEnabled());
  const [dailyNudgesOn, setDailyNudgesOn] = useState<boolean>(() => getDailyNudgesEnabled());


  const toggleHaptics = (enable: boolean) => {
    setHapticsEnabled(enable);     // persist BEFORE the buzz so an enable can fire
    setHapticsOn(enable);
    if (enable) haptics.selection(); // confirmation tap, only when turning on
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    getBiometricInfo().then(setBioInfo);
  }, []);

  // Settings is kept alive in PersistentTabs — useState() initializer runs once.
  // Re-read the gate pref whenever the settings path becomes active so changes
  // made via BiometricGateSheet (from Reports/billing) are reflected here.
  useEffect(() => {
    if (location.pathname === "/settings") {
      // Settings stays mounted (PersistentTabs) — re-read everything that can
      // change while the user is on another tab: biometric pref, OS push
      // capability, and subscription tier (re-fetch so the label isn't stale).
      setAppLockOn(getGatePref() === "on");
      setPushState(pushAvailability());
      void refreshEntitlement();
    }
  }, [location.pathname, refreshEntitlement]);

  const toggleAppLock = async (enable: boolean) => {
    if (bioTogglingLock) return;
    if (enable) {
      setBioTogglingLock(true);
      // Wait for the gorgeous custom overlay to animate in before native UI takes over
      await new Promise((r) => setTimeout(r, 450));
      try {
        await NativeBiometric.verifyIdentity({
          reason: "Enable Biometric Lock",
          title: "Confirm identity",
          subtitle: "Verify to enable Biometric Lock",
          description: "Keep your sensitive data private.",
        });
        setGatePref("on");
        setAppLockOn(true);
        haptics.notify("success");
      } catch {
        /* user cancelled — stay as-is */
      } finally {
        setBioTogglingLock(false);
      }
    } else {
      setGatePref("off");
      setAppLockOn(false);
      haptics.selection();
    }
  };

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

  useEffect(() => { if (profile) setName(profile.display_name || ""); }, [profile]);
  useEffect(() => {
    if (!profile) return;
    setAboutDraft(profile.ai_context_custom || "");
    // Only resync the draft when the server-side value actually changes —
    // tracking the whole `profile` would clobber the user's typing on every
    // unrelated profile mutation (theme toggle, push opt-in, etc.).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.ai_context_custom]);

  const aboutDirty = (profile?.ai_context_custom || "") !== aboutDraft;
  const saveAbout = async () => {
    if (!aboutDirty || aboutSaving) return;
    setAboutSaving(true);
    try {
      const next = aboutDraft.trim();
      await update({ ai_context_custom: next ? next : null });
      toast.success(next ? "Saved — AI will use this in plans" : "Cleared");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setAboutSaving(false);
    }
  };

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

  // Daily nudges are now plain on-device notifications (no server push). The
  // toggle just flips the local flag and (re)schedules the morning/evening
  // pings — NotificationBridge enriches them with fresh numbers on next open.
  const toggleDailyNudges = (v: boolean) => {
    if (v && !pushReady) {
      // Inline helper under the row explains why it's unavailable; no toast.
      return;
    }
    setDailyNudgesOn(v);
    setDailyNudgesEnabled(v);
    if (v) {
      // Schedule the morning brief + evening recap at the user's chosen times.
      // NotificationBridge re-syncs with fresh numbers on the next app run.
      void syncDailyNudges({
        morningTime: profile?.morning_nudge_local_time || "08:00",
        eveningTime: profile?.evening_nudge_local_time || "20:00",
      });
      toast.success("Daily nudges on");
    } else {
      void cancelDailyNudges();
    }
  };

  // Morning / evening nudge times — persisted to the profile and re-scheduled
  // on change. Defaults 08:00 / 20:00.
  const morningTime = profile?.morning_nudge_local_time || "08:00";
  const eveningTime = profile?.evening_nudge_local_time || "20:00";
  const setNudgeTime = (which: "morning" | "evening", value: string) => {
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    const patch =
      which === "morning"
        ? { morning_nudge_local_time: value }
        : { evening_nudge_local_time: value };
    void update(patch);
    void syncDailyNudges({
      morningTime: which === "morning" ? value : morningTime,
      eveningTime: which === "evening" ? value : eveningTime,
    });
  };



  return (
    <>
      <AnimatePresence>
        {bioTogglingLock && (
          <motion.div
            key="bio-overlay"
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background px-6"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
          >
            <div className="mb-8 opacity-90">
              <BiometricAura
                variant={bioInfo?.isFace ? "face" : "fingerprint"}
                size={150}
                subtle
              />
            </div>
            <h2 className="text-2xl font-display font-semibold mb-2 text-foreground text-balance text-center">
              Confirm Identity
            </h2>
            <p className="text-[14px] text-secondary-fg text-center max-w-xs leading-relaxed">
              Verify to enable Biometric Lock.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="w-full md:max-w-[720px] md:mx-auto px-5 md:px-8 pt-[var(--content-inset-top)]">
        <header className="shrink-0 pb-5">
          <p className="eyebrow">Account</p>
          <h1 className="page-title mt-2 text-balance">Settings</h1>
        </header>

        <div className="space-y-8">
          <ProCard
            entitlement={entitlement} isPro={isPro} subscriptionPro={subscriptionPro}
            planQuotaUsed={planQuotaUsed} planQuotaLimit={planQuotaLimit} planQuotaRemaining={planQuotaRemaining}
            onUpgrade={() => setUpgradeOpen(true)}
            onOpenDetails={!isPro ? () => setProSheetOpen(true) : undefined}
          />

          <Section title="Support">
            <button
              type="button"
              onClick={() => setSupportDialogOpen(true)}
              className="w-full text-left rounded-[18px] border border-border/65 hero-glass overflow-hidden pressable transition-colors hover:bg-foreground/[0.02]"
            >
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-black/[0.03] to-black/[0.08] dark:from-white/[0.12] dark:to-white/[0.06] border border-black/[0.08] dark:border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.05)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.2)]">
                    <LifeBuoy className="h-[16px] w-[16px] text-foreground/80 drop-shadow-sm" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-foreground/95">Help & Feedback</div>
                    <div className="text-[11px] text-secondary-fg/75 mt-0.5 leading-snug">
                      Report a bug or share your thoughts
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-foreground/30" />
              </div>
            </button>
          </Section>



          {/* 2. Profile — name + appearance grouped */}
          <Section title="You">
            <div className="rounded-[18px] border border-border/65 hero-glass divide-y divide-border/35 overflow-hidden">
              <div className="px-4 py-3">
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] text-secondary-fg">Name</label>
                  <DebouncedInput maxLength={50} value={name} onDebouncedChange={setName} onBlur={() => update({ display_name: name })} className="bg-card/45 h-9 rounded-lg border-border/75 text-[14px]" style={{ fontSize: 16 }} />
                </div>
              </div>
              <div className="settings-appearance px-4 py-3">
                <div className="text-[11px] text-secondary-fg mb-2">Mode</div>
                <ThemeToggle />
              </div>
            </div>
          </Section>

          {/* 3. Personalization — behavioural-learning toggle + the explicit context the AI uses */}
          <Section title="Personalization">
            {/* Learning opt-out. Off → generate-plan ignores ALL learned signals
                (typical durations, focus hours, dodged tasks); explicit context
                below + your typed tasks are still used. */}
            <div className="rounded-[18px] border border-border/65 hero-glass overflow-hidden mb-3">
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Sparkles className="h-4 w-4 text-secondary-fg shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[14px]">Learn from my activity</div>
                    <div className="text-[11px] text-secondary-fg/75 mt-0.5 leading-snug">
                      Tailors plans from your own history — typical durations, focus hours, tasks you tend to put off. Turn off and plans use only what you type.
                    </div>
                  </div>
                </div>
                <Switch
                  checked={profile?.ai_personalization_enabled !== false}
                  onCheckedChange={(v) => void update({ ai_personalization_enabled: v })}
                />
              </div>
            </div>
            <div className="rounded-[18px] border border-border/65 hero-glass overflow-hidden">
              <div className="px-4 py-3 space-y-2.5">
                <div className="text-[11px] text-secondary-fg leading-relaxed">
                  Your work, schedule quirks, hard constraints. Used by AI for every plan and morning insight.
                </div>
                <DebouncedTextarea
                  value={aboutDraft}
                  onDebouncedChange={setAboutDraft}
                  placeholder="e.g. I'm a freelance iOS designer in Lisbon. I walk my dog 1–2pm and don't take hard tasks after 5pm."
                  maxLength={500}
                  className="min-h-[96px] rounded-xl border-border/75 bg-card/45 text-[13.5px] leading-snug resize-none placeholder:text-secondary-fg/55 focus-visible:border-primary/55 focus-visible:ring-0"
                  style={{ fontSize: 16 }}
                />
                <div className="flex items-center justify-between gap-3 pt-0.5">
                  <span className="text-[11px] text-secondary-fg/70 tabular-nums">{aboutDraft.length}/500</span>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!aboutDirty || aboutSaving}
                    onClick={() => void saveAbout()}
                    className="h-9 rounded-xl text-[12.5px] font-semibold px-4 disabled:opacity-50"
                  >
                    {aboutSaving ? "Saving…" : aboutDirty ? "Save" : "Saved"}
                  </Button>
                </div>
              </div>
            </div>
          </Section>

          {/* 4. Notifications + Calendar — connected channels */}
          <Section title="Connections">
            <div className="rounded-[18px] border border-border/65 hero-glass divide-y divide-border/35 overflow-hidden">
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Sparkles className={`h-4 w-4 ${pushReady ? "text-secondary-fg" : "text-secondary-fg/55"}`} />
                    <div className="min-w-0">
                      <div className={`text-[14px] ${pushReady ? "" : "text-foreground/70"}`}>Daily nudges</div>
                      {pushReady && (
                        <div className="text-[11px] text-secondary-fg/75 mt-0.5">
                          A morning brief and evening recap, right on your device.
                        </div>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={pushReady && dailyNudgesOn}
                    disabled={!pushReady}
                    onCheckedChange={toggleDailyNudges}
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

                {/* When on: let the user choose when each ping lands. Native
                    HH:MM pickers so the time matches their day. */}
                {pushReady && dailyNudgesOn && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="flex items-center justify-between gap-1 rounded-[12px] border border-border/55 bg-card/45 px-2.5 py-2">
                      <span className="text-[12px] font-medium text-foreground/80 tracking-tight">Morning</span>
                      <input
                        type="time"
                        value={morningTime}
                        onChange={(e) => setNudgeTime("morning", e.target.value)}
                        className="bg-transparent text-[14px] font-semibold text-foreground tabular-nums outline-none text-right flex-1 min-w-0"
                        style={{ fontSize: 16 }}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-1 rounded-[12px] border border-border/55 bg-card/45 px-2.5 py-2">
                      <span className="text-[12px] font-medium text-foreground/80 tracking-tight">Evening</span>
                      <input
                        type="time"
                        value={eveningTime}
                        onChange={(e) => setNudgeTime("evening", e.target.value)}
                        className="bg-transparent text-[14px] font-semibold text-foreground tabular-nums outline-none text-right flex-1 min-w-0"
                        style={{ fontSize: 16 }}
                      />
                    </label>
                  </div>
                )}
              </div>

              {/* Task reminders toggle */}
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <AlarmClock className="h-4 w-4 text-secondary-fg" />
                    <div className="min-w-0">
                      <div className="text-[14px]">Task reminders</div>
                      <div className="text-[11px] text-secondary-fg/75 mt-0.5">
                        A heads-up on your device before each task starts.
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={taskRemindersOn}
                    onCheckedChange={(v) => {
                      setTaskRemindersOn(v);
                      setNotificationsEnabled(v);
                    }}
                  />
                </div>
              </div>

              {/* Haptic feedback master switch */}
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Vibrate className="h-4 w-4 text-secondary-fg" />
                    <div className="min-w-0">
                      <div className="text-[14px]">Haptic feedback</div>
                      <div className="text-[11px] text-secondary-fg/75 mt-0.5">
                        Subtle vibrations on taps, picks, and confirmations.
                      </div>
                    </div>
                  </div>
                  <Switch checked={hapticsOn} onCheckedChange={toggleHaptics} />
                </div>
                {/* On-device self-test — settles "is it the code or the phone?".
                    Fires a strong medium impact and reports a verdict so the user
                    can tell a code failure from the OS "System Haptics" setting. */}
                <button
                  type="button"
                  onClick={async () => {
                    const r = await haptics.test();
                    if (r.ok) {
                      toast.success("Haptic sent", {
                        description:
                          r.platform === "ios"
                            ? "Felt nothing? Turn ON Settings ▸ Sounds & Haptics ▸ System Haptics (and disable Low Power Mode)."
                            : r.platform === "android"
                              ? "Felt nothing? Enable Touch/Haptic vibration in your system settings."
                              : "If you felt nothing, your device is suppressing haptics.",
                      });
                    } else if (r.reason === "not-native") {
                      toast("Haptics need the app", { description: "Native vibration only works in the installed app, not the browser." });
                    } else if (r.reason === "plugin-unavailable") {
                      toast.error("Haptics plugin missing", { description: "Rebuild the app (clean build) — the native plugin isn't compiled in." });
                    } else {
                      toast.error("Haptic test failed", { description: r.reason });
                    }
                  }}
                  className="mt-2 ml-7 text-[12px] font-medium text-primary/85 hover:text-primary pressable"
                >
                  Test vibration
                </button>
              </div>
            </div>
          </Section>

          {/* Security — only shown when device has enrolled biometrics */}
          {Capacitor.isNativePlatform() && bioInfo?.available && (
            <Section title="Security">
              <div className="rounded-[18px] border border-border/65 hero-glass divide-y divide-border/35 overflow-hidden">
                {/* Biometric Lock */}
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-[10px] bg-primary/10 border border-primary/18 shrink-0">
                    {bioInfo.isFace
                      ? <ScanFace className="h-4 w-4 text-primary" strokeWidth={1.8} />
                      : <Lock className="h-4 w-4 text-primary" strokeWidth={1.8} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px]">Biometric Lock</div>
                    <div className="text-[11px] text-secondary-fg/70 mt-0.5">
                      Require {bioInfo.isFace
                        ? (Capacitor.getPlatform() === "android" ? "Face Auth" : "Face ID")
                        : (Capacitor.getPlatform() === "android" ? "fingerprint" : "Touch ID")} to view billing info or export reports
                    </div>
                  </div>
                  <Switch
                    checked={appLockOn}
                    disabled={bioTogglingLock}
                    onCheckedChange={toggleAppLock}
                  />
                </div>
              </div>
            </Section>
          )}

          {/* 6. Help + legal — quiet, terminal items */}
          <Section title="More">
            <div className="rounded-[18px] border border-border/65 hero-glass divide-y divide-border/35 overflow-hidden">
              {/* In-context tips master switch. Flipping ON re-arms any tips the
                  user already dismissed, so it doubles as "show tips again". */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Lightbulb className="h-4 w-4 text-secondary-fg shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px]">Feature tips</div>
                    <div className="text-[11px] text-secondary-fg/75 mt-0.5">
                      Short pointers the first time you reach a new feature.
                    </div>
                  </div>
                  <Switch
                    checked={hints.enabled}
                    onCheckedChange={(v) => {
                      hints.setEnabled(v);
                      if (v) hints.resetSeen();
                    }}
                  />
                </div>
              </div>
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

          <Button onClick={signOut} variant="outline" className="w-full h-11 rounded-[14px] border-border/65 hero-glass hover:bg-white/[0.06] pressable text-[13px]">
            Sign out
          </Button>

          <div className="block w-full text-center text-[11px] text-secondary-fg pt-1 select-none pb-4">
            DayDraft · v1.0
          </div>
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
      <SupportDialog open={supportDialogOpen} onOpenChange={setSupportDialogOpen} />
    </>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="eyebrow mb-2">{title}</div>
    {children}
  </div>
);

const ProCard = ({ entitlement, isPro, subscriptionPro, planQuotaUsed, planQuotaLimit, planQuotaRemaining, onUpgrade, onOpenDetails }: {
  entitlement: ReturnType<typeof useEntitlement>["entitlement"];
  isPro: boolean;
  subscriptionPro: boolean;
  planQuotaUsed: number;
  planQuotaLimit: number;
  planQuotaRemaining: number;
  onUpgrade: () => void;
  onOpenDetails?: () => void;
}) => {
  const tier = entitlement?.tier || "free";
  const badge = tier === "pro" ? "Pro"
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
          ? "Pattern-aware AI and every premium feature stay on."
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
