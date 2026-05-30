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

                // Leading: glowing dot + "In Focus" caption
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 5) {
                        SessionDot(color: DD.blue, size: 7)
                        Text("In Focus")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(DD.dim)
                    }
                    .padding(.leading, 2)
                }

                // Trailing: planned duration — faint, non-critical
                DynamicIslandExpandedRegion(.trailing) {
                    let dur = ddDuration(ctx.attributes.plannedMinutes)
                    if !dur.isEmpty {
                        Text("of \(dur)")
                            .font(.system(size: 11, weight: .regular, design: .rounded))
                            .foregroundStyle(DD.faint)
                            .padding(.trailing, 2)
                    }
                }

                // Center: task title — most important piece of info
                DynamicIslandExpandedRegion(.center) {
                    Text(ctx.attributes.taskTitle)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(DD.white)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }

                // Bottom: large live timer + Done action
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .center) {
                        // Native live timer — counts up from startedAt automatically.
                        // No JS updates needed; the system renders each second.
                        Text(ctx.state.startedAt, style: .timer)
                            .font(.system(size: 38, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(DD.white)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        if let url = ddFocusDoneURL(ctx.attributes.blockId) {
                            Link(destination: url) {
                                PillButton(title: "Done", icon: "checkmark", color: DD.blue)
                            }
                        }
                    }
                    .padding(.top, 8)
                    .padding(.bottom, 4)
                }
            } compactLeading: {
                // Apple HIG: compact leading should be ~10-12pt max, identifiable at a glance
                SessionDot(color: DD.blue, size: 7)
                    .padding(.leading, 3)

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
        VStack(alignment: .leading, spacing: 10) {

            // Row 1: status + live timer
            HStack(alignment: .center) {
                HStack(spacing: 6) {
                    SessionDot(color: DD.blue, size: 6)
                    Text("IN FOCUS")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .tracking(1.3)
                        .foregroundStyle(DD.dim)
                }
                Spacer()
                Text(ctx.state.startedAt, style: .timer)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(DD.blue)
            }

            // Row 2: task title
            Text(ctx.attributes.taskTitle)
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .foregroundStyle(DD.white)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            // Row 3: action
            if let url = ddFocusDoneURL(ctx.attributes.blockId) {
                Link(destination: url) {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 13, weight: .bold))
                        Text("Mark done")
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                    }
                    .foregroundStyle(DD.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .fill(DD.blue)
                    )
                }
            }
        }
        .padding(16)
    }
}
