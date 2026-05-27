import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import type { CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  PAYMENT_METHODS,
  getPaymentMethod,
  legacyMethodOption,
  type PaymentField,
} from "@/lib/paymentMethods";
import { haptics } from "@/lib/haptics";

/** All the raw billing fields the picker can drive — superset of any one method. */
export type PaymentFieldsValue = {
  payment_method: string;
  display_name: string;
  bank_name: string;
  iban: string;
  crypto_network: string;
  crypto_wallet: string;
  payment_link: string;
  notes: string;
};

type FieldKey = keyof Omit<PaymentFieldsValue, "payment_method">;

/**
 * Method-aware payment-fields editor. Renders a chip grid of methods at the
 * top; switching the method swaps in only the inputs that method needs (spring
 * transition). The DB layer reuses the existing flat schema, so no migration
 * needed — see /src/lib/paymentMethods.ts for the mapping.
 */
export function PaymentMethodFields({
  value,
  onChange,
  compact = false,
}: {
  value: PaymentFieldsValue;
  onChange: (field: keyof PaymentFieldsValue, val: string) => void;
  /** Use the tighter layout intended for inline category cards. */
  compact?: boolean;
}) {
  const method = getPaymentMethod(value.payment_method);
  const legacy = legacyMethodOption(value.payment_method);

  const setMethod = (id: string) => {
    if (id === value.payment_method) {
      // Toggle off — let the user clear their choice.
      haptics.selection();
      onChange("payment_method", "");
      return;
    }
    haptics.selection();
    onChange("payment_method", id);
  };

  const gridCols = compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3";

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between mb-2 px-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/70">
            Payment method
          </span>
          {method && (
            <button
              type="button"
              onClick={() => { haptics.selection(); onChange("payment_method", ""); }}
              className="text-[10px] font-medium text-secondary-fg/60 hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className={`grid ${gridCols} gap-1.5`}>
          {PAYMENT_METHODS.map((m) => {
            const selected = value.payment_method === m.id;
            const Icon = m.Icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                aria-pressed={selected}
                className={[
                  "group relative flex items-center gap-2 rounded-2xl border px-2.5 py-2 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 pressable",
                  selected
                    ? "border-transparent text-foreground shadow-[0_0_0_1.5px_hsl(var(--m-accent)/0.45),0_8px_22px_-12px_hsl(var(--m-accent)/0.55)]"
                    : "border-border/40 bg-card/35 text-foreground/82 hover:border-border/60 hover:bg-card/55",
                ].join(" ")}
                style={{ "--m-accent": m.accent } as CSSProperties}
              >
                {selected && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-2xl"
                    style={{
                      background:
                        "linear-gradient(150deg, hsl(var(--m-accent) / 0.16) 0%, hsl(var(--m-accent) / 0.06) 60%, transparent 100%)",
                    }}
                  />
                )}
                <span
                  className={[
                    "relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-xl transition-colors",
                    selected ? "text-foreground" : "text-foreground/65",
                  ].join(" ")}
                  style={
                    selected
                      ? { background: "hsl(var(--m-accent) / 0.22)", boxShadow: "inset 0 0 0 1px hsl(var(--m-accent) / 0.30)" }
                      : { background: "hsl(var(--foreground) / 0.06)" }
                  }
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                </span>
                <span className="relative z-[1] min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold leading-tight truncate">{m.label}</span>
                  {!compact && (
                    <span className="block text-[10px] leading-tight mt-0.5 truncate text-secondary-fg/65">
                      {m.blurb}
                    </span>
                  )}
                </span>
                {selected && (
                  <Check className="relative z-[1] h-3 w-3 shrink-0" style={{ color: "hsl(var(--m-accent))" }} strokeWidth={3} />
                )}
              </button>
            );
          })}
          {legacy && (
            <button
              key={legacy.id}
              type="button"
              onClick={() => onChange("payment_method", "")}
              className="relative flex items-center gap-2 rounded-2xl border border-dashed border-border/45 bg-card/25 px-2.5 py-2 text-left pressable"
              title="Legacy value — tap to clear"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-foreground/55">
                <ChevronDown className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold leading-tight truncate">{legacy.label}</span>
                <span className="block text-[10px] leading-tight mt-0.5 truncate text-secondary-fg/65">
                  Legacy · tap to clear
                </span>
              </span>
            </button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {method ? (
          <motion.div
            key={method.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 340, damping: 28, mass: 0.85 }}
            className="rounded-2xl border border-border/35 bg-background/45 p-3.5 space-y-2.5"
            style={{
              boxShadow:
                "0 0 0 1px hsl(var(--m-accent) / 0.16) inset, 0 10px 28px -16px hsl(var(--m-accent) / 0.35)",
              ["--m-accent" as string]: method.accent,
            } as CSSProperties}
          >
            <div className="flex items-center gap-2 px-0.5">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                style={{ background: "hsl(var(--m-accent) / 0.20)", color: "hsl(var(--m-accent))" }}
              >
                <method.Icon className="h-3 w-3" strokeWidth={2.4} />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-fg/80">
                {method.detailTitle}
              </span>
            </div>
            <div className="space-y-2">
              {method.fields.map((f, idx) => (
                <motion.div
                  key={f.key}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * idx, duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                >
                  <FieldRow field={f} value={value[f.key as FieldKey] ?? ""} onChange={(v) => onChange(f.key as FieldKey, v)} />
                </motion.div>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="no-method"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="rounded-2xl border border-dashed border-border/40 bg-background/25 px-4 py-5 text-center"
          >
            <p className="text-[12px] text-secondary-fg/70 leading-relaxed">
              Pick a payment method above —<br />
              we'll only ask for the fields that method actually needs.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: PaymentField;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.options) {
    return (
      <label className="block space-y-1">
        <span className="text-[10px] font-medium text-secondary-fg/75 px-0.5">{field.label}</span>
        <div className="relative">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-full appearance-none rounded-xl border border-border/40 bg-card/55 pl-3 pr-8 text-[13px] text-foreground outline-none transition-colors focus:border-primary/55 focus:bg-card/75"
          >
            <option value="">{field.placeholder}</option>
            {field.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-fg/60" />
        </div>
      </label>
    );
  }

  if (field.multiline) {
    return (
      <label className="block space-y-1">
        <span className="text-[10px] font-medium text-secondary-fg/75 px-0.5">{field.label}</span>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="min-h-[68px] rounded-xl border-border/40 bg-card/55 text-[13px] leading-snug placeholder:text-secondary-fg/55 focus-visible:border-primary/55 focus-visible:ring-0"
        />
      </label>
    );
  }

  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-medium text-secondary-fg/75 px-0.5">{field.label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className="h-10 rounded-xl border-border/40 bg-card/55 text-[13px] placeholder:text-secondary-fg/55 focus-visible:border-primary/55 focus-visible:ring-0"
      />
    </label>
  );
}
