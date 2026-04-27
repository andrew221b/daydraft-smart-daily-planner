import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { BellOff, Droplet, X as XIcon, Check, EyeOff } from "lucide-react";
import { haptics } from "@/lib/haptics";

/**
 * 3-tap pre-flight checklist before starting Focus.
 * Quick environmental setup nudges to maximize success.
 */
export const PreflightSheet = ({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onStart: () => void;
}) => {
  const [checks, setChecks] = useState({ dnd: false, water: false, tabs: false });
  const [hideForever, setHideForever] = useState(false);
  const items = [
    { key: "dnd" as const, Icon: BellOff, label: "Phone on Do Not Disturb" },
    { key: "water" as const, Icon: Droplet, label: "Water within reach" },
    { key: "tabs" as const, Icon: XIcon, label: "Distracting tabs closed" },
  ];
  const allChecked = Object.values(checks).every(Boolean);

  const toggle = (k: keyof typeof checks) => {
    haptics.selection();
    setChecks(c => ({ ...c, [k]: !c[k] }));
  };

  const startWithPref = () => {
    if (hideForever) {
      try { localStorage.setItem("dd_preflight_disabled", "1"); } catch {/* ignore */}
    }
    haptics.impact("medium");
    onStart();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl border-border bg-surface-elevated">
        <SheetHeader>
          <SheetTitle>Ready to focus?</SheetTitle>
        </SheetHeader>
        <p className="text-sm text-secondary-fg mt-2">A few seconds of prep doubles your odds.</p>
        <div className="mt-4 space-y-2">
          {items.map(({ key, Icon, label }) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border pressable transition-colors ${
                checks[key]
                  ? "border-primary/40 bg-primary/10"
                  : "border-border bg-surface"
              }`}
            >
              <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                checks[key] ? "bg-primary text-primary-foreground" : "bg-surface-elevated text-secondary-fg"
              }`}>
                {checks[key] ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-4 w-4" />}
              </div>
              <span className="text-sm font-medium text-left flex-1">{label}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 space-y-2 pb-2">
          <Button
            onClick={startWithPref}
            className="w-full h-12 rounded-xl bg-primary hover:bg-primary/92 text-primary-foreground font-medium pressable shadow-card"
           
          >
            {allChecked ? "Let's go" : "Start anyway"}
          </Button>
          <button
            type="button"
            onClick={() => setHideForever(v => !v)}
            className="w-full inline-flex items-center justify-center gap-1.5 text-secondary-fg text-xs py-1 hover:text-foreground"
          >
            <EyeOff className="h-3 w-3" />
            {hideForever ? "Won't show again" : "Don't show this again"}
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className="w-full text-secondary-fg text-sm py-2 hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
};