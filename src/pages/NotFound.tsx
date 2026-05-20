import { Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";

// Known top-level app sections. If we somehow land on /focus/<stale-id> or
// /today?... and the router still matched "*", redirect home instead of
// trapping the user on a dead 404 screen (e.g. after a long timer stops).
const APP_PREFIXES = ["/today", "/focus", "/tracker", "/reports", "/settings", "/home", "/onboarding"];

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  if (APP_PREFIXES.some((p) => location.pathname === p || location.pathname.startsWith(p + "/"))) {
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="app-card max-w-sm w-full px-8 py-10 text-center">
        <p className="eyebrow text-primary/90">Error</p>
        <h1 className="font-display text-[40px] font-semibold tabular-nums mt-2">404</h1>
        <p className="text-[14px] text-secondary-fg mt-3 leading-[1.55]">This page doesn&apos;t exist or was moved.</p>
        <a href="/today" className="inline-block mt-6 text-[14px] font-medium text-primary hover:underline">
          Back to Today
        </a>
      </div>
    </div>
  );
};

export default NotFound;
