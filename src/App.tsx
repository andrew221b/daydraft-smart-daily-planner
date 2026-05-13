import { lazy, Suspense, type ReactNode } from "react";
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

const Home = lazy(() => import("./pages/app/Home"));
const Tracker = lazy(() => import("./pages/app/Tracker"));
const DayView = lazy(() => import("./pages/app/DayView"));
const Focus = lazy(() => import("./pages/app/Focus"));
const Reports = lazy(() => import("./pages/app/Reports"));
const Settings = lazy(() => import("./pages/app/Settings"));
const Onboarding = lazy(() => import("./pages/app/Onboarding"));
const Auth = lazy(() => import("./pages/app/Auth"));
const DeleteAccount = lazy(() => import("./pages/legal/DeleteAccount"));

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

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const { user, loading } = useAuth();
  const { profile, loading: pLoading } = useProfile();
  const loc = useLocation();
  if (loading || (user && pLoading)) return <PageFallback />;
  if (!user) return <Navigate to="/auth" replace state={{ from: loc }} />;
  const onOnboardingRoute = loc.pathname === "/onboarding";
  // Treat unknown profile state as "onboarding not resolved" to avoid letting
  // authenticated users into app routes before profile/onboarding is known.
  const onboardingResolved = profile?.onboarded === true;
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
