import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Catches render errors in lazy-loaded routes so one bad screen
 * does not blank the entire app shell.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RouteErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 pb-24">
          <p className="font-display text-lg font-semibold text-foreground text-center">Something broke</p>
          <p className="text-[13px] text-secondary-fg text-center mt-2 max-w-sm leading-relaxed">
            {this.state.error.message || "An unexpected error occurred in this screen."}
          </p>
          <div className="mt-6 flex flex-col gap-2 w-full max-w-xs">
            <Button className="w-full h-11 rounded-xl" onClick={() => window.location.reload()}>
              Reload page
            </Button>
            <Button variant="secondary" className="w-full h-11 rounded-xl" asChild>
              <Link to="/today">Back to Today</Link>
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
