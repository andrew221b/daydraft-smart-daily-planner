import type { LucideIcon } from "lucide-react";
import {
  Zap,
  Compass,
  Clock,
  FileDown,
  Wallet,
} from "lucide-react";

/** Real product capabilities gated behind Pro — single source for paywall + discovery UI.
 *  Only list features that actually exist in the current build. Calendar sync
 *  and Yesterday debrief were removed here because the matching UI is not wired
 *  up (no VITE_GOOGLE_CALENDAR_CLIENT_ID, TodayInsight not rendered). Add them
 *  back when their entry points are live in the app. */
export type ProFeatureId =
  | "unlimited"
  | "drift"
  | "timer_reschedule"
  | "pdf_export"
  | "billing_reports";

export type ProCatalogItem = {
  id: ProFeatureId;
  Icon: LucideIcon;
  /** Short title in lists */
  headline: string;
  /** One line — what you actually get */
  tagline: string;
  /** Compact line used inside UpgradeSheet bullets */
  sheetLine: string;
};

export const PRO_FEATURE_CATALOG: ProCatalogItem[] = [
  {
    id: "unlimited",
    Icon: Zap,
    headline: "Unlimited everything",
    tagline: "Plan every day, generate unlimited AI schedules, and chat with AI without limits.",
    sheetLine: "Unlimited days & AI planning",
  },
  {
    id: "drift",
    Icon: Compass,
    headline: "Plan drift nudges",
    tagline: "When the day slips, get a gentle nudge and a one-tap way to reshuffle what's left.",
    sheetLine: "Plan drift nudges & replan hints",
  },
  {
    id: "timer_reschedule",
    Icon: Clock,
    headline: "Timer-smart replans",
    tagline: "After you track time, optional micro-adjustments to the rest of today’s plan.",
    sheetLine: "Timer-based reschedule hints",
  },
  {
    id: "pdf_export",
    Icon: FileDown,
    headline: "Professional PDF Reports",
    tagline: "Export your tracked time to beautiful PDF reports for clients and reviews.",
    sheetLine: "Professional PDF Tracker Exports",
  },
  {
    id: "billing_reports",
    Icon: Wallet,
    headline: "Billing-ready details",
    tagline: "Include your hourly rates, earned totals, and payment instructions in exports.",
    sheetLine: "Billing & payment instructions on exports",
  },
];

export const proCatalogById = (id: ProFeatureId): ProCatalogItem | undefined =>
  PRO_FEATURE_CATALOG.find((x) => x.id === id);
