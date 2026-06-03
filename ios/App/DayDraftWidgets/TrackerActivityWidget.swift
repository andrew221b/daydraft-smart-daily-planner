//
//  TrackerActivityWidget.swift
//  DayDraftWidgets
//
//  Live Activity for a running time-tracker session.
//  Lock Screen and Dynamic Island expanded share ONE card (TrackerCard) so the
//  two presentations are visually identical and both fit their height budgets.
//

import ActivityKit
import WidgetKit
import SwiftUI

private let stopURL = URL(string: "daydraft://trackerstop")!

struct TrackerLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrackerActivityAttributes.self) { ctx in
            TrackerLockScreen(ctx: ctx)
                .activityBackgroundTint(Color.black.opacity(0.92))
                .activitySystemActionForegroundColor(DD.white)
        } dynamicIsland: { ctx in
            let accent = Color(hex: ctx.attributes.colorHex)

            return DynamicIsland {
                // Whole card lives in the bottom region (below the notch) so it
                // reads as one cohesive vertical card — same as the Lock Screen.
                DynamicIslandExpandedRegion(.bottom) {
                    TrackerCard(
                        categoryName: ctx.attributes.categoryName,
                        accent: accent,
                        start: ctx.state.startedAt,
                        hasRate: ctx.attributes.hourlyRate > 0,
                        rate: ctx.attributes.hourlyRate,
                        currency: ctx.attributes.currencyCode
                    )
                    .padding(.horizontal, 14)
                    .padding(.top, 2)
                    .padding(.bottom, 6)
                }
            } compactLeading: {
                Image(systemName: "record.circle")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DD.red)
                    .symbolEffect(.pulse, options: .repeating)
                    .padding(.leading, 6)
            } compactTrailing: {
                Text(ctx.state.startedAt, style: .timer)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(accent)
                    .frame(maxWidth: 40, alignment: .trailing)
                    .padding(.trailing, 6)
            } minimal: {
                Image(systemName: "circle.fill")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(accent)
                    .symbolEffect(.pulse, options: .repeating)
            }
            .widgetURL(ddURL("tracker"))
            .keylineTint(accent)
        }
    }
}

// MARK: - Shared card (Lock Screen + Dynamic Island expanded)

private struct TrackerCard: View {
    let categoryName: String
    let accent: Color
    let start: Date
    let hasRate: Bool
    let rate: Double
    let currency: String

    var body: some View {
        LiveActivityCard(
            title: categoryName,
            titleTint: accent,
            start: start,
            timerTint: accent,
            heroFont: 32
        ) {
            if hasRate {
                Text("BILLABLE: \(ddRate(rate, currency))")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(DD.green)
            } else {
                Text("STARTED AT \(start, style: .time)")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(DD.faint)
            }
        } action: {
            Link(destination: stopURL) {
                LiveActionLabel(title: "Stop & Save", icon: "stop.fill", fill: DD.red)
            }
        }
    }
}

// MARK: - Lock Screen card

private struct TrackerLockScreen: View {
    let ctx: ActivityViewContext<TrackerActivityAttributes>
    private var accent: Color { Color(hex: ctx.attributes.colorHex) }

    var body: some View {
        TrackerCard(
            categoryName: ctx.attributes.categoryName,
            accent: accent,
            start: ctx.state.startedAt,
            hasRate: ctx.attributes.hourlyRate > 0,
            rate: ctx.attributes.hourlyRate,
            currency: ctx.attributes.currencyCode
        )
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(GlowField(tint: accent))
    }
}
