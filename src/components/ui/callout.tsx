import { type ReactNode } from "react";
import { AlertTriangle, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutVariant = "info" | "warning" | "error" | "success";

const VARIANTS = {
  info: {
    wrapper: "border-sky-500/25 bg-sky-500/[0.08]",
    iconCls: "text-sky-500 dark:text-sky-400",
    textCls: "text-sky-700 dark:text-sky-300/90",
    Icon: Info,
  },
  warning: {
    wrapper: "border-amber-500/25 bg-amber-500/10",
    iconCls: "text-amber-500 dark:text-amber-400",
    textCls: "text-amber-700 dark:text-amber-400/90",
    Icon: AlertTriangle,
  },
  error: {
    wrapper: "border-destructive/25 bg-destructive/[0.08]",
    iconCls: "text-destructive",
    textCls: "text-destructive/85",
    Icon: AlertCircle,
  },
  success: {
    wrapper: "border-success/25 bg-success/[0.08]",
    iconCls: "text-success",
    textCls: "text-success/85",
    Icon: CheckCircle2,
  },
} as const;

export function Callout({
  variant = "info",
  children,
  className,
}: {
  variant?: CalloutVariant;
  children: ReactNode;
  className?: string;
}) {
  const { wrapper, iconCls, textCls, Icon } = VARIANTS[variant];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2.5", wrapper, className)}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-[1px]", iconCls)} />
      <div className={cn("flex-1 min-w-0", textCls)}>
        {children}
      </div>
    </div>
  );
}
