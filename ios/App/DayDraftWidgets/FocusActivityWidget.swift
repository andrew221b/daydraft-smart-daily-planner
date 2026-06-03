//
//  FocusActivityWidget.swift
//  DayDraftWidgets
//
//  Live Activity for an active Focus session.
//  Lock Screen and Dynamic Island expanded share ONE card (FocusCard) so the
//  two presentations are visually identical and both fit their height budgets.
//

import ActivityKit
import WidgetKit
import SwiftUI

struct FocusLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { ctx in
            FocusLockScreen(ctx: ctx)
                .activityBackgroundTint(Color.black.opacity(0.92))
                .activitySystemActionForegroundColor(DD.white)
        } dynamicIsland: { ctx in
            let plannedEnd = ddPlannedEnd(ctx.state.startedAt, ctx.attributes.plannedMinutes)

            return DynamicIsland {
                // Whole card lives in the bottom region (below the notch) so it
                // reads as one cohesive vertical card — same as the Lock Screen.
                DynamicIslandExpandedRegion(.bottom) {
                    FocusCard(
                        taskTitle: ctx.attributes.taskTitle,
                        start: ctx.state.startedAt,
                        plannedEnd: plannedEnd,
                        blockId: ctx.attributes.blockId,
                        categoryName: ctx.state.categoryName,
                        categoryColorHex: ctx.state.categoryColorHex
                    )
                    .padding(.horizontal, 14)
                    .padding(.top, 2)
                    .padding(.bottom, 6)
                }
            } compactLeading: {
                Image(systemName: "scope")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DD.blue)
                    .symbolEffect(.pulse, options: .repeating)
                    .padding(.leading, 6)
            } compactTrailing: {
                if let end = plannedEnd {
                    Text(timerInterval: ctx.state.startedAt...end, countsDown: true)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(DD.blue)
                        .frame(maxWidth: 40, alignment: .trailing)
                        .padding(.trailing, 6)
                } else {
                    Text(ctx.state.startedAt, style: .timer)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(DD.blue)
                        .frame(maxWidth: 40, alignment: .trailing)
                        .padding(.trailing, 6)
                }
            } minimal: {
                Image(systemName: "scope")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(DD.blue)
                    .symbolEffect(.pulse, options: .repeating)
            }
            .widgetURL(ddFocusURL(ctx.attributes.blockId))
            .keylineTint(DD.blue)
        }
    }
}

// MARK: - Shared card (Lock Screen + Dynamic Island expanded)

private struct FocusCard: View {
    let taskTitle: String
    let start: Date
    let plannedEnd: Date?
    let blockId: String
    var categoryName: String? = nil
    var categoryColorHex: String? = nil

    var body: some View {
        // Slightly smaller hero than Tracker: the journey track + endpoints row
        // add height, so trim the timer to keep the whole card within the
        // Dynamic Island expanded budget.
        LiveActivityCard(
            title: taskTitle,
            titleTint: DD.blue,
            start: start,
            timerTint: DD.blue,
            heroFont: 30,
            spacing: 8
        ) {
            if let end = plannedEnd {
                VStack(spacing: 5) {
                    // Tracker category chip — only when actively tracking. Centered
                    // so it sits under the centered hero timer.
                    if let catName = categoryName {
                        HStack(spacing: 5) {
                            Circle()
                                .fill(Color(hex: categoryColorHex ?? "0A84FF"))
                                .frame(width: 5, height: 5)
                                .shadow(color: Color(hex: categoryColorHex ?? "0A84FF").opacity(0.7), radius: 2)
                            Text(catName.uppercased())
                                .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                                .tracking(0.9)
                                .foregroundStyle(DD.dim)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    JourneyTrack(start: start, end: end, tint: DD.blue)
                    HStack {
                        // Session start clock (left). The big hero timer above
                        // already shows live elapsed, so repeating elapsed here
                        // would just duplicate it — show the start time instead.
                        Text(start, style: .time)
                        Spacer()
                        // Countdown to planned end (right)
                        Text(timerInterval: start...end, countsDown: true)
                            .monospacedDigit()
                    }
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(DD.faint)
                }
                .padding(.horizontal, 4)
            } else {
                VStack(spacing: 5) {
                    if let catName = categoryName {
                        HStack(spacing: 5) {
                            Circle()
                                .fill(Color(hex: categoryColorHex ?? "0A84FF"))
                                .frame(width: 5, height: 5)
                                .shadow(color: Color(hex: categoryColorHex ?? "0A84FF").opacity(0.7), radius: 2)
                            Text(catName.uppercased())
                                .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                                .tracking(0.9)
                                .foregroundStyle(DD.dim)
                        }
                    }
                    Text("STARTED AT \(start, style: .time)")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(DD.faint)
                }
                .frame(maxWidth: .infinity)
            }
        } action: {
            if let url = ddFocusDoneURL(blockId) {
                Link(destination: url) {
                    LiveActionLabel(title: "Mark Done", icon: "checkmark.circle.fill", fill: DD.brandGradient)
                }
            }
        }
    }
}

// MARK: - Lock Screen card

private struct FocusLockScreen: View {
    let ctx: ActivityViewContext<FocusActivityAttributes>

    private var plannedEnd: Date? {
        ddPlannedEnd(ctx.state.startedAt, ctx.attributes.plannedMinutes)
    }

    var body: some View {
        FocusCard(
            taskTitle: ctx.attributes.taskTitle,
            start: ctx.state.startedAt,
            plannedEnd: plannedEnd,
            blockId: ctx.attributes.blockId,
            categoryName: ctx.state.categoryName,
            categoryColorHex: ctx.state.categoryColorHex
        )
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(GlowField(tint: DD.blue))
    }
}
