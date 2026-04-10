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

struct PrimaryButton: View {
    let title: String
    var icon: String?
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
            .foregroundStyle(.white)
            .padding(.vertical, Theme.Spacing.sm)
            .frame(maxWidth: .infinity)
            .background(Theme.Colors.primary)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        }
        .buttonStyle(PressableScaleStyle())
    }
}

struct SecondaryButton: View {
    let title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.Colors.primary)
                .padding(.vertical, Theme.Spacing.sm)
                .frame(maxWidth: .infinity)
                .background(Theme.Colors.mistBlue.opacity(0.65))
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        }
        .buttonStyle(PressableScaleStyle())
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
            .background(Theme.Colors.warmSurface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .stroke(Theme.Colors.line.opacity(0.4), lineWidth: 0.8)
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
            .background(Theme.Colors.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
            .subtleCardShadow()
    }
}

struct OutlineCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) { content }
            .padding(Theme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.clear)
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                    .stroke(Theme.Colors.line, lineWidth: 1)
            }
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

struct QuickActionTile: View {
    let title: String
    let subtitle: String
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: Theme.Icon.md, weight: .semibold))
                .foregroundStyle(Theme.Colors.primary)
            Text(title)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.Colors.textPrimary)
            Text(subtitle)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Spacing.md)
        .background(Theme.Colors.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        .subtleCardShadow()
    }
}

struct CourseCard: View {
    let course: Course

    var body: some View {
        ElevatedCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(course.title)
                        .font(Theme.Typography.cardTitle)
                    Text(course.summary)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                Spacer()
                if course.recommended {
                    StatusChip(title: "推薦", color: Theme.Colors.primary)
                }
            }

            HStack(spacing: Theme.Spacing.xs) {
                StatusChip(title: course.category, color: Theme.Colors.accent)
                StatusChip(title: course.level, color: Theme.Colors.blueGray)
                StatusChip(title: course.ageGroup, color: Theme.Colors.primary)
            }

            Text("\(course.schedule) ・ \(course.campus)")
                .font(Theme.Typography.caption)
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
        QuietCard {
            Text("預約摘要")
                .font(.system(size: 15, weight: .semibold, design: .rounded))
            Text(course)
                .font(Theme.Typography.cardTitle)
            Text("\(campus) ・ \(dateText)")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
            if let status {
                StatusChip(title: status.rawValue, color: status.color)
            }
        }
    }
}

struct FAQRow: View {
    let item: FAQItem
    @Binding var expandedID: UUID?

    var isExpanded: Bool { expandedID == item.id }

    var body: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.22)) {
                expandedID = isExpanded ? nil : item.id
            }
        } label: {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                HStack {
                    Text(item.question)
                        .font(.system(size: 16, weight: .medium, design: .rounded))
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .foregroundStyle(Theme.Colors.blueGray)
                }
                if isExpanded {
                    Text(item.answer)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.textSecondary)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(Theme.Spacing.md)
            .background(Theme.Colors.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .subtleCardShadow()
        }
        .buttonStyle(PressableScaleStyle())
    }
}

struct EmptyState: View {
    let title: String
    let message: String

    var body: some View {
        QuietCard {
            Image(systemName: "circle.grid.2x2")
                .font(.system(size: Theme.Icon.lg))
                .foregroundStyle(Theme.Colors.accent)
            Text(title)
                .font(Theme.Typography.cardTitle)
            Text(message)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

struct LockedState: View {
    let title: String
    let message: String

    var body: some View {
        OutlineCard {
            Image(systemName: "lock.shield")
                .font(.system(size: Theme.Icon.lg))
                .foregroundStyle(Theme.Colors.blueGray)
            Text(title)
                .font(Theme.Typography.cardTitle)
            Text(message)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

struct ParentDashboardTile: View {
    let title: String
    let value: String
    let note: String

    var body: some View {
        QuietCard {
            Text(title)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
            Text(value)
                .font(.system(size: 22, weight: .semibold, design: .rounded))
            Text(note)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.blueGray)
        }
    }
}

struct HeroBanner: View {
    let title: String
    let subtitle: String

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous)
                .fill(
                    LinearGradient(colors: [Theme.Colors.primary, Theme.Colors.accent], startPoint: .topLeading, endPoint: .bottomTrailing)
                )
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Text("TECM EDUCATION")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.8))
                Text(title)
                    .font(Theme.Typography.heroTitle)
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(Theme.Typography.body)
                    .foregroundStyle(.white.opacity(0.92))
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(height: 230)
        .subtleCardShadow()
    }
}

struct InternalDemoBadge: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "lock.open.display")
            Text("Internal Demo")
        }
        .font(.system(size: 11, weight: .semibold, design: .rounded))
        .foregroundStyle(Theme.Colors.blueGray)
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.vertical, Theme.Spacing.xxs + 1)
        .background(Theme.Colors.mistBlue.opacity(0.5))
        .clipShape(Capsule())
    }
}
