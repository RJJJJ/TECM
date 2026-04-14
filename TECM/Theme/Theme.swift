import SwiftUI
import UIKit
import Combine

enum Theme {
    enum Colors {
        static let backgroundTop = Color(light: "#E6E6FA", dark: "#11131A")
        static let backgroundBottom = Color(light: "#ECEEFB", dark: "#0D1017")
        static let background = Color(uiColor: .systemBackground)
        static let warmSurface = Color(uiColor: .secondarySystemBackground)
        static let card = Color(uiColor: .secondarySystemBackground)
        static let primary = Color(hex: "#3047B8")
        static let mistBlue = Color(light: "#EEF2FF", dark: "#1B2234")
        static let blueGray = Color(light: "#606A82", dark: "#A3AEC7")
        static let textPrimary = Color(uiColor: .label)
        static let textSecondary = Color(uiColor: .secondaryLabel)
        static let line = Color(uiColor: .separator)
        static let accent = Color(hex: "#7E22CE")
        static let brandOrange = Color(hex: "#F58220")
        static let badgeLavender = Color(light: "#F3E8FF", dark: "#2B1E3F")
        static let success = Color(hex: "#2E7D63")
        static let warning = Color(hex: "#A97934")
        static let loading = Color(light: "#94A3B8", dark: "#64748B")
    }

    enum Spacing {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 40
        static let sectionLead: CGFloat = 14
    }

    enum Radius {
        static let sm: CGFloat = 10
        static let md: CGFloat = 14
        static let lg: CGFloat = 20
        static let xl: CGFloat = 28
    }

    enum Shadow {
        static let subtle = Color.black.opacity(0.18)
    }

    enum Icon {
        static let sm: CGFloat = 14
        static let md: CGFloat = 18
        static let lg: CGFloat = 24
    }

    enum Typography {
        static let pageTitle = Font.system(size: 30, weight: .semibold, design: .rounded)
        static let heroTitle = Font.system(size: 34, weight: .semibold, design: .rounded)
        static let sectionTitle = Font.system(size: 20, weight: .semibold, design: .rounded)
        static let cardTitle = Font.system(size: 18, weight: .semibold, design: .rounded)
        static let body = Font.system(size: 16, weight: .regular, design: .rounded)
        static let caption = Font.system(size: 13, weight: .regular, design: .rounded)
        static let chip = Font.system(size: 12, weight: .medium, design: .rounded)
    }
}

struct PressableScaleStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.986 : 1)
            .opacity(configuration.isPressed ? 0.94 : 1)
            .shadow(color: .black.opacity(configuration.isPressed ? 0.04 : 0.09), radius: configuration.isPressed ? 3 : 8, y: configuration.isPressed ? 1 : 4)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

extension View {
    func subtleCardShadow() -> some View {
        shadow(color: Theme.Shadow.subtle, radius: 10, y: 4)
    }
}

extension Color {
    init(light: String, dark: String) {
        self.init(uiColor: UIColor { trait in
            trait.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }

    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: (a, r, g, b) = (255, 0, 0, 0)
        }

        self.init(.sRGB,
                  red: Double(r) / 255,
                  green: Double(g) / 255,
                  blue: Double(b) / 255,
                  opacity: Double(a) / 255)
    }
}

private extension UIColor {
    convenience init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64

        switch hex.count {
        case 3: (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: (a, r, g, b) = (255, 0, 0, 0)
        }

        self.init(red: CGFloat(r) / 255,
                  green: CGFloat(g) / 255,
                  blue: CGFloat(b) / 255,
                  alpha: CGFloat(a) / 255)
    }
}
