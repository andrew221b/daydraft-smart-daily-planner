import type { LucideIcon } from "lucide-react";
import {
  Zap,
  Calendar,
  Sparkles,
  Compass,
  Clock,
  FileDown,
} from "lucide-react";

/** Real product capabilities gated behind Pro — single source for paywall + discovery UI. */
export type ProFeatureId =
  | "unlimited"
  | "calendar"
  | "debrief"
  | "drift"
  | "timer_reschedule"
  | "pdf_export";

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
    headline: "Unlimited AI planning",
    tagline: "New plan days whenever you need them — no lifetime 5-day ceiling.",
    sheetLine: "Unlimited AI planning days",
  },
  {
    id: "calendar",
    Icon: Calendar,
    headline: "Google Calendar in every plan",
    tagline: "Meetings and holds show up as fixed blocks the AI schedules around.",
    sheetLine: "Calendar-aware schedules",
  },
  {
    id: "debrief",
    Icon: Sparkles,
    headline: "Yesterday debrief",
    tagline: "AI reads what you did and didn’t — quick takeaways on the Today screen.",
    sheetLine: "Yesterday debrief cards",
  },
  {
    id: "drift",
    Icon: Compass,
    headline: "Plan drift nudges",
    tagline: "When the day slips, get a gentle nudge and a one-tap way to reshuffle what’s left.",
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
];

export const proCatalogById = (id: ProFeatureId): ProCatalogItem | undefined =>
  PRO_FEATURE_CATALOG.find((x) => x.id === id);
