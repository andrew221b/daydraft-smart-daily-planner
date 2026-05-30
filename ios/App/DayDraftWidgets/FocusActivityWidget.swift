//
//  FocusActivityWidget.swift
//  DayDraftWidgets
//
//  Live Activity for an active Focus session.
//
//  Apple HIG compliance:
//  • Compact: only dot (leading) + live timer (trailing). No extra text.
//  • Minimal: SF Symbol timer icon — shown when island is shared.
//  • Expanded: leading = status label, center = task title, trailing = duration,
//              bottom = large timer + Done pill. Matches Apple proportions.
//  • Lock Screen: 3-row card — header row, task title, action button.
//  • widgetURL: tapping the compact island opens Focus for this block.
//  • Link for "Done": opens app and triggers completion via ?complete=1.
//  • activityBackgroundTint: subtle blue tint on the system material.
//  • No @State, no onAppear animations — snapshots only.
//

import ActivityKit
import WidgetKit
import SwiftUI

struct FocusLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { ctx in
            // ── Lock Screen / StandBy / Notification Banner ─────────────
            FocusLockScreen(ctx: ctx)
                .activityBackgroundTint(DD.blue.opacity(0.14))
                .activitySystemActionForegroundColor(DD.white)
        } dynamicIsland: { ctx in
            DynamicIsland {
                // ── Expanded Island ──────────────────────────────────────
                // Radically redesigned for maximum visual impact and minimal height.

                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            if #available(iOS 17.0, *) {
                                Image(systemName: "waveform")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(DD.blue)
                                    .symbolEffect(.variableColor.iterative.dimInactiveLayers.nonReversing)
                            } else {
                                SessionDot(color: DD.blue, size: 7)
                            }
                            Text("Focus")
                                .font(.system(size: 14, weight: .bold, design: .rounded))
                                .foregroundStyle(DD.white)
                        }
                        Text(ctx.attributes.taskTitle)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(DD.faint)
                            .lineLimit(1)
                    }
                    .padding(.leading, 6)
                    .padding(.top, 4)
                }

                DynamicIslandExpandedRegion(.trailing) {
                    HStack(spacing: 8) {
                        if let url = ddFocusDoneURL(ctx.attributes.blockId) {
                            Link(destination: url) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 24))
                                    .foregroundStyle(DD.blue)
                            }
                        }
                    }
                    .padding(.trailing, 2)
                    .padding(.top, 2)
                }

                DynamicIslandExpandedRegion(.center) {
                    Text(ctx.state.startedAt, style: .timer)
                        .font(.system(size: 24, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(DD.blue)
                }
            } compactLeading: {
                let end = ctx.state.startedAt.addingTimeInterval(Double(ctx.attributes.plannedMinutes * 60))
                if ctx.attributes.plannedMinutes > 0 {
                    ProgressView(timerInterval: ctx.state.startedAt...end, countsDown: true)
                        .progressViewStyle(.circular)
                        .tint(DD.blue)
                        .frame(width: 14, height: 14)
                        .padding(.leading, 3)
                } else {
                    SessionDot(color: DD.blue, size: 7).padding(.leading, 3)
                }

            } compactTrailing: {
                // Native timer — updates live without any JS push
                Text(ctx.state.startedAt, style: .timer)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(DD.blue)
                    .frame(maxWidth: 60, alignment: .trailing)
                    .padding(.trailing, 3)

            } minimal: {
                // Shared island (another Live Activity is also running)
                Image(systemName: "timer")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DD.blue)
            }
            .widgetURL(ddFocusURL(ctx.attributes.blockId))
            .keylineTint(DD.blue)
        }
    }
}

// MARK: - Lock Screen card

private struct FocusLockScreen: View {
    let ctx: ActivityViewContext<FocusActivityAttributes>

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            // Left side: Visual Ring
            let end = ctx.state.startedAt.addingTimeInterval(Double(ctx.attributes.plannedMinutes * 60))
            if ctx.attributes.plannedMinutes > 0 {
                ProgressView(timerInterval: ctx.state.startedAt...end, countsDown: true)
                    .progressViewStyle(.circular)
                    .tint(DD.blue)
                    .frame(width: 48, height: 48)
                    .scaleEffect(1.4)
            } else {
                ZStack {
                    Circle().strokeBorder(DD.blue.opacity(0.3), lineWidth: 4)
                    Image(systemName: "timer")
                        .foregroundStyle(DD.blue)
                        .font(.system(size: 20, weight: .bold))
                }
                .frame(width: 48, height: 48)
            }
            
            // Middle: Task details
            VStack(alignment: .leading, spacing: 4) {
                Text(ctx.attributes.taskTitle)
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(DD.white)
                    .lineLimit(2)
                
                HStack(spacing: 6) {
                    SessionDot(color: DD.blue, size: 6)
                    Text(ctx.state.startedAt, style: .timer)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(DD.dim)
                    
                    if ctx.attributes.plannedMinutes > 0 {
                        Text("•")
                            .foregroundStyle(DD.faint)
                        Image(systemName: "bell.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(DD.dim)
                        Text(end, style: .time)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(DD.dim)
                    }
                }
                
                if let nextTitle = ctx.attributes.nextTaskTitle, !nextTitle.isEmpty {
                    Text("Next: \(nextTitle)")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(DD.faint)
                        .lineLimit(1)
                        .padding(.top, 2)
                }
            }
            
            Spacer(minLength: 8)
            
            // Right side: Action
            if let url = ddFocusDoneURL(ctx.attributes.blockId) {
                Link(destination: url) {
                    CircularButton(icon: "checkmark", color: DD.blue, size: 52)
                }
            }
        }
        .padding(20)
    }
}
