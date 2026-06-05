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
                        categoryColorHex: ctx.state.categoryColorHex,
                        isOverrun: ctx.state.isOverrun
                    )
                    .padding(.horizontal, 14)
                    .padding(.top, 0)
                    .padding(.bottom, 4)
                }
            } compactLeading: {
                let tint = ctx.state.isOverrun ? DD.red : DD.blue
                Image(systemName: ctx.state.isOverrun ? "exclamationmark.circle.fill" : "scope")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(tint)
                    .symbolEffect(.pulse, options: .repeating)
                    .padding(.leading, 6)
            } compactTrailing: {
                let tint = ctx.state.isOverrun ? DD.red : DD.blue
                if let end = plannedEnd, !ctx.state.isOverrun {
                    Text(timerInterval: ctx.state.startedAt...end, countsDown: true)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(tint)
                        .frame(maxWidth: 40, alignment: .trailing)
                        .padding(.trailing, 6)
                } else {
                    Text(ctx.state.startedAt, style: .timer)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(tint)
                        .frame(maxWidth: 40, alignment: .trailing)
                        .padding(.trailing, 6)
                }
            } minimal: {
                let tint = ctx.state.isOverrun ? DD.red : DD.blue
                Image(systemName: ctx.state.isOverrun ? "exclamationmark.circle.fill" : "scope")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(tint)
                    .symbolEffect(.pulse, options: .repeating)
            }
            .widgetURL(ddFocusURL(ctx.attributes.blockId))
            .keylineTint(ctx.state.isOverrun ? DD.red : DD.blue)
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
    var isOverrun: Bool = false

    var body: some View {
        // Tint flips blue → red the moment the planned duration is exceeded.
        let tint = isOverrun ? DD.red : DD.blue
        // Slightly smaller hero than Tracker: the journey track + endpoints row
        // add height, so trim the timer to keep the whole card within the
        // Dynamic Island expanded budget.
        LiveActivityCard(
            title: taskTitle,
            titleTint: tint,
            start: start,
            timerTint: tint,
            heroFont: 28,
            spacing: 6
        ) {
            if let end = plannedEnd {
                // Centered hierarchy: category pill (its own line, centered under
                // the hero timer) → progress track → start↔remaining endpoints.
                // Kept tight (small fonts, spacing 5) so the whole card + the
                // action button stay inside the Dynamic Island expanded budget.
                VStack(spacing: 5) {
                    if let catName = categoryName {
                        CategoryPill(name: catName, colorHex: categoryColorHex)
                    }
                    JourneyTrack(start: start, end: end, tint: tint)
                    HStack {
                        Text(start, style: .time)            // left: started
                        Spacer()
                        Text(timerInterval: start...end, countsDown: true)  // right: remaining
                            .monospacedDigit()
                    }
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(DD.faint)
                }
                .padding(.horizontal, 4)
            } else {
                VStack(spacing: 5) {
                    if let catName = categoryName {
                        CategoryPill(name: catName, colorHex: categoryColorHex)
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
        let isOverrun = ctx.state.isOverrun
        FocusCard(
            taskTitle: ctx.attributes.taskTitle,
            start: ctx.state.startedAt,
            plannedEnd: plannedEnd,
            blockId: ctx.attributes.blockId,
            categoryName: ctx.state.categoryName,
            categoryColorHex: ctx.state.categoryColorHex,
            isOverrun: isOverrun
        )
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(GlowField(tint: isOverrun ? DD.red : DD.blue))
    }
}
