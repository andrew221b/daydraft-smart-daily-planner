import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export const LegalLayout = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="h-full w-full bg-background">
    {/* Fixed back bar — always visible regardless of scroll position */}
    <div
      className="fixed inset-x-0 top-0 z-20 flex items-end px-4 pb-3 bg-background/80 backdrop-blur-xl border-b border-border/20"
      style={{ height: "calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + 52px)" }}
    >
      <Link to="/settings" className="flex items-center gap-0.5 text-[15px] font-medium text-primary pressable">
        <ChevronLeft className="h-5 w-5 -ml-1" /> Back
      </Link>
    </div>

    {/* Scrollable content — offset by fixed bar height */}
    <div
      className="h-full overflow-y-auto touch-pan-y flex justify-center"
      style={{ paddingTop: "calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + 52px)" }}
    >
      <div
        className="w-full max-w-[520px] px-6 pt-5"
        style={{ paddingBottom: "calc(max(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)), 20px) + 3rem + var(--keyboard-inset, 0px))" }}
      >
        <h1 className="font-display text-[26px] font-semibold mb-2 text-balance leading-tight">{title}</h1>
        <p className="text-[11px] text-secondary-fg mb-10 tracking-wide">Last updated: April 22, 2026</p>
        <article className="prose prose-invert prose-sm max-w-none space-y-4 text-[15px] leading-[1.6] text-foreground/88 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline">
          {children}
        </article>
      </div>
    </div>
  </div>
);
