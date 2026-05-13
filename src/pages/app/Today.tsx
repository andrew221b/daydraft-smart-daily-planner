import { Navigate } from "react-router-dom";

// Today is now the manual planner (DayView). This file kept only for legacy imports.
export default function Today() {
  return <Navigate to="/today/plan" replace />;
}

