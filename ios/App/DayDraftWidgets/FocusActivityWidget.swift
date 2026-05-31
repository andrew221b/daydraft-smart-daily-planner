//
//  FocusActivityWidget.swift
//  DayDraftWidgets
//
//  Live Activity for an active Focus session — flight-tracker redesign.
//
//  A Focus block has a known start AND a planned end, so the layout reads like
//  a journey: STARTED time ──● self-filling progress ●── ENDS time, with a live
//  "until done" countdown anchored in the centre. The brand blue→indigo accent
//  drives the hero timer, the bar and the glow.
//
//  Open sessions (no planned duration) fall back to an elapsed-led layout.
//
//  Collapsed Dynamic Island is MINIMAL — a pulsing scope + a compact countdown
//  — so the pill hugs the camera rather than stretching across the top.
//
//  ⚠️ Live-timer rule: keep Text(_, style:.timer) / Text(timerInterval:) free of
//  contentTransition and gradient foregroundStyle, or the clock freezes.
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
                // ── Leading: pulsing badge + gradient "FOCUS" label ──────────
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        PulseBadge(systemName: "scope", tint: DD.blue, diameter: 30, symbolSize: 14)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("FOCUS")
                                .font(.system(size: 11, weight: .heavy, design: .rounded))
                                .tracking(1.4)
                                .foregroundStyle(DD.brandGradient)
                            Text(ctx.attributes.taskTitle)
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .foregroundStyle(DD.dim)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                    }
                    .padding(.leading, 4)
                    .padding(.top, 2)
                }

                // ── Trailing: live remaining countdown (or "open") ───────────
                DynamicIslandExpandedRegion(.trailing) {
                    if let end = plannedEnd {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(timerInterval: ctx.state.startedAt...end, countsDown: true)
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                                .monospacedDigit()
                                .multilineTextAlignment(.trailing)
                                .foregroundStyle(DD.white)
                                .frame(maxWidth: 64, alignment: .trailing)
                            Text("LEFT")
                                .font(.system(size: 9, weight: .heavy, design: .rounded))
                                .tracking(0.8)
                                .foregroundStyle(DD.faint)
                        }
                        .padding(.trailing, 4)
                        .padding(.top, 2)
                    }
                }

                // ── Bottom: journey grid + live bar + Done ───────────────────
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 9) {
                        if let end = plannedEnd {
                            HStack(alignment: .center, spacing: 10) {
                                JourneyEndpoint(time: ctx.state.startedAt, label: "Started", align: .leading)
                                HeroTimerBox(start: ctx.state.startedAt, tint: DD.blue, fontSize: 25)
                                    .frame(maxWidth: 150)
                                JourneyEndpoint(time: end, label: "Ends", align: .trailing)
                            }
                            HStack(spacing: 10) {
                                JourneyTrack(start: ctx.state.startedAt, end: end, tint: DD.blue)
                                if let url = ddFocusDoneURL(ctx.attributes.blockId) {
                                    Link(destination: url) {
                                        GlassActionButton(title: "Done", icon: "checkmark", tint: DD.blue)
                                    }
                                    .fixedSize()
                                }
                            }
                        } else {
                            HStack(alignment: .center, spacing: 12) {
                                Text(ctx.state.startedAt, style: .timer)
                                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundStyle(DD.blue)
                                    .shadow(color: DD.blue.opacity(0.45), radius: 9, y: 1)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.6)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if let url = ddFocusDoneURL(ctx.attributes.blockId) {
                                    Link(destination: url) {
                                        GlassActionButton(title: "Done", icon: "checkmark", tint: DD.blue)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.top, 6)
                    .padding(.bottom, 2)
                }
            } compactLeading: {
                Image(systemName: "scope")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(DD.blue)
                    .symbolEffect(.pulse, options: .repeating)
                    .padding(.leading, 3)

            } compactTrailing: {
                if let end = plannedEnd {
                    Text(timerInterval: ctx.state.startedAt...end, countsDown: true)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(DD.blue)
                        .frame(maxWidth: 52, alignment: .trailing)
                        .padding(.trailing, 3)
                } else {
                    Text(ctx.state.startedAt, style: .timer)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(DD.blue)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.trailing, 3)
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

// MARK: - Journey endpoint (time on top, small label below)

/// One side of the journey: the time prominent, a tiny caption beneath — the
/// flight-tracker origin/destination treatment.
private struct JourneyEndpoint: View {
    let time: Date
    let label: String
    var align: HorizontalAlignment = .leading

    var body: some View {
        VStack(alignment: align, spacing: 2) {
            Text(time, style: .time)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(DD.white)
                .lineLimit(1)
            Text(label.uppercased())
                .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                .tracking(0.9)
                .foregroundStyle(DD.faint)
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
        VStack(spacing: 13) {
            // Row 1 — identity + live elapsed
            HStack(alignment: .center, spacing: 11) {
                PulseBadge(systemName: "scope", tint: DD.blue, diameter: 38, symbolSize: 17)

                VStack(alignment: .leading, spacing: 2) {
                    Text("IN FOCUS")
                        .font(.system(size: 10, weight: .heavy, design: .rounded))
                        .tracking(1.6)
                        .foregroundStyle(DD.brandGradient)
                    Text(ctx.attributes.taskTitle)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .foregroundStyle(DD.white)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }

                Spacer(minLength: 6)

                Text(ctx.state.startedAt, style: .timer)
                    .font(.system(size: 26, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(DD.blue)
                    .shadow(color: DD.blue.opacity(0.4), radius: 7, y: 1)
                    .lineLimit(1)
                    .layoutPriority(1)
            }

            if let end = plannedEnd {
                // Row 2 — journey: STARTED ──● until done ●── ENDS
                VStack(spacing: 8) {
                    HStack(alignment: .top, spacing: 8) {
                        JourneyEndpoint(time: ctx.state.startedAt, label: "Started", align: .leading)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        VStack(spacing: 2) {
                            Text(timerInterval: ctx.state.startedAt...end, countsDown: true)
                                .font(.system(size: 14, weight: .heavy, design: .rounded))
                                .monospacedDigit()
                                .multilineTextAlignment(.center)
                                .foregroundStyle(DD.blue)
                                .frame(maxWidth: 86)
                            Text("UNTIL DONE")
                                .font(.system(size: 8.5, weight: .heavy, design: .rounded))
                                .tracking(0.9)
                                .foregroundStyle(DD.faint)
                        }
                        .frame(maxWidth: .infinity)

                        JourneyEndpoint(time: end, label: "Ends", align: .trailing)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }

                    JourneyTrack(start: ctx.state.startedAt, end: end, tint: DD.blue)
                }
            } else {
                // Open session — no planned end to chart a journey against.
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DD.faint)
                    Text("Started \(ctx.state.startedAt, style: .time)")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(DD.dim)
                    Spacer()
                    Text("Open session")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(DD.dim)
                }
            }

            // Row 3 — Done
            if let url = ddFocusDoneURL(ctx.attributes.blockId) {
                Link(destination: url) {
                    HStack(spacing: 7) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 15, weight: .bold))
                        Text("Mark done")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(
                        Capsule().fill(DD.brandGradient)
                    )
                    .overlay(
                        Capsule().strokeBorder(
                            LinearGradient(colors: [.white.opacity(0.4), .white.opacity(0.06)],
                                           startPoint: .top, endPoint: .bottom),
                            lineWidth: 0.8)
                    )
                    .shadow(color: DD.blue.opacity(0.45), radius: 9, y: 3)
                }
            }
        }
        .padding(16)
        .background(GlowField(tint: DD.blue))
    }
}
