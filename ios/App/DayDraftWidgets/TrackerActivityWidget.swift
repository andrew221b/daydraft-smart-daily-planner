//
//  TrackerActivityWidget.swift
//  DayDraftWidgets
//
//  Live Activity for a running time-tracker session.
//
//  Apple HIG compliance mirrors FocusActivityWidget. Key differences:
//  • Category colour (from hex) replaces fixed blue in dot + timer.
//  • Trailing shows the hourly rate when one is set (green, money-coded).
//  • Bottom action is "Stop" in red — destructive but clearly labelled.
//  • Lock Screen shows rate if set, plus Stop button.
//  • "daydraft://trackerstop" is a fixed URL — always safe to force-init.
//

import ActivityKit
import WidgetKit
import SwiftUI

// The stop URL is a fixed constant, always well-formed.
private let stopURL = URL(string: "daydraft://trackerstop")!

struct TrackerLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrackerActivityAttributes.self) { ctx in
            // ── Lock Screen / StandBy / Notification Banner ─────────────
            TrackerLockScreen(ctx: ctx)
                .activityBackgroundTint(Color(hex: ctx.attributes.colorHex).opacity(0.14))
                .activitySystemActionForegroundColor(DD.white)
        } dynamicIsland: { ctx in
            let accent = Color(hex: ctx.attributes.colorHex)

            return DynamicIsland {
                // ── Expanded Island ──────────────────────────────────────

                // Leading: dot + category name
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 5) {
                        SessionDot(color: accent, size: 7)
                        Text(ctx.attributes.categoryName)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundStyle(DD.white)
                            .lineLimit(1)
                    }
                    .padding(.leading, 2)
                }

                // Trailing: hourly rate — only shown when one is set
                DynamicIslandExpandedRegion(.trailing) {
                    if ctx.attributes.hourlyRate > 0 {
                        Text(ddRate(ctx.attributes.hourlyRate, ctx.attributes.currencyCode))
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(DD.green)
                            .padding(.trailing, 2)
                    }
                }

                // Bottom: large live timer + Stop button
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .center) {
                        Text(ctx.state.startedAt, style: .timer)
                            .font(.system(size: 38, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(DD.white)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Link(destination: stopURL) {
                            PillButton(title: "Stop", icon: "stop.fill", color: DD.red)
                        }
                    }
                    .padding(.top, 8)
                    .padding(.bottom, 4)
                }
            } compactLeading: {
                SessionDot(color: accent, size: 7)
                    .padding(.leading, 3)

            } compactTrailing: {
                Text(ctx.state.startedAt, style: .timer)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(accent)
                    .frame(maxWidth: 60, alignment: .trailing)
                    .padding(.trailing, 3)

            } minimal: {
                SessionDot(color: accent, size: 6)
            }
            .widgetURL(ddURL("tracker"))
            .keylineTint(accent)
        }
    }
}

// MARK: - Lock Screen card

private struct TrackerLockScreen: View {
    let ctx: ActivityViewContext<TrackerActivityAttributes>
    private var accent: Color { Color(hex: ctx.attributes.colorHex) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {

            // Row 1: category name + live timer
            HStack(alignment: .center) {
                HStack(spacing: 6) {
                    SessionDot(color: accent, size: 6)
                    Text(ctx.attributes.categoryName.uppercased())
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .tracking(1.2)
                        .foregroundStyle(DD.dim)
                        .lineLimit(1)
                }
                Spacer()
                Text(ctx.state.startedAt, style: .timer)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(accent)
            }

            // Row 2: rate (when set) — green, prominent
            if ctx.attributes.hourlyRate > 0 {
                Text(ddRate(ctx.attributes.hourlyRate, ctx.attributes.currencyCode))
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(DD.green)
            }

            // Row 3: action
            Link(destination: stopURL) {
                HStack(spacing: 6) {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 12, weight: .bold))
                    Text("Stop & save")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                }
                .foregroundStyle(DD.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .fill(DD.red)
                )
            }
        }
        .padding(16)
    }
}
