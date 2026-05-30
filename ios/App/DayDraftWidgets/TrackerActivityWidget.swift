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
                .activityBackgroundTint(Color(hex: ctx.attributes.colorHex).opacity(0.35))
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

                // Center: "Tracking" label so expanded island isn't lopsided
                DynamicIslandExpandedRegion(.center) {
                    Text("Tracking")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(DD.faint)
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
                            CircularButton(icon: "stop.fill", color: DD.red, size: 46)
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
                // SF Symbol so the minimal island is recognisable, not just a dot
                Image(systemName: "timer")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(accent)
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
        HStack(alignment: .center, spacing: 16) {
            // Left side: Large timer + metadata
            VStack(alignment: .leading, spacing: 4) {
                Text(ctx.state.startedAt, style: .timer)
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(DD.white)
                
                HStack(spacing: 6) {
                    SessionDot(color: accent, size: 6)
                    Text(ctx.attributes.categoryName)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(accent)
                        .lineLimit(1)
                }
                
                if ctx.attributes.hourlyRate > 0 {
                    HStack(spacing: 8) {
                        Text("BILLABLE")
                            .font(.system(size: 10, weight: .black, design: .rounded))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(DD.green)
                            .foregroundStyle(.black)
                            .clipShape(Capsule())
                        
                        Text(ddRate(ctx.attributes.hourlyRate, ctx.attributes.currencyCode))
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(DD.green)
                    }
                    .padding(.top, 2)
                } else {
                    Text("Started at \(ctx.state.startedAt, style: .time)")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(DD.dim)
                        .padding(.top, 2)
                }
            }
            
            Spacer()
            
            // Right side: Circular Stop Button
            Link(destination: stopURL) {
                CircularButton(icon: "stop.fill", color: DD.red, size: 56)
            }
        }
        .padding(20)
    }
}
