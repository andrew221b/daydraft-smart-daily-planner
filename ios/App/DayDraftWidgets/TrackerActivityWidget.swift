//
//  TrackerActivityWidget.swift
//  DayDraftWidgets
//
//  Live Activity for a running time-tracker session.
//  Lock Screen and Dynamic Island expanded share ONE card (TrackerCard).
//
//  Layout (mirrors FocusCard — same visual language):
//    Row 1 — category name LEFT  ·  elapsed count-up RIGHT (large, accent)
//    Row 2 — two stat columns: STARTED  ·  RATE (when rate set)
//             or single "STARTED AT hh:mm" when no rate
//    Row 3 — Stop & Save button (full width)
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
                    .padding(.bottom, 4)
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
        VStack(alignment: .leading, spacing: 4) {

            // ── Row 1: category LEFT · live count-up RIGHT ───────────────────
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(categoryName.uppercased())
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .tracking(0.7)
                    .foregroundStyle(accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)

                Spacer(minLength: 4)

                Text(start, style: .timer)
                    .font(.system(size: 28, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(accent)
                    .shadow(color: accent.opacity(0.4), radius: 6, y: 1)
                    .lineLimit(1)
            }

            // ── Row 2: ONE compact line — STARTED time (left) + RATE (right) ──
            // Single line in both states so adding a billing rate never grows
            // the card past the Live Activity height budget (which clipped it).
            HStack(spacing: 6) {
                Text("STARTED")
                    .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                    .tracking(0.7)
                    .foregroundStyle(DD.faint)
                Text(start, style: .time)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(DD.dim)
                Spacer(minLength: 8)
                if hasRate {
                    Text("RATE")
                        .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                        .tracking(0.7)
                        .foregroundStyle(DD.faint)
                    Text(ddRate(rate, currency))
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(DD.green)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }

            // ── Row 3: Stop & Save button ────────────────────────────────────
            Link(destination: stopURL) {
                LiveActionLabel(title: "Stop & Save", icon: "stop.fill", fill: DD.red)
            }
        }
        .frame(maxWidth: .infinity)
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
