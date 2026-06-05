//
//  LiveActivityPlugin.swift
//  App
//
//  Capacitor bridge to ActivityKit. Starts / stops the Focus and Tracker
//  Live Activities that render in the Dynamic Island and on the Lock Screen.
//
//  Design notes:
//  • Only ONE Live Activity is ever shown. Starting either type ends the other,
//    so Focus and a stray Tracker activity never stack.
//  • The timer counts up natively from `startedAt` (SwiftUI handles ticking) —
//    we never push per-second updates, so there's no battery / throttling cost.
//  • Activity references are re-adopted in `load()` so an app relaunch can
//    still end an activity that's already on screen (no orphans).
//
//  Every code path logs through `LALog` (NSLog) so failures are visible in
//  Xcode's console AND Console.app — filter by "[LiveActivity]".
//

import Foundation
import Capacitor
import ActivityKit

/// Unified logger. Shows up in Xcode console and Console.app — filter "[LiveActivity]".
@inline(__always)
private func LALog(_ message: String) {
    NSLog("[LiveActivity] \(message)")
}

// Capacitor 8 convention: @objc name and identifier MUST equal the Swift class
// name, NOT the JS name. The bridge looks up plugins by class name at runtime.
// jsName is the JS-side name used in Capacitor.Plugins.LiveActivity.
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startFocus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ensureFocus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopFocus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateFocusCategory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateFocusOverrun", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTracker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTracker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAll", returnType: CAPPluginReturnPromise),
    ]

    // Stored as `Any?` because `Activity<…>` is gated to iOS 16.1 and the
    // class itself is not. Cast back inside availability-checked helpers.
    private var focusActivity: Any?
    private var trackerActivity: Any?

    override public func load() {
        LALog("Plugin loaded — class is in the binary and registered ✅")
        if #available(iOS 16.1, *) {
            let focusCount = Activity<FocusActivityAttributes>.activities.count
            let trackerCount = Activity<TrackerActivityAttributes>.activities.count
            focusActivity = Activity<FocusActivityAttributes>.activities.first
            trackerActivity = Activity<TrackerActivityAttributes>.activities.first
            LALog("Re-adopted on launch — focus activities: \(focusCount), tracker activities: \(trackerCount)")
            logAuthState()
        } else {
            LALog("iOS < 16.1 — Live Activities not available on this OS")
        }
    }

    // MARK: - Capability

    @objc public func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) {
            let info = ActivityAuthorizationInfo()
            let enabled = info.areActivitiesEnabled
            LALog("isSupported → areActivitiesEnabled=\(enabled)")
            if !enabled {
                LALog("⚠️ Live Activities are DISABLED. Likely cause: Settings → DayDraft → Live Activities is OFF, or Settings → Face ID & Passcode hides them on lock screen. Toggle it ON.")
            }
            call.resolve([
                "supported": enabled,
                "enabled": enabled,
                "osSupported": true,
                "reason": enabled ? "ok" : "disabled-in-settings",
            ])
        } else {
            LALog("isSupported → false (iOS < 16.1)")
            call.resolve([
                "supported": false,
                "enabled": false,
                "osSupported": false,
                "reason": "os-too-old",
            ])
        }
    }

    /// Logs the current authorization state for diagnostics.
    @available(iOS 16.1, *)
    private func logAuthState() {
        let info = ActivityAuthorizationInfo()
        LALog("Authorization: areActivitiesEnabled=\(info.areActivitiesEnabled), frequentUpdatesEnabled=\(info.frequentPushesEnabled)")
    }

    // MARK: - Focus

    @objc public func startFocus(_ call: CAPPluginCall) {
        LALog("startFocus called")
        guard #available(iOS 16.1, *) else {
            LALog("startFocus aborted — iOS < 16.1")
            call.resolve(["started": false, "reason": "os-too-old"])
            return
        }

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            LALog("⚠️ startFocus aborted — areActivitiesEnabled is FALSE. Enable: Settings → DayDraft → Live Activities.")
            call.resolve(["started": false, "reason": "disabled-in-settings"])
            return
        }

        let title = call.getString("taskTitle") ?? "Focus session"
        let planned = call.getInt("plannedMinutes") ?? 0
        let blockId = call.getString("blockId") ?? ""
        let nextTaskTitle = call.getString("nextTaskTitle")
        let categoryName = call.getString("categoryName")
        let colorHex = call.getString("colorHex")
        let startedAt = dateFromMillis(call.getDouble("startedAt"))
        LALog("startFocus params — title='\(title)', planned=\(planned)m, blockId='\(blockId)', startedAt=\(startedAt), category=\(categoryName ?? "nil")")

        let result = requestFocusActivity(
            title: title, planned: planned, blockId: blockId, nextTaskTitle: nextTaskTitle,
            startedAt: startedAt, categoryName: categoryName, colorHex: colorHex
        )
        if result.started {
            call.resolve(["started": true, "id": result.id ?? ""])
        } else {
            call.reject("Could not start Focus Live Activity: \(result.error ?? "unknown")", "LA_START_FAILED")
        }
    }

    /// Re-arm the Focus Live Activity WITHOUT tearing down a healthy one.
    /// Called on every app foreground while a focus session is active.
    /// • If an activity already exists → leave its timer running untouched and
    ///   only refresh the category chip (heals a chip lost to an OS snapshot).
    /// • If none exists → create one, identical to `startFocus`.
    /// This avoids the flash / lost `nextTaskTitle` / wiped category that a blind
    /// end+recreate would cause every time the app comes to the foreground.
    @objc public func ensureFocus(_ call: CAPPluginCall) {
        LALog("ensureFocus called")
        guard #available(iOS 16.1, *) else {
            call.resolve(["started": false, "reason": "os-too-old"])
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            LALog("⚠️ ensureFocus aborted — areActivitiesEnabled is FALSE.")
            call.resolve(["started": false, "reason": "disabled-in-settings"])
            return
        }

        let categoryName = call.getString("categoryName")
        let colorHex = call.getString("colorHex")

        let existing = Activity<FocusActivityAttributes>.activities
        if !existing.isEmpty {
            LALog("ensureFocus — \(existing.count) focus activity(ies) already live; refreshing category only")
            Task {
                for activity in existing {
                    let current = activity.content.state
                    let newState = FocusActivityAttributes.ContentState(
                        startedAt: current.startedAt,
                        categoryName: categoryName,
                        categoryColorHex: colorHex
                    )
                    await activity.update(ActivityContent(state: newState, staleDate: nil))
                }
            }
            focusActivity = existing.first
            call.resolve(["started": true, "existed": true])
            return
        }

        // Nothing live — create one (same path as startFocus).
        let title = call.getString("taskTitle") ?? "Focus session"
        let planned = call.getInt("plannedMinutes") ?? 0
        let blockId = call.getString("blockId") ?? ""
        let nextTaskTitle = call.getString("nextTaskTitle")
        let startedAt = dateFromMillis(call.getDouble("startedAt"))
        LALog("ensureFocus — none live; creating. title='\(title)', planned=\(planned)m, category=\(categoryName ?? "nil")")
        let result = requestFocusActivity(
            title: title, planned: planned, blockId: blockId, nextTaskTitle: nextTaskTitle,
            startedAt: startedAt, categoryName: categoryName, colorHex: colorHex
        )
        if result.started {
            call.resolve(["started": true, "existed": false, "id": result.id ?? ""])
        } else {
            call.resolve(["started": false, "reason": result.error ?? "unknown"])
        }
    }

    /// Shared builder: ends any other Live Activity, then requests a fresh Focus
    /// activity (seeding the optional tracker category). Used by both `startFocus`
    /// and `ensureFocus`.
    @available(iOS 16.1, *)
    private func requestFocusActivity(
        title: String, planned: Int, blockId: String, nextTaskTitle: String?,
        startedAt: Date, categoryName: String?, colorHex: String?
    ) -> (started: Bool, id: String?, error: String?) {
        endTrackerActivity()
        endFocusActivity()

        let attributes = FocusActivityAttributes(
            taskTitle: title,
            plannedMinutes: planned,
            blockId: blockId,
            nextTaskTitle: nextTaskTitle
        )
        let state = FocusActivityAttributes.ContentState(
            startedAt: startedAt,
            categoryName: categoryName,
            categoryColorHex: colorHex
        )
        let content = ActivityContent(state: state, staleDate: nil)

        do {
            let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
            focusActivity = activity
            LALog("✅ Focus Live Activity STARTED — id=\(activity.id)")
            return (true, activity.id, nil)
        } catch {
            let detail = decodeActivityError(error)
            LALog("❌ start Focus FAILED — \(detail)")
            return (false, nil, detail)
        }
    }

    @objc public func stopFocus(_ call: CAPPluginCall) {
        LALog("stopFocus called")
        if #available(iOS 16.1, *) { endFocusActivity() }
        call.resolve()
    }

    /// Update the Focus Live Activity's content state with a tracker category.
    /// Pass nil values to clear the category (tracker stopped).
    @objc public func updateFocusCategory(_ call: CAPPluginCall) {
        LALog("updateFocusCategory called")
        guard #available(iOS 16.1, *) else {
            call.resolve()
            return
        }
        let categoryName = call.getString("categoryName")
        let colorHex = call.getString("colorHex")
        LALog("updateFocusCategory — name=\(categoryName ?? "nil"), color=\(colorHex ?? "nil")")
        Task {
            for activity in Activity<FocusActivityAttributes>.activities {
                let current = activity.content.state
                let newState = FocusActivityAttributes.ContentState(
                    startedAt: current.startedAt,
                    categoryName: categoryName,
                    categoryColorHex: colorHex
                )
                await activity.update(ActivityContent(state: newState, staleDate: nil))
                LALog("updateFocusCategory ✅ activity id=\(activity.id)")
            }
        }
        call.resolve()
    }

    /// Signal the Focus Live Activity that the planned duration has been exceeded.
    /// The widget flips all tints from blue → red (no layout change, fast update).
    @objc public func updateFocusOverrun(_ call: CAPPluginCall) {
        LALog("updateFocusOverrun called")
        guard #available(iOS 16.1, *) else {
            call.resolve()
            return
        }
        let isOverrun = call.getBool("isOverrun") ?? false
        LALog("updateFocusOverrun — isOverrun=\(isOverrun)")
        Task {
            for activity in Activity<FocusActivityAttributes>.activities {
                let current = activity.content.state
                let newState = FocusActivityAttributes.ContentState(
                    startedAt: current.startedAt,
                    categoryName: current.categoryName,
                    categoryColorHex: current.categoryColorHex,
                    isOverrun: isOverrun
                )
                await activity.update(ActivityContent(state: newState, staleDate: nil))
                LALog("updateFocusOverrun ✅ activity id=\(activity.id)")
            }
        }
        call.resolve()
    }

    // MARK: - Tracker

    @objc public func startTracker(_ call: CAPPluginCall) {
        LALog("startTracker called")
        guard #available(iOS 16.1, *) else {
            LALog("startTracker aborted — iOS < 16.1")
            call.resolve(["started": false, "reason": "os-too-old"])
            return
        }

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            LALog("⚠️ startTracker aborted — areActivitiesEnabled is FALSE. Enable: Settings → DayDraft → Live Activities.")
            call.resolve(["started": false, "reason": "disabled-in-settings"])
            return
        }

        let name = call.getString("categoryName") ?? "Tracking"
        let colorHex = call.getString("colorHex") ?? "#0A84FF"
        let rate = call.getDouble("hourlyRate") ?? 0
        let currency = call.getString("currencyCode") ?? "USD"
        let startedAt = dateFromMillis(call.getDouble("startedAt"))
        LALog("startTracker params — name='\(name)', color=\(colorHex), rate=\(rate) \(currency), startedAt=\(startedAt)")

        endFocusActivity()
        endTrackerActivity()

        let attributes = TrackerActivityAttributes(
            categoryName: name,
            colorHex: colorHex,
            hourlyRate: rate,
            currencyCode: currency
        )
        let state = TrackerActivityAttributes.ContentState(startedAt: startedAt)
        let content = ActivityContent(state: state, staleDate: nil)

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
            trackerActivity = activity
            LALog("✅ Tracker Live Activity STARTED — id=\(activity.id)")
            call.resolve(["started": true, "id": activity.id])
        } catch {
            let detail = decodeActivityError(error)
            LALog("❌ startTracker FAILED — \(detail)")
            call.reject("Could not start Tracker Live Activity: \(detail)", "LA_START_FAILED", error)
        }
    }

    @objc public func stopTracker(_ call: CAPPluginCall) {
        LALog("stopTracker called")
        if #available(iOS 16.1, *) { endTrackerActivity() }
        call.resolve()
    }

    @objc public func stopAll(_ call: CAPPluginCall) {
        LALog("stopAll called")
        if #available(iOS 16.1, *) {
            endFocusActivity()
            endTrackerActivity()
        }
        call.resolve()
    }

    // MARK: - Private

    @available(iOS 16.1, *)
    private func endFocusActivity() {
        LALog("Ending Focus activities...")
        Task {
            for activity in Activity<FocusActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        focusActivity = nil
    }

    @available(iOS 16.1, *)
    private func endTrackerActivity() {
        LALog("Ending Tracker activities...")
        Task {
            for activity in Activity<TrackerActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        trackerActivity = nil
    }

    /// Turns a raw ActivityKit error into a precise, human-readable cause so the
    /// console says EXACTLY what's wrong instead of a vague message.
    @available(iOS 16.1, *)
    private func decodeActivityError(_ error: Error) -> String {
        if let laError = error as? ActivityAuthorizationError {
            switch laError {
            case .denied:
                return "DENIED — the user turned OFF Live Activities. Fix: Settings → DayDraft → Live Activities = ON."
            case .unentitled:
                return "UNENTITLED — missing the Live Activity entitlement. NSSupportsLiveActivities IS in Info.plist, so this means a stale build — clean build folder & rebuild."
            case .unsupported:
                return "UNSUPPORTED — this device/OS can't show Live Activities."
            case .visibility:
                return "VISIBILITY — requested while the app was not in the foreground. Start it while the app is open."
            case .attributesTooLarge:
                return "ATTRIBUTES TOO LARGE — the activity payload exceeds 4KB. Trim the data."
            case .targetMaximumExceeded:
                return "TARGET MAXIMUM EXCEEDED — too many active Live Activities."
            default:
                // Covers SDK-specific cases (.globalMaximumExceeded, .persistenceFailure,
                // .unsupportedTarget, …) without a compile-time dependency on them.
                return "ActivityAuthorizationError: \(laError.localizedDescription)"
            }
        }
        return "\(type(of: error)): \(error.localizedDescription)"
    }

    /// JS sends epoch milliseconds; convert to a `Date`. Falls back to now.
    private func dateFromMillis(_ millis: Double?) -> Date {
        guard let millis, millis > 0 else { return Date() }
        return Date(timeIntervalSince1970: millis / 1000.0)
    }
}
