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

import Foundation
import Capacitor
import ActivityKit

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startFocus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopFocus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTracker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTracker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAll", returnType: CAPPluginReturnPromise)
    ]

    // Stored as `Any?` because `Activity<…>` is gated to iOS 16.1 and the
    // class itself is not. Cast back inside availability-checked helpers.
    private var focusActivity: Any?
    private var trackerActivity: Any?

    override public func load() {
        if #available(iOS 16.1, *) {
            focusActivity = Activity<FocusActivityAttributes>.activities.first
            trackerActivity = Activity<TrackerActivityAttributes>.activities.first
        }
    }

    // MARK: - Capability

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) {
            call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["supported": false])
        }
    }

    // MARK: - Focus

    @objc func startFocus(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.resolve(["started": false]); return }

        let title = call.getString("taskTitle") ?? "Focus session"
        let planned = call.getInt("plannedMinutes") ?? 0
        let blockId = call.getString("blockId") ?? ""
        let startedAt = dateFromMillis(call.getDouble("startedAt"))

        endTrackerActivity()
        endFocusActivity()

        let attributes = FocusActivityAttributes(
            taskTitle: title,
            plannedMinutes: planned,
            blockId: blockId
        )
        let state = FocusActivityAttributes.ContentState(startedAt: startedAt)
        let content = ActivityContent(state: state, staleDate: nil)

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
            focusActivity = activity
            call.resolve(["started": true, "id": activity.id])
        } catch {
            call.reject("Could not start Focus Live Activity: \(error.localizedDescription)")
        }
    }

    @objc func stopFocus(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) { endFocusActivity() }
        call.resolve()
    }

    // MARK: - Tracker

    @objc func startTracker(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.resolve(["started": false]); return }

        let name = call.getString("categoryName") ?? "Tracking"
        let colorHex = call.getString("colorHex") ?? "#0A84FF"
        let rate = call.getDouble("hourlyRate") ?? 0
        let currency = call.getString("currencyCode") ?? "USD"
        let startedAt = dateFromMillis(call.getDouble("startedAt"))

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
            call.resolve(["started": true, "id": activity.id])
        } catch {
            call.reject("Could not start Tracker Live Activity: \(error.localizedDescription)")
        }
    }

    @objc func stopTracker(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) { endTrackerActivity() }
        call.resolve()
    }

    @objc func stopAll(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) {
            endFocusActivity()
            endTrackerActivity()
        }
        call.resolve()
    }

    // MARK: - Private

    @available(iOS 16.1, *)
    private func endFocusActivity() {
        if let activity = focusActivity as? Activity<FocusActivityAttributes> {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        focusActivity = nil
    }

    @available(iOS 16.1, *)
    private func endTrackerActivity() {
        if let activity = trackerActivity as? Activity<TrackerActivityAttributes> {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        trackerActivity = nil
    }

    /// JS sends epoch milliseconds; convert to a `Date`. Falls back to now.
    private func dateFromMillis(_ millis: Double?) -> Date {
        guard let millis, millis > 0 else { return Date() }
        return Date(timeIntervalSince1970: millis / 1000.0)
    }
}
