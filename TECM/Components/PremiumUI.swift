import SwiftUI

struct PremiumSectionHeader: View {
    let eyebrow: String?
    let title: String
    let subtitle: String?

    init(eyebrow: String? = nil, title: String, subtitle: String? = nil) {
        self.eyebrow = eyebrow
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            if let eyebrow {
                Text(eyebrow.uppercased())
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .tracking(0.7)
                    .foregroundStyle(Theme.Colors.blueGray)
            }
            Text(title)
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.Colors.textPrimary)
            if let subtitle {
                Text(subtitle)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }
}

struct BrandHeroSection: View {
    let title: String
    let subtitle: String
    let primaryTitle: String
    let secondaryTitle: String
    let primaryAction: () -> Void
    let secondaryAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            Text("TECM EDUCATION")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .tracking(0.7)
                .foregroundStyle(Theme.Colors.brandOrange)

            Text(title)
                .font(Theme.Typography.heroTitle)
                .foregroundStyle(Theme.Colors.textPrimary)

            Text(subtitle)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
                .lineSpacing(2)

            HStack(spacing: Theme.Spacing.sm) {
                PrimaryCTAButton(title: primaryTitle, action: primaryAction)
                    .frame(height: 46)
                SecondaryCTAButton(title: secondaryTitle, action: secondaryAction)
                    .frame(height: 46)
            }
            .padding(.top, Theme.Spacing.xs)
        }
        .padding(Theme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [Theme.Colors.card, Theme.Colors.warmSurface], startPoint: .topLeading, endPoint: .bottomTrailing)
        )
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.55), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous))
        .subtleCardShadow()
    }
}

struct PrimaryCTAButton: View {
    let title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(RefinedPrimaryButtonStyle())
    }
}

struct SecondaryCTAButton: View {
    let title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(RefinedSecondaryButtonStyle())
    }
}

struct ProofCard: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.Colors.textPrimary)
            Text(detail)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
                .lineLimit(2)
        }
        .padding(Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Colors.card)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.55), lineWidth: 0.8)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
    }
}

struct CuratedCourseCard: View {
    let course: Course

    var body: some View {
        ElevatedCard {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                HStack {
                    Text(course.category)
                        .font(Theme.Typography.chip)
                        .foregroundStyle(Theme.Colors.accent)
                        .padding(.horizontal, Theme.Spacing.xs)
                        .padding(.vertical, Theme.Spacing.xxs)
                        .background(Theme.Colors.accent.opacity(0.12), in: Capsule())
                    Spacer()
                    Text(course.level)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.blueGray)
                }
                Text(course.title)
                    .font(Theme.Typography.cardTitle)
                    .foregroundStyle(Theme.Colors.textPrimary)
                Text(course.summary)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Text("適合：\(course.ageGroup)  ·  建議起點：\(course.focusTags.first ?? "探索")")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.blueGray)
            }
        }
    }
}

struct ConciergeStepHeader: View {
    let currentStep: Int
    let totalSteps: Int
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                Text("STEP \(currentStep)/\(totalSteps)")
                    .font(Theme.Typography.chip)
                    .foregroundStyle(Theme.Colors.blueGray)
                Spacer()
                Text("進度 \(Int((Double(currentStep) / Double(totalSteps)) * 100))%")
                    .font(Theme.Typography.chip)
                    .foregroundStyle(Theme.Colors.blueGray)
            }
            Text(title)
                .font(Theme.Typography.cardTitle)
            Text(subtitle)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 4).fill(Theme.Colors.line.opacity(0.45))
                    RoundedRectangle(cornerRadius: 4).fill(Theme.Colors.primary.opacity(0.85)).frame(width: proxy.size.width * CGFloat(currentStep) / CGFloat(totalSteps))
                }
            }
            .frame(height: 6)
        }
        .padding(Theme.Spacing.md)
                        .background(Theme.Colors.card)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.55), lineWidth: 0.8)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String

    var body: some View {
        QuietCard {
            Text(title)
                .font(Theme.Typography.cardTitle)
            Text(message)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

struct SuccessStateView: View {
    let title: String
    let message: String

    var body: some View {
        ElevatedCard {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 30))
                .foregroundStyle(Theme.Colors.success)
            Text(title)
                .font(Theme.Typography.cardTitle)
            Text(message)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

struct SkeletonBlock: View {
    var width: CGFloat? = nil
    var height: CGFloat = 16

    var body: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(Theme.Colors.line.opacity(0.45))
            .frame(width: width, height: height)
            .redacted(reason: .placeholder)
    }
}

struct SkeletonCard: View {
    var body: some View {
        ElevatedCard {
            SkeletonBlock(width: 120, height: 12)
            SkeletonBlock(height: 18)
            SkeletonBlock(height: 12)
            SkeletonBlock(width: 160, height: 12)
        }
        .shimmering()
    }
}

struct FAQChip: View {
    let title: String
    let selected: Bool

    var body: some View {
        Text(title)
            .font(Theme.Typography.chip)
            .foregroundStyle(selected ? .white : Theme.Colors.primary)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.xs)
            .background(selected ? Theme.Colors.primary : Theme.Colors.mistBlue.opacity(0.55))
            .clipShape(Capsule())
    }
}

struct AdvisorAnswerCard: View {
    let question: String
    let answer: String

    var body: some View {
        ElevatedCard {
            Text(question)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
            Text(answer)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

private struct ShimmerModifier: ViewModifier {
    @State private var phase: CGFloat = -0.9

    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { proxy in
                    LinearGradient(
                        colors: [.clear, .white.opacity(0.4), .clear],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .frame(width: proxy.size.width * 0.45)
                    .offset(x: proxy.size.width * phase)
                    .blendMode(.plusLighter)
                    .onAppear {
                        withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                            phase = 1.3
                        }
                    }
                }
                .allowsHitTesting(false)
            }
            .mask(content)
    }
}

extension View {
    func shimmering() -> some View {
        modifier(ShimmerModifier())
    }

    func premiumEntrance(delay: Double = 0) -> some View {
        modifier(PremiumEntranceModifier(delay: delay))
    }
}

private struct PremiumEntranceModifier: ViewModifier {
    @State private var isVisible = false
    let delay: Double

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .offset(y: isVisible ? 0 : 8)
            .onAppear {
                withAnimation(.easeOut(duration: 0.34).delay(delay)) {
                    isVisible = true
                }
            }
    }
}
