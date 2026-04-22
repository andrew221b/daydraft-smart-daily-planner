import { Shell } from "@/components/app/Shell";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { peakWindow } from "@/lib/daydraft";

const energies = [
  { key: "morning" as const, label: "Morning person" },
  { key: "midday" as const, label: "Midday flow" },
  { key: "night" as const, label: "Night owl" },
];

export default function Settings() {
  const { profile, update } = useProfile();
  const { signOut } = useAuth();
  const [name, setName] = useState("");
  useEffect(() => { if (profile) setName(profile.display_name || ""); }, [profile?.id]);

  return (
    <Shell>
      <div className="px-6 pt-14">
        <h1 className="text-[28px] font-semibold">Settings</h1>

        <div className="mt-8 space-y-6">
          <Section title="Name">
            <Input value={name} onChange={e => setName(e.target.value)} onBlur={() => update({ display_name: name })}
              className="h-12 bg-surface border-border rounded-xl" />
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
    </Shell>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="text-[11px] uppercase tracking-wider text-secondary-fg mb-2">{title}</div>
    {children}
  </div>
);
