import * as React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-xl border border-soft bg-surface-elevated/70 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_0_0_1px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow,background-color] duration-200 focus-visible:outline-none focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-surface-elevated/45 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(0,0,0,0.15)]",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export function DebouncedTextarea({
  value,
  onDebouncedChange,
  debounceMs = 300,
  ...props
}: Omit<TextareaProps, "value" | "onChange"> & { value?: string; onDebouncedChange?: (val: string) => void; debounceMs?: number }) {
  const [localValue, setLocalValue] = useState(value || "");

  useEffect(() => {
    setLocalValue(value || "");
  }, [value]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (onDebouncedChange) {
        onDebouncedChange(localValue);
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [localValue, debounceMs, onDebouncedChange]);

  return (
    <Textarea
      {...props}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={(e) => {
        if (onDebouncedChange) onDebouncedChange(e.target.value);
      }}
    />
  );
}

export { Textarea };
