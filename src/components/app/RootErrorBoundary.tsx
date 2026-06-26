import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureComponentError } from "@/lib/sentry";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Last-resort boundary so preview never ends on a blank screen. */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Some thrown values (Supabase errors, plain objects, custom error
    // payloads) stringify to `{}` because their interesting props are
    // non-enumerable. Pull them out explicitly so the iOS log isn't
    // useless. Without this you get the dreaded "[error] - {}" lines.
    const e = error as Partial<{
      constructor: { name?: string };
      message: unknown; name: unknown; code: unknown; stack: unknown;
      cause: unknown; status: unknown; details: unknown; hint: unknown;
    }>;
    const dump = {
      type: typeof error,
      ctor: e?.constructor?.name,
      message: e?.message,
      name: e?.name,
      code: e?.code,
      stack: e?.stack,
      // Supabase / fetch wrap their failures here:
      cause: e?.cause,
      status: e?.status,
      details: e?.details,
      hint: e?.hint,
      ownKeys: error && typeof error === "object" ? Object.getOwnPropertyNames(error) : null,
      json: (() => { try { return JSON.stringify(error); } catch { return "<unstringifiable>"; } })(),
    };
    console.error("[RootErrorBoundary] caught", dump);
    console.error("[RootErrorBoundary] componentStack", info.componentStack);
    captureComponentError(error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center px-5">
          <div className="relative max-w-sm w-full text-center px-6 py-10 rounded-[28px] hero-glass border border-border/65 overflow-hidden">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-20 h-48 blur-3xl opacity-70"
              style={{ background: "radial-gradient(50% 50% at 50% 50%, hsl(0 85% 60% / 0.18), transparent 70%)" }}
            />
            <div
              className="relative mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{
                background: "hsl(0 85% 60% / 0.12)",
                boxShadow: "0 0 0 1px hsl(0 85% 60% / 0.32), 0 14px 28px -16px hsl(0 85% 60% / 0.35)",
              }}
            >
              <span className="text-[24px]" aria-hidden>!</span>
            </div>
            <p className="relative font-display text-[18px] font-semibold tracking-tight">
              Something went wrong
            </p>
            <p className="relative mt-2 text-[13px] leading-relaxed text-secondary-fg/85">
              The app hit an unexpected error. Reloading usually fixes it — if it repeats,
              signing out and back in clears any stuck session state.
            </p>
            <div className="relative mt-6 space-y-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full h-11 rounded-2xl bg-primary text-primary-foreground text-[13px] font-semibold pressable cta-glow"
              >
                Reload app
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const keys = Object.keys(localStorage).filter((k) => k.startsWith("sb-") || k.startsWith("supabase."));
                    keys.forEach((k) => localStorage.removeItem(k));
                  } catch { /* ignore */ }
                  window.location.href = "/auth";
                }}
                className="w-full h-10 rounded-2xl border border-border/65 text-[12.5px] font-medium text-secondary-fg/85 hover:text-foreground pressable"
              >
                Sign out and start fresh
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
