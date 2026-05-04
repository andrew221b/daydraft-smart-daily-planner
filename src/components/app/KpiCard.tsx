import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  onClick,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  tone?: "neutral" | "primary" | "success";
  onClick?: () => void;
  className?: string;
}) {
  const Comp: any = onClick ? "button" : "div";
  const toneClass =
    tone === "primary"
      ? "border-accent surface-accent"
      : tone === "success"
        ? "border-emerald-400/25 bg-emerald-400/[0.08]"
        : "border-strong surface-soft";

  return (
    <Comp
      onClick={onClick}
      className={cn(
        "text-left app-card p-3.5 rounded-2xl transition-all duration-200",
        toneClass,
        onClick ? "pressable hover:border-primary/30 hover:-translate-y-[1px]" : "",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-secondary-fg">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em]">{label}</span>
      </div>
      <div className="mt-2 font-display text-[24px] font-semibold tabular-nums leading-none truncate">{value}</div>
      {sub ? <div className="mt-1.5 text-[11px] text-secondary-fg tabular-nums">{sub}</div> : null}
    </Comp>
  );
}

