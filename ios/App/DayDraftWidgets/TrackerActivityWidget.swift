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
                // Radically redesigned for maximum visual impact and UX.
                // We use leading/trailing for top-level context, and bottom for the main controls.

                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        if #available(iOS 17.0, *) {
                            Image(systemName: "waveform")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(accent)
                                .symbolEffect(.variableColor.iterative.dimInactiveLayers.nonReversing)
                        } else {
                            SessionDot(color: accent, size: 8)
                        }
                        Text("TRACKING")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .foregroundStyle(accent)
                            .tracking(1.2)
                    }
                    .padding(.leading, 4)
                    .padding(.top, 4)
                }

                DynamicIslandExpandedRegion(.trailing) {
                    HStack(spacing: 6) {
                        if ctx.attributes.hourlyRate > 0 {
                            Text(ddRate(ctx.attributes.hourlyRate, ctx.attributes.currencyCode))
                                .font(.system(size: 13, weight: .heavy, design: .rounded))
                                .foregroundStyle(DD.green)
                        } else {
                            Image(systemName: "clock")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(DD.dim)
                        }
                    }
                    .padding(.trailing, 4)
                    .padding(.top, 4)
                }

                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ctx.state.startedAt, style: .timer)
                                .font(.system(size: 32, weight: .heavy, design: .rounded))
                                .monospacedDigit()
                                .foregroundStyle(DD.white)
                                .contentTransition(.numericText())
                            
                            Text(ctx.attributes.categoryName)
                                .font(.system(size: 14, weight: .semibold, design: .rounded))
                                .foregroundStyle(DD.dim)
                                .lineLimit(1)
                        }
                        
                        Spacer()
                        
                        Link(destination: stopURL) {
                            HStack(spacing: 6) {
                                Image(systemName: "stop.fill")
                                    .font(.system(size: 14, weight: .bold))
                                Text("Stop")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .background(DD.red.opacity(0.15))
                            .foregroundStyle(DD.red)
                            .clipShape(Capsule())
                            .overlay(
                                Capsule().stroke(DD.red.opacity(0.3), lineWidth: 1)
                            )
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
                    .padding(.top, 12)
                }
            } compactLeading: {
                SessionDot(color: accent, size: 8)
                    .padding(.leading, 4)
            } compactTrailing: {
                Text(ctx.state.startedAt, style: .timer)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(accent)
                    .frame(maxWidth: 60, alignment: .trailing)
                    .padding(.trailing, 4)
            } minimal: {
                // SF Symbol so the minimal island is recognisable, not just a dot
                Image(systemName: "timer")
                    .font(.system(size: 12, weight: .bold))
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
