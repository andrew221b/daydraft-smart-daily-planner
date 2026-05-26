import { useEffect, useMemo, useState } from "react";
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
  taskTitle,
  taskType,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onStart: () => void;
  taskTitle?: string;
  taskType?: string | null;
}) => {
  const [checks, setChecks] = useState({ dnd: false, water: false, tabs: false });
  const [hideForever, setHideForever] = useState(false);
  const normalizedTitle = (taskTitle || "").toLowerCase();
  const compactTitle = (taskTitle || "this task").trim().replace(/\s+/g, " ");
  const shortTitle = compactTitle.length > 32 ? `${compactTitle.slice(0, 29)}...` : compactTitle;
  const isCall = /\b(call|phone|meeting|zoom|sync|standup|1:1|interview)\b/.test(normalizedTitle) || taskType === "communication";
  const isWorkout = /\b(gym|workout|run|walk|yoga|training|exercise)\b/.test(normalizedTitle);
  const isErrand = /\b(grocery|shop|errand|pickup|drop|home|visit|bank)\b/.test(normalizedTitle) || taskType === "routine";
  const isCreative = /\b(write|draft|design|build|code|study|deep work|focus)\b/.test(normalizedTitle) || taskType === "deep_work";
  const items = useMemo(() => {
    if (isCall) {
      return [
        { key: "dnd" as const, Icon: BellOff, label: "Notifications silenced for this call" },
        { key: "water" as const, Icon: Droplet, label: "Notes and key points open" },
        { key: "tabs" as const, Icon: XIcon, label: "Mic/camera and connection checked" },
      ];
    }
    if (isWorkout) {
      return [
        { key: "dnd" as const, Icon: BellOff, label: "Phone distractions off" },
        { key: "water" as const, Icon: Droplet, label: "Water and gear ready" },
        { key: "tabs" as const, Icon: XIcon, label: "Start with the first movement now" },
      ];
    }
    if (isErrand) {
      return [
        { key: "dnd" as const, Icon: BellOff, label: "Essentials list checked" },
        { key: "water" as const, Icon: Droplet, label: "Keys, wallet, phone ready" },
        { key: "tabs" as const, Icon: XIcon, label: "One clear next stop decided" },
      ];
    }
    if (isCreative) {
      return [
        { key: "dnd" as const, Icon: BellOff, label: "Phone on Do Not Disturb" },
        { key: "water" as const, Icon: Droplet, label: "Everything needed for \""+ shortTitle +"\" is open" },
        { key: "tabs" as const, Icon: XIcon, label: "Distracting tabs closed" },
      ];
    }
    return [
      { key: "dnd" as const, Icon: BellOff, label: "Phone on Do Not Disturb" },
      { key: "water" as const, Icon: Droplet, label: "Water within reach" },
      { key: "tabs" as const, Icon: XIcon, label: `Clear one first step for "${shortTitle}"` },
    ];
  }, [isCall, isWorkout, isErrand, isCreative, shortTitle]);
  const allChecked = Object.values(checks).every(Boolean);

  useEffect(() => {
    if (!open) return;
    setChecks({ dnd: false, water: false, tabs: false });
  }, [open, taskTitle, taskType]);

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
      <SheetContent side="bottom" className="rounded-t-[24px] border-soft bg-background/95 backdrop-blur-xl">
        <SheetHeader>
          <SheetTitle className="font-display text-[20px]">Ready to focus?</SheetTitle>
        </SheetHeader>
        <p className="text-[13px] text-secondary-fg mt-2 leading-[1.55]">
          {compactTitle ? `Prep for "${shortTitle}" in a few seconds.` : "A few seconds of prep doubles your odds."}
        </p>
        <div className="mt-4 space-y-2">
          {items.map(({ key, Icon, label }) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-[18px] border pressable transition-[border-color,background-color,box-shadow] duration-200 backdrop-blur-md ${
                checks[key]
                  ? "border-accent surface-accent shadow-[0_4px_16px_hsl(var(--primary)/0.08)]"
                  : "border-soft surface-card hover:bg-card/90"
              }`}
            >
              <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 transition-transform duration-300 ${
                checks[key]
                  ? "bg-primary text-primary-foreground scale-[1.08] shadow-[0_4px_12px_hsl(var(--primary)/0.4)]"
                  : "bg-surface-elevated text-secondary-fg scale-100"
              }`}>
                {checks[key] ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-4 w-4" />}
              </div>
              <span className="text-sm font-semibold text-left flex-1 text-foreground">{label}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 space-y-2 pb-2">
          <Button
            onClick={startWithPref}
            className="w-full h-12 rounded-[18px] bg-gradient-primary hover:bg-primary/92 text-primary-foreground font-semibold pressable shadow-card border border-primary/20"
          >
            {allChecked ? "Let's go" : "Start anyway"}
          </Button>
          <button
            type="button"
            onClick={() => setHideForever(v => !v)}
            className="w-full inline-flex items-center justify-center gap-1.5 text-secondary-fg text-xs py-1.5 hover:text-foreground font-medium"
          >
            <EyeOff className="h-3.5 w-3.5" />
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