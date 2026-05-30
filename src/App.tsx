import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { keepPreviousData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { attachDeepLinkListener } from "@/lib/deepLinks";
import { setPushDeepLinkHandler } from "@/lib/nativePush";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProfileProvider, useProfile } from "@/hooks/useProfile";
import { useTheme } from "@/lib/theme";
import { TourProvider } from "@/components/app/Tour";
import { TimeTrackerProvider, useTimeTracker } from "@/hooks/useTimeTracker";
import { PageFallback } from "@/components/app/PageFallback";
import { RouteErrorBoundary } from "@/components/app/RouteErrorBoundary";
import { EagerPrefetcher } from "@/components/app/EagerPrefetcher";
import { Shell } from "@/components/app/Shell";
import { PersistentTabs } from "@/components/app/PersistentTabs";
import { NotificationBridge } from "@/components/app/NotificationBridge";
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

/** Mounts once inside the router so `useNavigate` is available, and
 *  routes any incoming custom-scheme / Universal Link URL into the
 *  in-app navigator. Also wires push-notification taps through the
 *  same router so a tapped notification opens the right screen. */
const DeepLinkBridge = () => {
  const navigate = useNavigate();
  const { stop } = useTimeTracker();
  // Hold the latest stop() in a ref so the listener can be attached once and
  // never churns when the tracker provider re-renders.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);
  useEffect(() => {
    const unsubscribe = attachDeepLinkListener(
      (path) => {
        // Prevent pushing the exact same route if we're already there,
        // which causes an infinite visual loop on Live Activity resume taps.
        const currentPath = window.location.pathname;
        const currentSearch = window.location.search;
        const [newPathname, newSearch] = path.split("?");
        if (currentPath === newPathname && (currentSearch === `?${newSearch}` || (!currentSearch && !newSearch))) {
          return;
        }
        navigate(path, { replace: true });
      },
      (action) => {
        // "Stop" tapped inside the Tracker Live Activity. The tracker is the
        // single global session, so no id is needed — stop() ends it and the
        // tracker store tears the activity down.
        if (action.type === "tracker_stop") void stopRef.current?.();
      },
    );
    setPushDeepLinkHandler((path) => navigate(path));
    return () => {
      unsubscribe();
      setPushDeepLinkHandler(null);
    };
  }, [navigate]);
  return null;
};

/**
 * iOS WKWebView prepares the keyboard UI lazily — the first ever focus in a
 * session triggers a 1-3 second initialization. Pre-warm it by focusing a
 * hidden off-screen input ~2 seconds after the app loads, before the user
 * touches any real field. Native-only: on web this is a no-op.
 */
function KeyboardPrewarm() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const t = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      window.setTimeout(() => el.blur(), 50);
    }, 2000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <input
      ref={ref}
      aria-hidden="true"
      readOnly
      tabIndex={-1}
      style={{
        position: "fixed",
        opacity: 0,
        pointerEvents: "none",
        top: "-9999px",
        left: "-9999px",
        width: "1px",
        height: "1px",
      }}
    />
  );
}

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
        
            <KeyboardPrewarm />
            <EagerPrefetcher />
            <DeepLinkBridge />
            <NotificationBridge />
            
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
        
        </TimeTrackerProvider>
        </TourProvider>
        </ProfileProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default AppContent;
