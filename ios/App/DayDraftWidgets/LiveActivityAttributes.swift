//
//  LiveActivityAttributes.swift
//  DayDraft
//
//  Shared Live Activity data models. This file MUST belong to BOTH targets:
//  • App                — the LiveActivityPlugin requests / updates / ends activities
//  • DayDraftWidgets     — the widget extension renders them
//  (Select the file in Xcode → File Inspector → Target Membership → tick both.)
//

import ActivityKit
import Foundation

/// A running Focus session. The big timer counts up from `startedAt`; the
/// system renders it live without us pushing per-second updates.
struct FocusActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Wall-clock the focus timer started ticking. Drives the live timer.
        var startedAt: Date
    }

    /// Title of the task being focused (fixed for the life of the activity).
    var taskTitle: String
    /// Planned duration in minutes — shown as the "of 1h 30m" subtitle.
    var plannedMinutes: Int
    /// Block id, so a tap can deep-link straight back to this Focus screen.
    var blockId: String
}

/// A running time-tracker session started outside Focus (from the Tracker tab).
/// Shows the category, a live timer and — when a rate exists — the hourly rate.
struct TrackerActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Wall-clock the tracker started. Drives the live timer.
        var startedAt: Date
    }

    var categoryName: String
    /// Hex colour of the category, e.g. "#6366f1".
    var colorHex: String
    /// Hourly rate in the category currency. 0 means "no rate set".
    var hourlyRate: Double
    /// ISO currency code, e.g. "USD".
    var currencyCode: String
}
