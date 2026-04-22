import { Shell } from "@/components/app/Shell";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { peakWindow } from "@/lib/daydraft";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { Fingerprint, Sparkles } from "lucide-react";
import { clearStoredPasskey, enrollPasskey, getStoredPasskey, passkeySupported } from "@/lib/passkeys";
import { toast } from "sonner";
import { useEntitlement } from "@/hooks/useEntitlement";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";

const energies = [
  { key: "morning" as const, label: "Morning person" },
  { key: "midday" as const, label: "Midday flow" },
  { key: "night" as const, label: "Night owl" },
];

export default function Settings() {
  const { profile, update } = useProfile();
  const { signOut, user } = useAuth();
  const [name, setName] = useState("");
  const [hasPasskey, setHasPasskey] = useState(!!getStoredPasskey());
  const { entitlement, isPro, planQuotaUsed, planQuotaLimit } = useEntitlement();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  useEffect(() => { if (profile) setName(profile.display_name || ""); }, [profile?.id]);

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
      toast.error(e?.message || "Couldn't enroll");
    }
  };

  return (
    <Shell>
      <div className="px-6 pt-14">
        <h1 className="text-[28px] font-semibold">Settings</h1>

        <div className="mt-8 space-y-6">
          <Section title="DayDraft Pro">
            <ProCard
              entitlement={entitlement} isPro={isPro}
              planQuotaUsed={planQuotaUsed} planQuotaLimit={planQuotaLimit}
              onUpgrade={() => setUpgradeOpen(true)}
            />
          </Section>

          <Section title="Name">
            <Input value={name} onChange={e => setName(e.target.value)} onBlur={() => update({ display_name: name })}
              className="h-12 bg-surface border-border rounded-xl" />
          </Section>

          <Section title="Appearance">
            <ThemeToggle />
          </Section>

          <Section title="Energy preference">
            <div className="space-y-2">
              {energies.map(e => {
                const active = profile?.energy_preference === e.key;
                return (
                  <button key={e.key} onClick={() => update({ energy_preference: e.key })}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 pressable transition-all ${active ? "border-primary bg-surface-elevated" : "border-border bg-surface"}`}>
                    <span className="text-sm">{e.label}</span>
                    <span className="text-xs text-secondary-fg">{peakWindow(e.key)}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Sign-in shortcut">
            <button onClick={togglePasskey}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-border bg-surface pressable hover:border-primary/30">
              <div className="flex items-center gap-3">
                <Fingerprint className="h-5 w-5 text-primary" />
                <div className="text-left">
                  <div className="text-sm">Face ID / fingerprint</div>
                  <div className="text-xs text-secondary-fg">{hasPasskey ? "Enabled on this device" : "Skip the password next time"}</div>
                </div>
              </div>
              <span className={`text-xs font-medium ${hasPasskey ? "text-success" : "text-secondary-fg"}`}>
                {hasPasskey ? "On" : "Off"}
              </span>
            </button>
          </Section>

          <Section title="Notifications">
            <div className="flex items-center justify-between rounded-xl bg-surface border border-border px-4 py-3">
              <div>
                <div className="text-sm">Morning nudge</div>
                <div className="text-xs text-secondary-fg">One reminder to start your day</div>
              </div>
              <Switch checked={!!profile?.notifications_enabled} onCheckedChange={v => update({ notifications_enabled: v })} />
            </div>
          </Section>

          <Button onClick={signOut} variant="outline" className="w-full h-12 rounded-xl border-border bg-surface hover:bg-surface-elevated pressable">
            Sign out
          </Button>
          <p className="text-center text-[11px] text-secondary-fg pt-2">DayDraft · v1.0</p>
        </div>
      </div>
      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
    </Shell>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="text-[11px] uppercase tracking-wider text-secondary-fg mb-2">{title}</div>
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
    <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 shadow-glow">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">{badge}</span>
          </div>
          <div className="text-sm mt-2">
            {isPro
              ? "Unlimited plans, calendar sync, and everything else."
              : `${planQuotaUsed} of ${planQuotaLimit} free plans used this week.`}
          </div>
        </div>
      </div>
      {!isPro && (
        <Button onClick={onUpgrade} className="w-full mt-4 h-11 rounded-xl text-primary-foreground font-medium pressable"
          style={{ background: "var(--gradient-primary)" }}>
          Start free trial
        </Button>
      )}
      {isPro && (
        <button onClick={() => toast("Subscription management coming soon")}
          className="w-full mt-4 h-11 rounded-xl text-sm text-secondary-fg border border-border bg-surface pressable hover:text-foreground">
          Manage subscription
        </button>
      )}
    </div>
  );
};
