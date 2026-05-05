import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Last-resort boundary so preview never ends on a blank screen. */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RootErrorBoundary]", error, info.componentStack);
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
