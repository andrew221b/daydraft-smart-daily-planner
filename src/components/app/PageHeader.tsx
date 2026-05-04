import { ReactNode } from "react";

/** Consistent top-of-screen title + optional guidance for wayfinding. */
export function PageHeader({
  eyebrow,
  title,
  hint,
  right,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  hint?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="font-display text-[30px] font-semibold leading-[1.08] mt-2 tracking-tight text-balance">{title}</h1>
        {hint && <p className="text-[13px] text-secondary-fg leading-[1.55] mt-2.5 max-w-[min(100%,22rem)]">{hint}</p>}
      </div>
      {right ? <div className="flex shrink-0 items-start gap-2">{right}</div> : null}
    </div>
  );
}
