import type { LucideIcon } from "lucide-react";
import {
  Zap,
  Sparkles,
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
  | "insights"
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
    headline: "No daily planning cap",
    tagline: "Free plan allows 5 planning days. Pro removes every limit — plan every day, generate unlimited AI schedules.",
    sheetLine: "Unlimited planning days & AI",
  },
  {
    id: "insights",
    Icon: Sparkles,
    headline: "Daily AI Insights",
    tagline: "A new riddle, quiz, or challenge every morning — plus a look back at yesterday’s plan.",
    sheetLine: "Daily AI riddles, quizzes & recap",
  },
  {
    id: "timer_reschedule",
    Icon: Clock,
    headline: "Micro-reschedule after tracking",
    tagline: "After you log time on a task, get optional one-tap adjustments to shift the rest of your day.",
    sheetLine: "Post-track micro-reschedule hints",
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
