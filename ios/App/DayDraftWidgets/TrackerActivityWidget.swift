//
//  TrackerActivityWidget.swift
//  DayDraftWidgets
//
//  Live Activity for a running time-tracker session — dashboard redesign.
//
//  The session is open-ended (counts up), so the layout borrows from a fitness
//  dashboard: a 3-up metrics grid (STARTED · ELAPSED hero · RATE) over a live
//  equalizer that signals an active recording, then a Stop action. The
//  category's colour drives the hero timer, the waveform, the keyline and glow.
//
//  Collapsed Dynamic Island is intentionally MINIMAL — a pulsing accent dot +
//  a compact count-up — so the pill hugs the camera instead of spanning wide.
//
//  ⚠️ LIVE TIMER RULE — the count-up must keep ticking on its own:
//    • Use Text(_, style: .timer) with NOTHING that snapshots it.
//    • NO .contentTransition(.numericText()) on a timer (freezes it).
//    • NO gradient .foregroundStyle on a timer (can freeze it) — use a SOLID
//      colour with a soft glow instead. Gradients are fine everywhere else.
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
            let hasRate = ctx.attributes.hourlyRate > 0

            return DynamicIsland {
                // ── Leading: identity (disc + label + category) ──────────────
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 9) {
                        ZStack {
                            Circle()
                                .fill(accent.accentGradient())
                                .frame(width: 30, height: 30)
                                .shadow(color: accent.opacity(0.55), radius: 6, y: 2)
                            Circle()
                                .strokeBorder(Color.white.opacity(0.22), lineWidth: 0.8)
                                .frame(width: 30, height: 30)
                            LiveWave(tint: .white, size: 14)
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text("TRACKING")
                                .font(.system(size: 11, weight: .heavy, design: .rounded))
                                .tracking(1.4)
                                .foregroundStyle(accent.accentGradient())
                            Text(ctx.attributes.categoryName)
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(DD.dim)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                    }
                    .padding(.leading, 4)
                    .padding(.top, 4)
                }

                // ── Trailing: a live, pulsing "REC" marker ───────────────────
                DynamicIslandExpandedRegion(.trailing) {
                    RecBadge()
                        .padding(.trailing, 6)
                        .padding(.top, 4)
                }

                // ── Bottom: metrics grid + equalizer + Stop ──────────────────
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 9) {
                        HStack(alignment: .top, spacing: 10) {
                            StatColumn(label: "Started", hAlign: .leading) {
                                Text(ctx.state.startedAt, style: .time)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                    .foregroundStyle(DD.white)
                                    .lineLimit(1)
                            }
                            HeroTimerBox(start: ctx.state.startedAt, tint: accent, fontSize: 26)
                                .frame(maxWidth: 150)
                            StatColumn(label: hasRate ? "Rate" : "Session", hAlign: .trailing) {
                                if hasRate {
                                    Text(ddRate(ctx.attributes.hourlyRate, ctx.attributes.currencyCode))
                                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                                        .foregroundStyle(DD.green)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.7)
                                } else {
                                    Text("Live")
                                        .font(.system(size: 14, weight: .bold, design: .rounded))
                                        .foregroundStyle(DD.dim)
                                }
                            }
                        }

                        HStack(spacing: 10) {
                            EqualizerBar(tint: accent, height: 26)
                            Link(destination: stopURL) {
                                GlassActionButton(title: "Stop", icon: "stop.fill", tint: DD.red)
                            }
                            .fixedSize()
                        }
                    }
                    .padding(.top, 6)
                    .padding(.bottom, 2)
                }
            } compactLeading: {
                // Minimal: a single pulsing accent dot keeps the pill tight.
                Image(systemName: "circle.fill")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(accent)
                    .symbolEffect(.pulse, options: .repeating)
                    .padding(.leading, 3)

            } compactTrailing: {
                Text(ctx.state.startedAt, style: .timer)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(accent)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.trailing, 3)

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

// MARK: - Live "REC" badge

private struct RecBadge: View {
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "record.circle")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(DD.red)
                .symbolEffect(.pulse, options: .repeating)
            Text("REC")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .tracking(1.0)
                .foregroundStyle(DD.red.opacity(0.95))
        }
    }
}

// MARK: - Lock Screen card

private struct TrackerLockScreen: View {
    let ctx: ActivityViewContext<TrackerActivityAttributes>
    private var accent: Color { Color(hex: ctx.attributes.colorHex) }
    private var hasRate: Bool { ctx.attributes.hourlyRate > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            // Row 1 — identity + live REC marker
            HStack(alignment: .center, spacing: 11) {
                ZStack {
                    Circle()
                        .fill(accent.accentGradient())
                        .frame(width: 40, height: 40)
                        .shadow(color: accent.opacity(0.55), radius: 7, y: 2)
                    Circle()
                        .strokeBorder(Color.white.opacity(0.25), lineWidth: 0.8)
                        .frame(width: 40, height: 40)
                    LiveWave(tint: .white, size: 18)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("TRACKING")
                        .font(.system(size: 10, weight: .heavy, design: .rounded))
                        .tracking(1.6)
                        .foregroundStyle(accent.accentGradient())
                    Text(ctx.attributes.categoryName)
                        .font(.system(size: 17, weight: .semibold, design: .rounded))
                        .foregroundStyle(DD.white)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }

                Spacer(minLength: 6)

                RecBadge()
            }

            // Row 2 — metrics grid (STARTED · ELAPSED hero · RATE)
            HStack(alignment: .center, spacing: 12) {
                StatColumn(label: "Started", hAlign: .leading) {
                    Text(ctx.state.startedAt, style: .time)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(DD.white)
                        .lineLimit(1)
                }

                HeroTimerBox(start: ctx.state.startedAt, tint: accent, fontSize: 30)
                    .frame(maxWidth: 170)

                StatColumn(label: hasRate ? "Billable" : "Session", hAlign: .trailing) {
                    if hasRate {
                        Text(ddRate(ctx.attributes.hourlyRate, ctx.attributes.currencyCode))
                            .font(.system(size: 14, weight: .heavy, design: .rounded))
                            .foregroundStyle(DD.green)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    } else {
                        Text("Live")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(DD.dim)
                    }
                }
            }

            // Row 3 — live equalizer (the "recording" animation)
            EqualizerBar(tint: accent, height: 30)

            // Row 4 — Stop
            Link(destination: stopURL) {
                HStack(spacing: 7) {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 16, weight: .bold))
                    Text("Stop & save")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Capsule().fill(DD.red.accentGradient()))
                .overlay(
                    Capsule().strokeBorder(
                        LinearGradient(colors: [.white.opacity(0.4), .white.opacity(0.06)],
                                       startPoint: .top, endPoint: .bottom),
                        lineWidth: 0.8)
                )
                .shadow(color: DD.red.opacity(0.45), radius: 9, y: 3)
            }
        }
        .padding(16)
        .background(GlowField(tint: accent))
    }
}
