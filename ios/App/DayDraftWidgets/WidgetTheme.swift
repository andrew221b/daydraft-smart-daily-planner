//
//  WidgetTheme.swift
//  DayDraftWidgets
//
//  Design tokens and shared primitives for Live Activity views.
//
//  Apple HIG rules observed here:
//  • No @State / animations — Live Activities render as static snapshots.
//  • All interactive elements use Link (iOS 17+ supported in Live Activities).
//  • Colours match the app's --primary token (Apple Blue) and semantic palette.
//

import SwiftUI

// MARK: - Colours

enum DD {
    /// Apple Blue — mirrors the app's `--primary` CSS token.
    static let blue       = Color(red: 0.04, green: 0.52, blue: 1.00)
    /// Money-green for earnings.
    static let green      = Color(red: 0.20, green: 0.84, blue: 0.44)
    /// Destructive red for Stop actions.
    static let red        = Color(red: 1.00, green: 0.27, blue: 0.23)
    /// Primary text on the dark island surface.
    static let white      = Color.white
    /// Secondary / label text.
    static let dim        = Color.white.opacity(0.55)
    /// Faintest text (captions, "of Xm").
    static let faint      = Color.white.opacity(0.38)
}

// MARK: - Color(hex:)

extension Color {
    /// Accepts "#rrggbb" or "rrggbb". Falls back to DD.blue for bad input.
    init(hex raw: String) {
        let s = raw.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var v: UInt64 = 0
        guard s.count == 6, Scanner(string: s).scanHexInt64(&v) else {
            self = DD.blue; return
        }
        self = Color(
            red:   Double((v >> 16) & 0xFF) / 255,
            green: Double((v >>  8) & 0xFF) / 255,
            blue:  Double( v        & 0xFF) / 255
        )
    }
}

// MARK: - Session dot

/// Static glowing dot — no @State. Used in compact leading + lock screen.
struct SessionDot: View {
    let color: Color
    var size: CGFloat = 8

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.28))
                .frame(width: size * 2.4, height: size * 2.4)
                .blur(radius: 1)
            Circle()
                .fill(color)
                .frame(width: size, height: size)
        }
    }
}

// MARK: - Pill button (used inside expanded island bottom region)

/// A capsule-shaped button label. Wrap in a Link at the call site.
struct PillButton: View {
    let title: String
    let icon: String
    let color: Color

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
        }
        .foregroundStyle(DD.white)
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(Capsule().fill(color.opacity(0.2)))
        .overlay(Capsule().strokeBorder(color.opacity(0.5), lineWidth: 1))
    }
}

// MARK: - Circular button

/// A highly polished circular icon button.
struct CircularButton: View {
    let icon: String
    let color: Color
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.18))
            Circle()
                .strokeBorder(color.opacity(0.4), lineWidth: 1)
            Image(systemName: icon)
                .font(.system(size: size * 0.45, weight: .black))
                .foregroundStyle(color)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Duration string

/// "45m", "1h", "1h 30m"
func ddDuration(_ minutes: Int) -> String {
    guard minutes > 0 else { return "" }
    let h = minutes / 60, m = minutes % 60
    if h == 0 { return "\(m)m" }
    return m == 0 ? "\(h)h" : "\(h)h \(m)m"
}

// MARK: - Rate string

/// "$42/hr", "EUR 150/hr"
func ddRate(_ rate: Double, _ code: String) -> String {
    let fmt = NumberFormatter()
    fmt.numberStyle = .currency
    fmt.currencyCode = code
    fmt.maximumFractionDigits = rate.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 2
    let a = fmt.string(from: NSNumber(value: rate)) ?? "\(code) \(Int(rate))"
    return "\(a)/hr"
}

// MARK: - Safe URL helpers

func ddURL(_ path: String) -> URL? {
    URL(string: "daydraft://\(path)")
}

func ddFocusURL(_ blockId: String) -> URL? {
    ddURL("focus/\(blockId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? blockId)")
}

func ddFocusDoneURL(_ blockId: String) -> URL? {
    ddURL("focusdone/\(blockId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? blockId)")
}
