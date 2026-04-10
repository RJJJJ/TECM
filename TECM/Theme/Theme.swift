import SwiftUI

enum Theme {
    enum Colors {
        static let background = Color(hex: "#F7FAFF")
        static let surface = Color.white
        static let primaryBlue = Color(hex: "#2D5BCA")
        static let softBlue = Color(hex: "#EAF2FF")
        static let textPrimary = Color(hex: "#1E2A3A")
        static let textSecondary = Color(hex: "#5B6B80")
        static let warmAccent = Color(hex: "#E6A15B")
        static let success = Color(hex: "#2E9D6C")
        static let warning = Color(hex: "#E3A008")
        static let danger = Color(hex: "#D64545")
    }

    enum Spacing {
        static let xs: CGFloat = 6
        static let sm: CGFloat = 10
        static let md: CGFloat = 16
        static let lg: CGFloat = 22
        static let xl: CGFloat = 30
    }

    enum CornerRadius {
        static let card: CGFloat = 18
        static let button: CGFloat = 14
        static let chip: CGFloat = 12
    }

    enum Typography {
        static let pageTitle = Font.system(.title2, design: .rounded).weight(.bold)
        static let heroTitle = Font.system(.largeTitle, design: .rounded).weight(.bold)
        static let sectionTitle = Font.system(.title3, design: .rounded).weight(.semibold)
        static let body = Font.system(.body, design: .rounded)
        static let caption = Font.system(.caption, design: .rounded)
    }

    enum Shadow {
        static let card = Color.black.opacity(0.06)
    }
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
