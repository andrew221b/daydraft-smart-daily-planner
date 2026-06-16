//
//  FocusActivityWidget.swift
//  DayDraftWidgets
//
//  Live Activity for an active Focus session.
//  Lock Screen and Dynamic Island expanded share ONE card (FocusCard).
//
//  Layout (inspired by Apple Fitness "active workout" cards):
//    Row 1 — task title LEFT  ·  category pill + elapsed count-up RIGHT
//    Row 2 — journey track (start → planned end, self-filling bar)
//    Row 3 — start time LEFT  ·  remaining countdown RIGHT
//    Row 4 — Mark Done button (full width)
//  The category pill rides inline on Row 1 (not its own centered line) so the
//  card stays short enough that Mark Done never clips in the Live Activity.
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
                    .padding(.top, 2)
                    .padding(.bottom, 4)
                }
            } compactLeading: {
                let overrun = ctx.state.isOverrun || (plannedEnd.map { Date() >= $0 } ?? false)
                Image(systemName: overrun ? "exclamationmark.circle.fill" : "scope")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(overrun ? DD.red : DD.blue)
                    .symbolEffect(.pulse, options: .repeating)
                    .padding(.leading, 6)
            } compactTrailing: {
                let overrun = ctx.state.isOverrun || (plannedEnd.map { Date() >= $0 } ?? false)
                let tint = overrun ? DD.red : DD.blue
                if let end = plannedEnd, !overrun {
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
                let overrun = ctx.state.isOverrun || (plannedEnd.map { Date() >= $0 } ?? false)
                Image(systemName: overrun ? "exclamationmark.circle.fill" : "scope")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(overrun ? DD.red : DD.blue)
                    .symbolEffect(.pulse, options: .repeating)
            }
            .widgetURL(ddFocusURL(ctx.attributes.blockId))
            .keylineTint(ctx.state.isOverrun || (plannedEnd.map { Date() >= $0 } ?? false) ? DD.red : DD.blue)
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

    private var effectiveOverrun: Bool {
        isOverrun || (plannedEnd.map { Date() >= $0 } ?? false)
    }

    var body: some View {
        let tint = effectiveOverrun ? DD.red : DD.blue

        VStack(alignment: .leading, spacing: 5) {

            // ── Row 1: task name LEFT · category pill + count-up RIGHT ──────
            // The category pill rides inline on the right (next to the timer)
            // instead of taking its own centered line. That reclaims a full row
            // of height so the Mark Done button never clips in the Live Activity.
            HStack(alignment: .center, spacing: 8) {
                Text(taskTitle)
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .tracking(0.2)
                    .foregroundStyle(tint)
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)

                Spacer(minLength: 6)

                if let catName = categoryName {
                    CategoryPill(name: catName, colorHex: categoryColorHex, expand: false)
                }

                Text(start, style: .timer)
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(tint)
                    .shadow(color: tint.opacity(0.4), radius: 6, y: 1)
                    .lineLimit(1)
                    .layoutPriority(1)
            }

            // ── Rows 2-3: journey track + endpoint times (pill moved to Row 1) ─
            if let end = plannedEnd {
                VStack(spacing: 4) {
                    JourneyTrack(start: start, end: end, tint: tint)
                    HStack {
                        Text(start, style: .time)       // left: started at
                        Spacer()
                        Text(timerInterval: start...end, countsDown: true)  // right: remaining
                            .monospacedDigit()
                    }
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(DD.faint)
                }
                .padding(.horizontal, 2)
            } else {
                HStack {
                    Text("STARTED AT")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .tracking(0.8)
                        .foregroundStyle(DD.faint)
                    Spacer()
                    Text(start, style: .time)
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(DD.dim)
                }
            }

            // ── Row 4: Mark Done button ──────────────────────────────────────
            if let url = ddFocusDoneURL(blockId) {
                Link(destination: url) {
                    LiveActionLabel(title: "Mark Done", icon: "checkmark.circle.fill", fill: DD.brandGradient)
                }
            }
        }
        .frame(maxWidth: .infinity)
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
