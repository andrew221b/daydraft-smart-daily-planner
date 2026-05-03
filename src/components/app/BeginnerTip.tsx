import { Lightbulb } from "lucide-react";

/** Soft callout for first-time or low-friction guidance. */
export function BeginnerTip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-[20px] border border-primary/12 bg-primary/[0.035] px-4 py-3.5 text-[13px] leading-[1.55] text-secondary-fg">
      <Lightbulb className="h-4 w-4 shrink-0 text-primary mt-0.5" strokeWidth={2} />
      <div className="min-w-0 text-foreground/90">{children}</div>
    </div>
  );
}
