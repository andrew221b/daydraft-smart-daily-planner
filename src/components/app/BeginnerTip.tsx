import { Lightbulb } from "lucide-react";

/** Soft callout for first-time or low-friction guidance. */
export function BeginnerTip({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className="relative flex gap-3 rounded-[20px] border border-primary/12 bg-primary/[0.035] px-4 py-3.5 pr-11 text-[13px] leading-[1.55] text-secondary-fg">
      <Lightbulb className="h-4 w-4 shrink-0 text-primary mt-0.5" strokeWidth={2} />
      <div className="min-w-0 text-subtle">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-2 top-2 h-7 w-7 rounded-full inline-flex items-center justify-center text-secondary-fg hover:text-foreground hover:bg-background/60 pressable"
          aria-label="Dismiss tip"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}
