import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { keepPreviousData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { attachDeepLinkListener } from "@/lib/deepLinks";
import { supabase } from "@/integrations/supabase/client";
import { setPushDeepLinkHandler } from "@/lib/nativePush";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProfileProvider, useProfile } from "@/hooks/useProfile";
import { useTheme } from "@/lib/theme";
import { HintsProvider } from "@/hooks/useHints";
import { TimeTrackerProvider, useTimeTracker } from "@/hooks/useTimeTracker";
import { PageFallback } from "@/components/app/PageFallback";
import { RouteErrorBoundary } from "@/components/app/RouteErrorBoundary";
import { EagerPrefetcher } from "@/components/app/EagerPrefetcher";
import { Shell } from "@/components/app/Shell";
import { PersistentTabs } from "@/components/app/PersistentTabs";
import { NotificationBridge } from "@/components/app/NotificationBridge";
import { AppLock } from "@/components/app/AppLock";
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
const NavigationBridge = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { stop } = useTimeTracker();

  // 1. Close orphaned sheets when the route changes (e.g. via iOS swipe-to-go-back).
  // Radix UI Dialogs listen to the Escape key.
  useEffect(() => {
    // Match BOTH role="dialog" (Radix Dialog/Sheet) AND role="alertdialog"
    // (Radix AlertDialog — destructive confirms). The alertdialog role was
    // previously missed, so a route change left those confirms orphaned.
    const openModal = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
    if (openModal) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
  }, [location.pathname]);

  // 2. Hardware back button listener for Android.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listener: Promise<{ remove: () => void }> | null = null;
    let lastBackPressTime = 0;

    void import("@capacitor/app").then(({ App }) => {
      listener = App.addListener("backButton", ({ canGoBack }) => {
        // A) Close open modal/sheet first. Include role="alertdialog" (Radix
        // AlertDialog — stop-timer / delete confirms) alongside role="dialog";
        // it was previously missed, so hardware-back fell through to navigation
        // or app-exit while a destructive confirm was on screen.
        const openModal = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
        if (openModal) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          return;
        }

        // B) At a root tab — "press back again to exit" pattern.
        const path = window.location.pathname;
        const isRootTab = ["/", "/home", "/today", "/today/plan", "/reports", "/settings"].includes(path);
        if (isRootTab) {
          const now = Date.now();
          if (now - lastBackPressTime < 2000) {
            App.exitApp();
          } else {
            lastBackPressTime = now;
            toast("Press back again to exit", { duration: 2000 });
          }
          return;
        }

        // C) Pop history.
        if (canGoBack) {
          window.history.back();
        } else {
          App.exitApp();
        }
      });
    });
    return () => {
      if (listener) void listener.then((l) => l.remove());
    };
  }, []);

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
        // Defer navigation until the iOS WebView compositor is fully resumed.
        // Synchronous React rendering during the appUrlOpen transition can cause
        // the visual layer to freeze, ignoring subsequent TabBar clicks.
        requestAnimationFrame(() => {
          setTimeout(() => navigate(path, { replace: true }), 50);
        });
      },
      (action) => {
        // "Stop" tapped inside the Tracker Live Activity. The tracker is the
        // single global session, so no id is needed — stop() ends it and the
        // tracker store tears the activity down.
        //
        // On a cold/suspended wake the tracker store may not have hydrated the
        // active session yet, so stop() returns false on the first try — that
        // was the "widget Stop needs two taps" bug. Retry briefly (every 250ms,
        // up to ~3s) until it lands; harmless no-op if nothing is active.
        if (action.type === "tracker_stop") {
          let attempts = 0;
          const tryStop = async () => {
            const ok = await stopRef.current?.({ fromWidget: true });
            if (ok || attempts >= 12) return;
            attempts += 1;
            setTimeout(() => void tryStop(), 250);
          };
          void tryStop();
        }
        // Email confirmation / password recovery came back via the
        // daydraft://auth-callback custom scheme (see authRedirectTo in
        // deepLinks.ts) — establish the session GoTrue handed us. Signup
        // confirmation lands on an explicit "you're verified" screen
        // (state.justConfirmed) with a Continue button, rather than
        // silently redirecting and hoping Auth.tsx's own auth-state effect
        // notices in time — same deferred-navigate fix as the route case
        // above, since this also fires during the same appUrlOpen resume
        // window where synchronous navigation can freeze the visual layer.
        if (action.type === "auth_session") {
          void supabase.auth.setSession({ access_token: action.accessToken, refresh_token: action.refreshToken }).then(({ error }) => {
            requestAnimationFrame(() => {
              setTimeout(() => {
                if (error) {
                  toast.error(error.message || "Couldn't confirm — try signing in");
                  navigate("/auth", { replace: true });
                  return;
                }
                navigate(action.recovery ? "/reset-password" : "/auth", {
                  replace: true,
                  state: action.recovery ? undefined : { justConfirmed: true },
                });
              }, 50);
            });
          });
        }
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

const ThemedToaster = () => {
  const { resolved } = useTheme();
  // CRITICAL: portal to <body>. `#root` is `position: fixed` (index.css), which
  // makes it a stacking context — so a toaster rendered INSIDE #root can never
  // paint above Radix Dialog/Sheet portals, which mount as SIBLINGS of #root on
  // <body> and therefore paint on top no matter how high the toaster's z-index
  // is. Mounting the toaster on <body> too puts it in the same stacking level,
  // where its z-index actually wins → toasts show over a dimmed sheet backdrop.
  const toaster = (
    <Sonner
      theme={resolved}
      // Top-center, comfortably below the Dynamic Island / status bar. Uses the
      // safe-area-inset-top so toasts clear the notch on every device.
      position="top-center"
      offset="calc(env(safe-area-inset-top, 44px) + 26px)"
      // sonner applies `offset` ONLY above 600px wide. On every phone (≤600px) it
      // falls back to its DEFAULT `mobileOffset` (16px) — so we mirror the value
      // here or the toast lands under the notch on device. Side margins keep the
      // full-width mobile toast off the screen edges.
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 44px) + 26px)", left: "16px", right: "16px" }}
      // Above sheets/overlays (z-50) and the tab bar (z-40) so a toast is ALWAYS
      // on top — never dimmed behind a sheet's backdrop.
      style={{ zIndex: 2147483647 }}
    />
  );
  return typeof document !== "undefined" ? createPortal(toaster, document.body) : toaster;
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
        <HintsProvider>
        <TimeTrackerProvider>
          <AppLock>
            <EagerPrefetcher />
            <NavigationBridge />
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
              <Route path="/reports" element={null} />
              <Route path="/settings" element={null} />
            </Route>
            <Route path="/focus/:blockId" element={<RequireAuth><SuspenseRoute><Focus /></SuspenseRoute></RequireAuth>} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/settings/delete-account" element={<RequireAuth><SuspenseRoute><DeleteAccount /></SuspenseRoute></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </AppLock>
        </TimeTrackerProvider>
        </HintsProvider>
        </ProfileProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default AppContent;
