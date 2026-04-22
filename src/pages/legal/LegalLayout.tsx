import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export const LegalLayout = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="min-h-screen w-full bg-background flex justify-center">
    <div className="w-full max-w-[640px] px-6 pt-8 pb-16">
      <Link to="/settings" className="inline-flex items-center gap-1 text-sm text-secondary-fg hover:text-foreground pressable mb-6">
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      <h1 className="text-3xl font-semibold mb-2">{title}</h1>
      <p className="text-xs text-secondary-fg mb-8">Last updated: April 22, 2026</p>
      <article className="prose prose-invert prose-sm max-w-none space-y-4 text-[15px] leading-relaxed text-foreground/90 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_a]:text-primary [&_a]:underline">
        {children}
      </article>
    </div>
  </div>
);