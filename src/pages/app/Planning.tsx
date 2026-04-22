import { Shell } from "@/components/app/Shell";
import { Sparkles } from "lucide-react";

export default function Planning() {
  return (
    <Shell hideTabBar>
      <div className="px-6 pt-16">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-medium">Thinking</span>
          <span className="dot-bounce inline-flex"><span/><span/><span/></span>
        </div>
        <h1 className="text-2xl font-semibold mt-2">Designing your day</h1>
        <div className="mt-8 space-y-3">
          {[80, 64, 72, 56, 80].map((w, i) => (
            <div key={i} className="rounded-2xl bg-surface border border-border p-4 shadow-card">
              <div className="h-3 shimmer rounded-full" style={{ width: `${w}%` }} />
              <div className="h-2.5 shimmer rounded-full mt-3 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
