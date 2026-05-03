import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "./pages/NotFound";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProfileProvider, useProfile } from "@/hooks/useProfile";
import { useTheme } from "@/lib/theme";
import { TourProvider } from "@/components/app/Tour";
import Auth from "./pages/app/Auth";
import Onboarding from "./pages/app/Onboarding";
import Today from "./pages/app/Today";
import Planning from "./pages/app/Planning";
import DayView from "./pages/app/DayView";
import Focus from "./pages/app/Focus";
import Recap from "./pages/app/Recap";
import RecapWeek from "./pages/app/RecapWeek";
import History from "./pages/app/History";
import Stats from "./pages/app/Stats";
import Settings from "./pages/app/Settings";
import Tracker from "./pages/app/Tracker";
import ForgotPassword from "./pages/app/ForgotPassword";
import ResetPassword from "./pages/app/ResetPassword";
import Privacy from "./pages/legal/Privacy";
import Terms from "./pages/legal/Terms";
import DeleteAccount from "./pages/legal/DeleteAccount";
import { TimeTrackerProvider } from "@/hooks/useTimeTracker";

const queryClient = new QueryClient();

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const { user, loading } = useAuth();
  const { profile, loading: pLoading } = useProfile();
  const loc = useLocation();
  if (loading || (user && pLoading)) return <div className="min-h-screen bg-background" />;
  if (!user) return <Navigate to="/auth" replace state={{ from: loc }} />;
  if (profile && !profile.onboarded && loc.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;
  return children;
};

const RootRedirect = () => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background" />;
  return <Navigate to={user ? "/today" : "/auth"} replace />;
};

const ThemedToaster = () => {
  const { resolved } = useTheme();
  return <Sonner theme={resolved} position="top-center" />;
};

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
            <Route path="/auth" element={<Auth />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
            <Route path="/today" element={<RequireAuth><Today /></RequireAuth>} />
            <Route path="/today/planning" element={<RequireAuth><Planning /></RequireAuth>} />
            <Route path="/today/plan" element={<RequireAuth><DayView /></RequireAuth>} />
            <Route path="/focus/:blockId" element={<RequireAuth><Focus /></RequireAuth>} />
            <Route path="/tracker" element={<RequireAuth><Tracker /></RequireAuth>} />
            <Route path="/recap" element={<RequireAuth><Recap /></RequireAuth>} />
            <Route path="/recap/week" element={<RequireAuth><RecapWeek /></RequireAuth>} />
            <Route path="/history" element={<RequireAuth><History /></RequireAuth>} />
            <Route path="/stats" element={<Navigate to="/history" replace />} />
            <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/settings/delete-account" element={<RequireAuth><DeleteAccount /></RequireAuth>} />
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
