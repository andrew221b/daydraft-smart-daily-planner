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
    headline: "Unlimited planning days",
    tagline: "Plan every day you need — no lifetime 5-day ceiling.",
    sheetLine: "Unlimited planning days",
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
    headline: "PDF time reports",
    tagline: "Export week or month from the tracker for expenses, clients, or reviews.",
    sheetLine: "Tracker PDF export",
  },
  {
    id: "billing_reports",
    Icon: Wallet,
    headline: "Billing-ready reports",
    tagline: "Include hourly rates, earned totals, selected categories, and payment instructions.",
    sheetLine: "Billing reports with payment details",
  },
];

export const proCatalogById = (id: ProFeatureId): ProCatalogItem | undefined =>
  PRO_FEATURE_CATALOG.find((x) => x.id === id);
