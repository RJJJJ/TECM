import SwiftUI

enum Theme {
    enum Colors {
        static let backgroundTop = Color(hex: "#E6E6FA")
        static let backgroundBottom = Color(hex: "#FADADD")
        static let background = Color(hex: "#EFF1FC")
        static let warmSurface = Color(hex: "#FFFFFFCC")
        static let card = Color(hex: "#FFFFFFF2")
        static let primary = Color(hex: "#4E81EE")
        static let mistBlue = Color(hex: "#EEF2FF")
        static let blueGray = Color(hex: "#6B7280")
        static let textPrimary = Color(hex: "#333333")
        static let textSecondary = Color(hex: "#666666")
        static let line = Color(hex: "#D9DEEA")
        static let accent = Color(hex: "#7E22CE")
        static let brandOrange = Color(hex: "#F58220")
        static let badgeLavender = Color(hex: "#F3E8FF")
        static let success = Color(hex: "#2E7D63")
        static let warning = Color(hex: "#A97934")
        static let loading = Color(hex: "#94A3B8")
    }

    enum Spacing {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 40
    }

    enum Radius {
        static let sm: CGFloat = 10
        static let md: CGFloat = 14
        static let lg: CGFloat = 20
        static let xl: CGFloat = 28
    }

    enum Shadow {
        static let subtle = Color.black.opacity(0.07)
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
