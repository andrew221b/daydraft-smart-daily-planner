//
//  WidgetTheme.swift
//  DayDraftWidgets
//
//  Premium design system for the Focus + Tracker Live Activities.
//
//  What's allowed to "animate" inside a Live Activity (no @State, no explicit
//  SwiftUI animations — they're static snapshots) and is used heavily here:
//    • Text(_, style: .timer) / Text(timerInterval:)  → live count-up / countdown
//    • ProgressView(timerInterval:)                    → a bar that fills on its
//                                                         own over the session
//    • Image(systemName:).symbolEffect(...)            → continuous SF-Symbol
//                                                         motion (pulse / variable
//                                                         colour) with zero pushes
//  Everything else is rich-but-static: gradients, glows, materials, gradient
//  strokes, layered shadows.
//
//  ⚠️ Live-timer pitfall (this bit us once — the count-up froze at 0:00):
//  a Text(_, style: .timer) / Text(timerInterval:) ONLY keeps ticking if it is
//  left alone. Do NOT add .contentTransition(.numericText()) and do NOT give it
//  a gradient .foregroundStyle — both snapshot the glyphs and freeze the clock.
//  Use a SOLID colour + .shadow for the timer; put gradients on the eyebrow,
//  badge or button beside it instead.
//

import SwiftUI
import WidgetKit
import UIKit

// MARK: - Palette

enum DD {
    /// Apple Blue — the app's `--primary`.
    static let blue   = Color(red: 0.04, green: 0.52, blue: 1.00)
    /// Apple Indigo — the app's `--primary-glow`; the second stop of the brand gradient.
    static let indigo = Color(red: 0.35, green: 0.34, blue: 0.84)
    /// Money-green for earnings.
    static let green  = Color(red: 0.18, green: 0.86, blue: 0.46)
    /// Destructive red for Stop.
    static let red    = Color(red: 1.00, green: 0.32, blue: 0.27)

    static let white  = Color.white
    static let dim    = Color.white.opacity(0.62)
    static let faint  = Color.white.opacity(0.40)

    /// Two-stop brand gradient (blue → indigo), 132° like the web `--gradient-primary`.
    static let brandGradient = LinearGradient(
        colors: [blue, indigo],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
}

// MARK: - Color helpers

extension Color {
    /// Accepts "#rrggbb" or "rrggbb". Falls back to DD.blue.
    init(hex raw: String) {
        let s = raw.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var v: UInt64 = 0
        guard s.count == 6, Scanner(string: s).scanHexInt64(&v) else { self = DD.blue; return }
        self = Color(
            red:   Double((v >> 16) & 0xFF) / 255,
            green: Double((v >>  8) & 0xFF) / 255,
            blue:  Double( v        & 0xFF) / 255
        )
    }

    /// A brighter sibling of this colour — the light stop of an accent gradient.
    func lighter(_ amount: CGFloat = 0.20) -> Color {
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard UIColor(self).getHue(&h, saturation: &s, brightness: &b, alpha: &a) else { return self }
        return Color(hue: Double(h),
                     saturation: Double(max(0, s - amount * 0.4)),
                     brightness: Double(min(1, b + amount)))
    }

    /// A vivid top-left → rich bottom-right gradient built from any accent.
    func accentGradient() -> LinearGradient {
        LinearGradient(colors: [lighter(0.16), self],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Ambient glow background (Lock Screen / Notification card)

/// Layered blurred blobs + a dark vertical wash. Gives the card real depth on
/// the Lock Screen instead of a flat fill. Purely decorative, fully static.
struct GlowField: View {
    var tint: Color
    var secondary: Color = DD.indigo

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.white.opacity(0.06), Color.clear],
                startPoint: .top, endPoint: .bottom
            )
            Circle()
                .fill(tint.opacity(0.30))
                .frame(width: 150, height: 150)
                .blur(radius: 55)
                .offset(x: -95, y: -46)
            Circle()
                .fill(secondary.opacity(0.26))
                .frame(width: 140, height: 140)
                .blur(radius: 58)
                .offset(x: 115, y: 52)
        }
        .clipped()
    }
}

// MARK: - Live "pulse" badge — a glyph that breathes via symbolEffect

/// A small accent disc with an SF-Symbol that pulses continuously (no push).
struct PulseBadge: View {
    let systemName: String
    let tint: Color
    var diameter: CGFloat = 30
    var symbolSize: CGFloat = 14

    var body: some View {
        ZStack {
            Circle()
                .fill(tint.accentGradient())
                .shadow(color: tint.opacity(0.55), radius: 6, y: 2)
            Circle()
                .strokeBorder(Color.white.opacity(0.25), lineWidth: 0.8)
            Image(systemName: systemName)
                .font(.system(size: symbolSize, weight: .bold))
                .foregroundStyle(.white)
                .symbolEffect(.pulse, options: .repeating)
        }
        .frame(width: diameter, height: diameter)
    }
}

// MARK: - Category pill — a centered coloured chip (dot + small-caps name)

/// The tracked category, shown as a soft tinted capsule that hugs its content
/// and centers within the available width. Used as its own line under the hero
/// timer so the category reads as a distinct, centered element.
struct CategoryPill: View {
    let name: String
    var colorHex: String? = nil

    var body: some View {
        let c = Color(hex: colorHex ?? "0A84FF")
        HStack(spacing: 5) {
            Circle()
                .fill(c)
                .frame(width: 5, height: 5)
                .shadow(color: c.opacity(0.7), radius: 2)
            Text(name.uppercased())
                .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                .tracking(0.9)
                .foregroundStyle(DD.dim)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 3)
        .background(Capsule().fill(c.opacity(0.12)))
        .overlay(Capsule().strokeBorder(c.opacity(0.22), lineWidth: 0.7))
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Live recording wave — accent waveform that animates its colours

struct LiveWave: View {
    let tint: Color
    var size: CGFloat = 15

    var body: some View {
        Image(systemName: "waveform")
            .font(.system(size: size, weight: .bold))
            .foregroundStyle(tint)
            .symbolEffect(.variableColor.iterative.dimInactiveLayers.nonReversing, options: .repeating)
    }
}

// MARK: - Glass action button (Done / Stop)

/// A gradient capsule with an inner highlight, hairline stroke and coloured
/// glow. Wrap in a `Link` at the call site.
struct GlassActionButton: View {
    let title: String
    let icon: String
    let tint: Color

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .bold))
            Text(title)
                .font(.system(size: 14, weight: .bold, design: .rounded))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .background(
            Capsule().fill(tint.accentGradient())
        )
        .overlay(
            Capsule()
                .strokeBorder(
                    LinearGradient(colors: [.white.opacity(0.45), .white.opacity(0.08)],
                                   startPoint: .top, endPoint: .bottom),
                    lineWidth: 0.8
                )
        )
        .shadow(color: tint.opacity(0.5), radius: 7, y: 3)
    }
}

// MARK: - Live progress bar (fills over the session by itself)

/// A `ProgressView(timerInterval:)` that advances on its own from `start` to
/// `end` — no pushes. Tinted to the session accent with a soft glow. Used when
/// a session has a known planned end.
struct LiveProgressBar: View {
    let start: Date
    let end: Date
    let tint: Color
    var height: CGFloat = 6

    var body: some View {
        ProgressView(timerInterval: start...end, countsDown: false) {
            EmptyView()
        } currentValueLabel: {
            EmptyView()
        }
        .progressViewStyle(.linear)
        .tint(tint)
        .frame(height: height)
        .shadow(color: tint.opacity(0.4), radius: 3, y: 1)
    }
}

// MARK: - Stat column (label on top, value below) — the "metrics grid" unit

/// One labelled metric, fitness-dashboard style: a small uppercase label sits
/// above its value. Pass any view (a string Text, a live timer, a chip) as the
/// value. Stretches to share width equally inside an HStack.
struct StatColumn<V: View>: View {
    let label: String
    var hAlign: HorizontalAlignment = .leading
    @ViewBuilder var value: () -> V

    private var frameAlign: Alignment {
        switch hAlign {
        case .trailing: return .trailing
        case .center:   return .center
        default:        return .leading
        }
    }

    var body: some View {
        VStack(alignment: hAlign, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                .tracking(0.9)
                .foregroundStyle(DD.faint)
                .lineLimit(1)
            value()
        }
        .frame(maxWidth: .infinity, alignment: frameAlign)
    }
}

// MARK: - Hero timer box — the boxed, tinted centre value (live count-up)

/// The emphasised centre metric — a live count-up inside a soft tinted card,
/// mirroring the boxed hero value in a workout dashboard.
struct HeroTimerBox: View {
    let start: Date
    let tint: Color
    var fontSize: CGFloat = 30

    var body: some View {
        Text(start, style: .timer)
            .font(.system(size: fontSize, weight: .heavy, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(tint)
            .shadow(color: tint.opacity(0.4), radius: 8, y: 1)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .padding(.horizontal, 6)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(tint.opacity(0.13))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(tint.opacity(0.28), lineWidth: 0.8)
            )
    }
}

// MARK: - Full-width action label (Stop / Mark Done) — wrap in a Link at call site

/// A full-width, filled button label with a rounded rectangle background.
/// Generic over the fill so it accepts a solid `Color` (Stop) or the brand
/// `LinearGradient` (Done). Tuned compact so the whole card fits the Dynamic
/// Island expanded height budget.
struct LiveActionLabel<S: ShapeStyle>: View {
    let title: String
    let icon: String
    let fill: S

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
            Text(title)
                .font(.system(size: 15, weight: .bold, design: .rounded))
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous).fill(fill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 0.7)
        )
    }
}

// MARK: - Shared Live Activity card — identical body for Lock Screen + Island

/// The single vertical card used by BOTH the Lock Screen and the Dynamic Island
/// expanded `.bottom` region. Layout: a centered hero (small-caps eyebrow title
/// sitting tight above the big live timer), then the info slot, then the
/// full-width action button. The timer is the visual centerpiece — centered
/// horizontally with the title as its eyebrow. The eyebrow is tight to the timer
/// (1pt) so the pair reads as one unit and the card still fits the Dynamic Island
/// expanded height budget.
struct LiveActivityCard<Info: View, Action: View>: View {
    let title: String
    let titleTint: Color
    let start: Date
    let timerTint: Color
    var heroFont: CGFloat = 30
    var spacing: CGFloat = 8
    @ViewBuilder var info: () -> Info
    @ViewBuilder var action: () -> Action

    var body: some View {
        VStack(alignment: .center, spacing: spacing) {
            // Centered hero — eyebrow title sitting tight above the big live timer.
            VStack(alignment: .center, spacing: 1) {
                Text(title.uppercased())
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .foregroundStyle(titleTint)
                    .tracking(1.0)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity, alignment: .center)

                Text(start, style: .timer)
                    .font(.system(size: heroFont, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(timerTint)
                    .shadow(color: timerTint.opacity(0.4), radius: 6, y: 1)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .frame(maxWidth: .infinity)

            info()

            action()
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Equalizer bar — a wide animated "recording" waveform on a faint track

/// A full-width animated waveform sitting on a faint rounded track. Conveys an
/// active recording session and self-animates via symbolEffect (no pushes).
struct EqualizerBar: View {
    let tint: Color
    var height: CGFloat = 30

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(tint.opacity(0.07))
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(tint.opacity(0.14), lineWidth: 0.7)
            Image(systemName: "waveform")
                .font(.system(size: height * 0.66, weight: .semibold))
                .foregroundStyle(tint.opacity(0.92))
                .symbolEffect(.variableColor.iterative.dimInactiveLayers.nonReversing, options: .repeating)
                .frame(maxWidth: .infinity)
        }
        .frame(height: height)
        .clipped()
    }
}

// MARK: - Pulse Track — sleek indeterminate progress

/// An indeterminate sleek track replacing the equalizer. Gives the illusion of
/// a progress bar with a pulsing head, suitable for open-ended tracking.
struct PulseTrack: View {
    let tint: Color
    
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "circle.fill")
                .font(.system(size: 8))
                .foregroundStyle(tint)
                .symbolEffect(.pulse, options: .repeating)
                .shadow(color: tint.opacity(0.8), radius: 4)
            
            Capsule()
                .fill(
                    LinearGradient(colors: [tint.opacity(0.6), tint.opacity(0.05)], startPoint: .leading, endPoint: .trailing)
                )
                .frame(height: 5)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Journey track — origin dot → self-filling bar → destination dot

/// A "flight tracker" style progress line: a solid origin dot, the self-filling
/// LiveProgressBar between, and a hollow destination dot. The fill is the live
/// position marker travelling from start to end.
struct JourneyTrack: View {
    let start: Date
    let end: Date
    let tint: Color

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(tint)
                .frame(width: 7, height: 7)
                .shadow(color: tint.opacity(0.6), radius: 3)
            LiveProgressBar(start: start, end: end, tint: tint, height: 6)
            Circle()
                .strokeBorder(tint.opacity(0.55), lineWidth: 1.6)
                .frame(width: 7, height: 7)
        }
    }
}

// MARK: - Duration / rate formatting

/// "45m", "1h", "1h 30m"
func ddDuration(_ minutes: Int) -> String {
    guard minutes > 0 else { return "" }
    let h = minutes / 60, m = minutes % 60
    if h == 0 { return "\(m)m" }
    return m == 0 ? "\(h)h" : "\(h)h \(m)m"
}

/// "$42/h", "EUR 150/h" — matches the web's "/h" suffix. Whole rates drop the
/// decimals (min == max); fractional rates show exactly two ("$42.50/h").
func ddRate(_ rate: Double, _ code: String) -> String {
    let fmt = NumberFormatter()
    fmt.numberStyle = .currency
    fmt.currencyCode = code
    let whole = rate.truncatingRemainder(dividingBy: 1) == 0
    fmt.minimumFractionDigits = whole ? 0 : 2
    fmt.maximumFractionDigits = whole ? 0 : 2
    let a = fmt.string(from: NSNumber(value: rate)) ?? "\(code) \(Int(rate))"
    return "\(a)/h"
}

/// Planned end date for a Focus session, or nil when no duration was set.
func ddPlannedEnd(_ start: Date, _ minutes: Int) -> Date? {
    minutes > 0 ? start.addingTimeInterval(Double(minutes) * 60) : nil
}

// MARK: - Safe URL helpers

func ddURL(_ path: String) -> URL? { URL(string: "daydraft://\(path)") }

func ddFocusURL(_ blockId: String) -> URL? {
    ddURL("focus/\(blockId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? blockId)")
}

func ddFocusDoneURL(_ blockId: String) -> URL? {
    ddURL("focusdone/\(blockId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? blockId)")
}
