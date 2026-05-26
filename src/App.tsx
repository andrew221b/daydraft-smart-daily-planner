import { Suspense, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { keepPreviousData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { EagerPrefetcher } from "@/components/app/EagerPrefetcher";
import { Shell } from "@/components/app/Shell";
import { AppLock } from "@/components/app/AppLock";
import { BiometricOptInSheet } from "@/components/app/BiometricOptInSheet";
import { PersistentTabs } from "@/components/app/PersistentTabs";
import { lazyWithReload } from "@/lib/lazyWithReload";
import ForgotPassword from "./pages/app/ForgotPassword";
import ResetPassword from "./pages/app/ResetPassword";
import Privacy from "./pages/legal/Privacy";
import Terms from "./pages/legal/Terms";

// Drill-in pages (Focus) and the auth / onboarding / legal pages still mount
// the classic React.lazy way. Tab pages (Home, DayView, Tracker, Reports,
// Settings) are loaded inside <PersistentTabs />, which keeps them alive
// across tab switches instead of remounting on each route change.
const Focus = lazyWithReload(() => import("./pages/app/Focus"));
const Onboarding = lazyWithReload(() => import("./pages/app/Onboarding"));
const Auth = lazyWithReload(() => import("./pages/app/Auth"));
const DeleteAccount = lazyWithReload(() => import("./pages/legal/DeleteAccount"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Bumped from 10m to 30m so a user who hops between tabs over a long
      // session keeps reading from cache instead of paying repeat round-trips
      // once the page unmounts.
      gcTime: 30 * 60_000,
      retry: 1,
      // Native WebView "focus" events are noisy; refetching every tab return causes jank.
      refetchOnWindowFocus: !Capacitor.isNativePlatform(),
      // While a stale query refetches in the background, hand consumers the
      // previous successful result instead of `undefined`. This is the single
      // most visible change for tab switches: pages render with last-seen
      // content on first paint instead of flashing the empty state.
      placeholderData: keepPreviousData,
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

  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/auth" replace state={{ from: loc }} />;

  const knownOnboarded = readOnboardedFlag(user.id);
  // Only block on the profile network fetch if we DON'T know their onboarding status yet.
  // This saves a full network round-trip on cold launches for returning users!
  if (!knownOnboarded && pLoading) return <PageFallback />;

  const onOnboardingRoute = loc.pathname === "/onboarding" || loc.pathname === "/onboarding/";
  const onboardingResolved = profile?.onboarded === true || knownOnboarded;

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

/**
 * Tab-route layout: mounts Shell + the persistent tab pages once and keeps
 * them alive across tab switches. Switching from /home to /reports doesn't
 * unmount Home anymore — it just toggles which tree is visible. That kills
 * the remaining tab-switch flicker (state preserved, data instant from
 * cache, no Suspense fallback) and matches how UITabBarController works.
 */
const ShellLayout = () => (
  <RequireAuth>
    <Shell>
      <PersistentTabs />
    </Shell>
  </RequireAuth>
);

const AppContent = () => {
  // Native splash is hidden in main.tsx, before React mounts — the inline
  // boot-overlay in index.html is what bridges the gap until the first React
  // commit lands.
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemedToaster />
      <BrowserRouter>
        <AuthProvider>
        <ProfileProvider>
        <TourProvider>
        <TimeTrackerProvider>
          <AppLock>
            <EagerPrefetcher />
            {/* One-time post-auth opt-in for Face ID / Fingerprint.
                Self-gates on user + onboarded + native + not-yet-asked, so
                it's safe to leave mounted at the app root; it only shows
                its sheet when the conditions all line up. */}
            <BiometricOptInSheet />
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/auth" element={<SuspenseRoute><Auth /></SuspenseRoute>} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboarding" element={<RequireAuth><SuspenseRoute><Onboarding /></SuspenseRoute></RequireAuth>} />
            {/*
              Tab routes share a single ShellLayout. PersistentTabs reads the
              pathname directly to decide which tab's tree is visible, so the
              individual route elements only exist to make React Router match
              the parent layout — they intentionally render nothing.
            */}
            <Route element={<ShellLayout />}>
              <Route path="/home" element={null} />
              <Route path="/today" element={null} />
              <Route path="/today/plan" element={null} />
              <Route path="/tracker" element={null} />
              <Route path="/reports" element={null} />
              <Route path="/settings" element={null} />
            </Route>
            <Route path="/today/planning" element={<Navigate to="/today/plan" replace />} />
            <Route path="/focus/:blockId" element={<RequireAuth><SuspenseRoute><Focus /></SuspenseRoute></RequireAuth>} />
            <Route path="/recap" element={<Navigate to="/reports" replace />} />
            <Route path="/recap/week" element={<Navigate to="/reports" replace />} />
            <Route path="/history" element={<Navigate to="/reports" replace />} />
            <Route path="/stats" element={<Navigate to="/reports" replace />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/settings/delete-account" element={<RequireAuth><SuspenseRoute><DeleteAccount /></SuspenseRoute></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </AppLock>
        </TimeTrackerProvider>
        </TourProvider>
        </ProfileProvider>
        </AuthProvider>
      </BrowserRouter>
      {/* Global home-indicator cover. Explicit primary-glow gradient so the
          zone isn't pure black (backdrop-filter over #000 = black). */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0"
        style={{
          height: "env(safe-area-inset-bottom, 0px)",
          zIndex: 99999,
          background: "linear-gradient(to top, hsl(var(--primary-glow) / 0.18), hsl(var(--primary-glow) / 0.06))",
        }}
        aria-hidden
      />
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default AppContent;
