import SwiftUI

struct SectionHeader: View {
    let title: String
    let subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
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

struct RefinedPrimaryButtonStyle: ButtonStyle {
    var disabled: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white.opacity(disabled ? 0.75 : 1))
            .padding(.vertical, Theme.Spacing.sm)
            .frame(maxWidth: .infinity)
            .background(
                LinearGradient(
                    colors: disabled
                    ? [Theme.Colors.blueGray.opacity(0.45), Theme.Colors.blueGray.opacity(0.35)]
                    : [Theme.Colors.primary, Theme.Colors.primary.opacity(0.85)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(.white.opacity(disabled ? 0.08 : 0.24), lineWidth: 0.8)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.984 : 1)
            .opacity(configuration.isPressed ? 0.95 : 1)
            .shadow(color: Theme.Colors.primary.opacity(configuration.isPressed ? 0.08 : 0.2), radius: configuration.isPressed ? 5 : 10, y: configuration.isPressed ? 2 : 6)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct RefinedSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Theme.Colors.primary)
            .padding(.vertical, Theme.Spacing.sm)
            .frame(maxWidth: .infinity)
            .background(Theme.Colors.mistBlue.opacity(0.5))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(Theme.Colors.line.opacity(0.8), lineWidth: 0.8)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.986 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct PrimaryButton: View {
    let title: String
    var icon: String?
    var isDisabled: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Spacing.xs) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: Theme.Icon.sm, weight: .semibold))
                }
                Text(title)
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
            }
        }
        .disabled(isDisabled)
        .buttonStyle(RefinedPrimaryButtonStyle(disabled: isDisabled))
    }
}

struct SecondaryButton: View {
    let title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
        }
        .buttonStyle(RefinedSecondaryButtonStyle())
    }
}

struct QuietCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) { content }
            .padding(Theme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .stroke(Theme.Colors.line.opacity(0.5), lineWidth: 0.8)
            }
    }
}

struct ElevatedCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) { content }
            .padding(Theme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(colors: [Theme.Colors.card, Theme.Colors.warmSurface], startPoint: .topLeading, endPoint: .bottomTrailing)
            )
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .stroke(Theme.Colors.line.opacity(0.55), lineWidth: 0.8)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
            .subtleCardShadow()
    }
}

struct BookingStatusChip: View {
    let status: BookingStatus

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: status.icon)
                .font(.system(size: 10, weight: .semibold))
            Text(status.rawValue)
                .font(Theme.Typography.chip)
        }
        .foregroundStyle(status.color)
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xxs + 2)
        .background(status.color.opacity(0.13))
        .overlay {
            Capsule().stroke(status.color.opacity(0.35), lineWidth: 0.7)
        }
        .clipShape(Capsule())
    }
}

struct StatusChip: View {
    let title: String
    let color: Color

    var body: some View {
        Text(title)
            .font(Theme.Typography.chip)
            .foregroundStyle(color)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.xxs + 2)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }
}

struct FloatingFeedbackToast: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
            Text(message)
                .font(Theme.Typography.caption.weight(.semibold))
        }
        .foregroundStyle(Theme.Colors.success)
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Theme.Colors.warmSurface)
        .overlay {
            Capsule().stroke(Theme.Colors.success.opacity(0.35), lineWidth: 0.8)
        }
        .clipShape(Capsule())
        .subtleCardShadow()
    }
}

struct DashboardActionItem: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let icon: String
    let tint: Color
}

struct QuickActionGrid: View {
    let actions: [DashboardActionItem]
    let destination: (DashboardActionItem) -> AnyView

    private let columns = [
        GridItem(.flexible(), spacing: Theme.Spacing.md),
        GridItem(.flexible(), spacing: Theme.Spacing.md)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: Theme.Spacing.md) {
            ForEach(actions) { item in
                NavigationLink(destination: destination(item)) {
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        Image(systemName: item.icon)
                            .font(.system(size: Theme.Icon.md, weight: .semibold))
                            .foregroundStyle(item.tint)
                            .padding(10)
                            .background(item.tint.opacity(0.1), in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
                        Text(item.title)
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                            .foregroundStyle(Theme.Colors.textPrimary)
                        Text(item.subtitle)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                            .lineLimit(2)
                    }
                    .padding(Theme.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.Colors.card)
                    .overlay {
                        RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                            .stroke(Theme.Colors.line.opacity(0.5), lineWidth: 0.8)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
                    .subtleCardShadow()
                }
                .buttonStyle(PressableScaleStyle())
            }
        }
    }
}

struct CompactPreviewCard: View {
    let title: String
    let subtitle: String
    let icon: String
    let tint: Color

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 34, height: 34)
                .background(tint.opacity(0.13))
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(Theme.Colors.textPrimary)
                Text(subtitle)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .lineLimit(2)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.Colors.blueGray)
        }
        .padding(Theme.Spacing.md)
        .frame(width: 280)
        .background(Theme.Colors.warmSurface)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.45), lineWidth: 0.8)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }
}

struct FeaturedNewsCard: View {
    let item: NewsItem

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack {
                StatusChip(title: item.category, color: Theme.Colors.accent)
                Spacer()
                Text(item.date)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(.white.opacity(0.82))
            }
            Text(item.title)
                .font(.system(size: 21, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(2)
            Text(item.summary)
                .font(Theme.Typography.caption)
                .foregroundStyle(.white.opacity(0.88))
                .lineLimit(2)
            HStack {
                Text("查看詳情")
                    .font(Theme.Typography.caption.weight(.semibold))
                    .foregroundStyle(.white)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
            }
        }
        .padding(Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [Theme.Colors.primary, Theme.Colors.blueGray], startPoint: .topLeading, endPoint: .bottomTrailing))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        .subtleCardShadow()
    }
}

struct SupportingNewsCard: View {
    let item: NewsItem

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack {
                StatusChip(title: item.category, color: Theme.Colors.accent)
                Spacer()
                Text(item.date)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.blueGray)
            }
            Text(item.title)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.Colors.textPrimary)
                .lineLimit(2)
            Text(item.summary)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
                .lineLimit(2)
            HStack {
                Text("查看詳情")
                    .font(Theme.Typography.caption.weight(.semibold))
                    .foregroundStyle(Theme.Colors.primary)
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.Colors.primary)
            }
        }
        .padding(Theme.Spacing.md)
        .frame(width: 250, alignment: .leading)
        .background(Theme.Colors.card)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.5), lineWidth: 0.8)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }
}

struct QuickActionTile: View {
    let title: String
    let subtitle: String
    let icon: String

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: Theme.Icon.md, weight: .semibold))
                .foregroundStyle(Theme.Colors.primary)
                .frame(width: 34, height: 34)
                .background(Theme.Colors.mistBlue.opacity(0.45), in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(Theme.Colors.textPrimary)
                Text(subtitle)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
            Spacer()
        }
        .padding(Theme.Spacing.md)
        .background(Theme.Colors.card)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.45), lineWidth: 0.8)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }
}

struct ParentDashboardTile: View {
    let title: String
    let value: String
    let note: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
            Text(value)
                .font(.system(size: 24, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.Colors.primary)
            Text(note)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.blueGray)
        }
        .padding(Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Colors.card)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.5), lineWidth: 0.8)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }
}

struct InternalDemoBadge: View {
    var body: some View {
        Text("Internal Demo")
            .font(Theme.Typography.chip)
            .foregroundStyle(Theme.Colors.primary)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.xxs + 2)
            .background(Theme.Colors.mistBlue.opacity(0.55))
            .clipShape(Capsule())
    }
}

struct LockedState: View {
    let title: String
    let message: String

    var body: some View {
        QuietCard {
            Text(title)
                .font(Theme.Typography.cardTitle)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text(message)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

struct BookingSummaryCard: View {
    let course: String
    let campus: String
    let dateText: String
    let status: BookingStatus?

    var body: some View {
        ElevatedCard {
            HStack {
                Text("本次預約摘要")
                    .font(Theme.Typography.cardTitle)
                Spacer()
                if let status {
                    BookingStatusChip(status: status)
                }
            }
            Text(course)
                .font(Theme.Typography.body.weight(.semibold))
                .foregroundStyle(Theme.Colors.textPrimary)
            Text("\(campus) · \(dateText)")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

struct OutlineCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            content
        }
        .padding(Theme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line, style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
        }
        .background(Theme.Colors.warmSurface.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }
}

struct CourseCard: View {
    let course: Course

    var body: some View {
        ElevatedCard {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                HStack(alignment: .top) {
                    Text(course.title)
                        .font(Theme.Typography.cardTitle)
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Spacer()
                    StatusChip(title: course.level, color: Theme.Colors.primary)
                }

                Text(course.summary)
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .lineLimit(2)

                HStack(spacing: Theme.Spacing.xs) {
                    ForEach(course.focusTags, id: \.self) { tag in
                        StatusChip(title: tag, color: Theme.Colors.accent)
                    }
                }

                Text("\(course.schedule) ・ \(course.campus)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }
}

struct FAQRow: View {
    let item: FAQItem
    @Binding var expandedID: UUID?

    private var isExpanded: Bool {
        expandedID == item.id
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    expandedID = isExpanded ? nil : item.id
                }
            } label: {
                HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.topic)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.blueGray)
                        Text(item.question)
                            .font(Theme.Typography.body.weight(.semibold))
                            .foregroundStyle(Theme.Colors.textPrimary)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.Colors.blueGray)
                        .padding(.top, 2)
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                Text(item.answer)
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.Colors.card)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.5), lineWidth: 0.8)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }
}

struct EmptyState: View {
    let title: String
    let message: String
    var icon: String = "tray"

    var body: some View {
        VStack(spacing: Theme.Spacing.xs) {
            Image(systemName: icon)
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(Theme.Colors.blueGray)
                .padding(.bottom, 2)
            Text(title)
                .font(Theme.Typography.cardTitle)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text(message)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(Theme.Spacing.lg)
        .frame(maxWidth: .infinity)
        .background(Theme.Colors.warmSurface)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.6), lineWidth: 0.8)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
    }
}
