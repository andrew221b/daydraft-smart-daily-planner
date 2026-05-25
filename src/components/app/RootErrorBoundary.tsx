import { Component, type ErrorInfo, type ReactNode } from "react";

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
    const dump = {
      type: typeof error,
      ctor: (error as any)?.constructor?.name,
      message: (error as any)?.message,
      name: (error as any)?.name,
      code: (error as any)?.code,
      stack: (error as any)?.stack,
      // Supabase / fetch wrap their failures here:
      cause: (error as any)?.cause,
      status: (error as any)?.status,
      details: (error as any)?.details,
      hint: (error as any)?.hint,
      ownKeys: error && typeof error === "object" ? Object.getOwnPropertyNames(error) : null,
      json: (() => { try { return JSON.stringify(error); } catch { return "<unstringifiable>"; } })(),
    };
    console.error("[RootErrorBoundary] caught", dump);
    console.error("[RootErrorBoundary] componentStack", info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center px-5">
          <div className="max-w-md text-center">
            <p className="font-display text-lg font-semibold">App failed to load</p>
            <p className="mt-2 text-sm text-secondary-fg">
              Something crashed during startup. Please reload. If it repeats, check console for
              [RootErrorBoundary] details.
            </p>
            <button
              className="mt-5 h-10 rounded-xl px-4 bg-primary text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
