import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export const LegalLayout = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="h-full w-full bg-background overflow-y-auto touch-pan-y flex justify-center">
    <div className="w-full max-w-[520px] px-6 pt-[var(--content-inset-top)]" style={{ paddingBottom: "calc(max(env(safe-area-inset-bottom), 20px) + 3rem + var(--keyboard-inset, 0px))" }}>
      <Link to="/settings" className="inline-flex items-center gap-1 text-[13px] text-secondary-fg hover:text-foreground pressable mb-8">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      <h1 className="font-display text-[26px] font-semibold mb-2 text-balance leading-tight">{title}</h1>
      <p className="text-[11px] text-secondary-fg mb-10 tracking-wide">Last updated: April 22, 2026</p>
      <article className="prose prose-invert prose-sm max-w-none space-y-4 text-[15px] leading-[1.6] text-foreground/88 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline">
        {children}
      </article>
    </div>
  </div>
);