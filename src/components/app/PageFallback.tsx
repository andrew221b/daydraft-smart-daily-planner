import { Loader2 } from "lucide-react";

export const PageFallback = () => (
  <div className="min-h-[50vh] w-full flex flex-col items-center justify-center gap-3 bg-background">
    <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
    <span className="text-[12px] text-secondary-fg">Loading…</span>
  </div>
);
