import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProfileProvider, useProfile } from "@/hooks/useProfile";
import { useTheme } from "@/lib/theme";
import { TourProvider } from "@/components/app/Tour";
import { TimeTrackerProvider } from "@/hooks/useTimeTracker";
import { PageFallback } from "@/components/app/PageFallback";
import { RouteErrorBoundary } from "@/components/app/RouteErrorBoundary";
import ForgotPassword from "./pages/app/ForgotPassword";
import ResetPassword from "./pages/app/ResetPassword";
import Privacy from "./pages/legal/Privacy";
import Terms from "./pages/legal/Terms";

/**
 * Wraps lazy() so a stale browser tab that references a chunk hash which no
 * longer exists on the CDN (after a deploy) recovers by reloading once,
 * instead of leaving the user on the "Importing a module script failed"
 * error boundary screen.
 *
 * IMPORTANT: gate the reload by a timestamp, not by a flag-cleared-on-load.
 * Clearing on `window.load` causes an infinite reload loop whenever the chunk
 * failure is persistent (e.g. preview env, offline, blocked CDN).
 */
const RELOAD_KEY = "dd_chunk_reload_at";
const RELOAD_COOLDOWN_MS = 60_000;
function lazyWithReload<T extends { default: ComponentType<any> }>(
  factory: () => Promise<T>
) {
  return lazy(() =>
    factory().catch((err) => {
      const msg = String(err?.message || err || "");
      const isChunkErr =
        /Importing a module script failed|Failed to fetch dynamically imported module|ChunkLoadError|Loading chunk/i.test(msg);
      if (isChunkErr && typeof window !== "undefined") {
        try {
          const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
          const now = Date.now();
          if (!last || now - last > RELOAD_COOLDOWN_MS) {
            sessionStorage.setItem(RELOAD_KEY, String(now));
            window.location.reload();
            return new Promise(() => {}) as Promise<T>;
          }
        } catch {
          // ignore storage errors and fall through to re-throw
        }
      }
      throw err;
    })
  );
}

const Home = lazyWithReload(() => import("./pages/app/Home"));
const Tracker = lazyWithReload(() => import("./pages/app/Tracker"));
const DayView = lazyWithReload(() => import("./pages/app/DayView"));
const Focus = lazyWithReload(() => import("./pages/app/Focus"));
const Reports = lazyWithReload(() => import("./pages/app/Reports"));
const Settings = lazyWithReload(() => import("./pages/app/Settings"));
const Onboarding = lazyWithReload(() => import("./pages/app/Onboarding"));
const Auth = lazyWithReload(() => import("./pages/app/Auth"));
const DeleteAccount = lazyWithReload(() => import("./pages/legal/DeleteAccount"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 1,
      // Native WebView "focus" events are noisy; refetching every tab return causes jank.
      refetchOnWindowFocus: !Capacitor.isNativePlatform(),
    },
  },
});

// Sticky onboarded flag written by useProfile. Read here as a fallback so a
// missing or transiently-failed profile fetch for a previously-onboarded user
// cannot bounce them back to /onboarding (the source of the redirect loop).
const readOnboardedFlag = (uid: string | undefined): boolean => {
  if (!uid) return false;
  try { return localStorage.getItem(`dd_onboarded_uid_${uid}`) === "1"; } catch { return false; }
};

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const { user, loading } = useAuth();
  const { profile, loading: pLoading } = useProfile();
  const loc = useLocation();
  if (loading || (user && pLoading)) return <PageFallback />;
  if (!user) return <Navigate to="/auth" replace state={{ from: loc }} />;
  const onOnboardingRoute = loc.pathname === "/onboarding" || loc.pathname === "/onboarding/";
  // Treat unknown profile state as "onboarding not resolved" to avoid letting
  // authenticated users into app routes before profile/onboarding is known —
  // unless this uid was already flagged as onboarded locally, in which case
  // trust the flag and skip the bounce.
  const onboardingResolved =
    profile?.onboarded === true || readOnboardedFlag(user.id);
  if (!onboardingResolved && !onOnboardingRoute) return <Navigate to="/onboarding" replace />;
  if (onboardingResolved && onOnboardingRoute) return <Navigate to="/home" replace />;
  return children;
};

const RootRedirect = () => {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  return <Navigate to={user ? "/home" : "/auth"} replace />;
};

const ThemedToaster = () => {
  const { resolved } = useTheme();
  return <Sonner theme={resolved} position="top-center" />;
};

function SuspenseRoute({ children }: { children: ReactNode }) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ThemedToaster />
      <BrowserRouter>
        <AuthProvider>
        <ProfileProvider>
        <TourProvider>
        <TimeTrackerProvider>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/auth" element={<SuspenseRoute><Auth /></SuspenseRoute>} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboarding" element={<RequireAuth><SuspenseRoute><Onboarding /></SuspenseRoute></RequireAuth>} />
            <Route path="/home" element={<RequireAuth><SuspenseRoute><Home /></SuspenseRoute></RequireAuth>} />
            <Route path="/today" element={<RequireAuth><SuspenseRoute><DayView /></SuspenseRoute></RequireAuth>} />
            <Route path="/today/planning" element={<Navigate to="/today/plan" replace />} />
            <Route path="/today/plan" element={<RequireAuth><SuspenseRoute><DayView /></SuspenseRoute></RequireAuth>} />
            <Route path="/focus/:blockId" element={<RequireAuth><SuspenseRoute><Focus /></SuspenseRoute></RequireAuth>} />
            <Route path="/tracker" element={<RequireAuth><SuspenseRoute><Tracker /></SuspenseRoute></RequireAuth>} />
            <Route path="/recap" element={<Navigate to="/reports" replace />} />
            <Route path="/recap/week" element={<Navigate to="/reports" replace />} />
            <Route path="/history" element={<Navigate to="/reports" replace />} />
            <Route path="/stats" element={<Navigate to="/reports" replace />} />
            <Route path="/reports" element={<RequireAuth><SuspenseRoute><Reports /></SuspenseRoute></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><SuspenseRoute><Settings /></SuspenseRoute></RequireAuth>} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/settings/delete-account" element={<RequireAuth><SuspenseRoute><DeleteAccount /></SuspenseRoute></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TimeTrackerProvider>
        </TourProvider>
        </ProfileProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
