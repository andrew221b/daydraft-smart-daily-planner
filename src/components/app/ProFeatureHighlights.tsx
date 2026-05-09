import { Lock } from "lucide-react";
import { PRO_FEATURE_CATALOG, type ProFeatureId } from "@/lib/proFeatures";
import { cn } from "@/lib/utils";

type Props = {
  onUpgrade: () => void;
  /** Max rows; omit for full catalog */
  limit?: number;
  /** Tighter spacing for Today screen */
  variant?: "comfortable" | "compact";
  /** Only these ids, in this order (subset of catalog) */
  ids?: ProFeatureId[];
};

export function ProFeatureHighlights({ onUpgrade, limit, variant = "comfortable", ids }: Props) {
  const ordered = ids
    ? ids.map((id) => PRO_FEATURE_CATALOG.find((x) => x.id === id)).filter(Boolean) as typeof PRO_FEATURE_CATALOG
    : PRO_FEATURE_CATALOG;
  const rows = typeof limit === "number" ? ordered.slice(0, limit) : ordered;
  const tight = variant === "compact";

  return (
    <ul className={cn("divide-y divide-border/60", tight ? "rounded-xl border border-soft overflow-hidden" : "space-y-0")}>
      {rows.map(({ id, Icon, headline, tagline }) => (
        <li key={id}>
          <button
            type="button"
            onClick={onUpgrade}
            className={cn(
              "w-full flex items-start gap-3 text-left pressable transition-colors hover:bg-surface-elevated/80",
              tight ? "px-3 py-2.5" : "px-1 py-3 rounded-xl hover:bg-surface-elevated/60",
            )}
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-soft bg-background/80">
              <Icon className="h-4 w-4 text-primary" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={cn("font-semibold text-foreground", tight ? "text-[13px]" : "text-[14px]")}>{headline}</span>
                <Lock className="h-3 w-3 text-primary/80 shrink-0" aria-hidden />
              </span>
              <span className={cn("mt-0.5 block text-secondary-fg leading-snug", tight ? "text-[11px]" : "text-[12px]")}>
                {tagline}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
