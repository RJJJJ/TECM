import SwiftUI

struct CourseDetailView: View {
    let course: Course
    @State private var showMoreHighlights = false

    var body: some View {
        ScreenContainer(title: "課程詳情", showBackButton: true) {
            heroSection

            PremiumSectionHeader(
                eyebrow: "Core Focus",
                title: "核心資訊",
                subtitle: "先看定位、適合對象與可見成果，再決定是否安排體驗"
            )

            VStack(spacing: Theme.Spacing.md) {
                keyModule(
                    title: "課程定位",
                    icon: "scope",
                    content: "以 \(course.focusTags.joined(separator: "、")) 為主軸，建立可理解、可延續的學習節奏，不做短期填鴨。"
                )

                keyModule(
                    title: "適合對象",
                    icon: "person.2",
                    content: "\(course.ageGroup) 孩子；希望在 \(course.category) 從基礎到進階建立完整學習路線的家庭。"
                )

                keyModule(
                    title: "學習成果",
                    icon: "sparkles.rectangle.stack",
                    content: "透過情境任務、拆題示範與個別回饋，讓孩子理解方法、能獨立應用並穩定表達。"
                )
            }

            PremiumSectionHeader(
                eyebrow: "Additional Details",
                title: "補充資訊",
                subtitle: "特色、銜接方向與家長可預期的學習體驗"
            )

            QuietCard {
                DisclosureGroup(isExpanded: $showMoreHighlights) {
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        detailLine(title: "課程特色", content: "小班互動、顧問式追蹤、每堂課有明確學習目標。")
                        detailLine(title: "銜接方向", content: "完成本階段可銜接下一級課程或專題型學習路線。")
                        detailLine(title: "家長體驗", content: "提供清楚可理解的進度回饋，家長可掌握孩子的下一步。")
                    }
                    .padding(.top, Theme.Spacing.xs)
                } label: {
                    HStack {
                        Text("展開查看完整補充資訊")
                            .font(Theme.Typography.body.weight(.semibold))
                        Spacer()
                    }
                }
                .tint(Theme.Colors.primary)
            }

            footerCTA
        }
        .tecmDetailTabBar()
    }

    private var heroSection: some View {
        ElevatedCard {
            HStack {
                Text(course.category)
                    .font(Theme.Typography.chip)
                    .foregroundStyle(Theme.Colors.accent)
                    .padding(.horizontal, Theme.Spacing.sm)
                    .padding(.vertical, Theme.Spacing.xxs + 2)
                    .background(Theme.Colors.accent.opacity(0.1), in: Capsule())
                Spacer()
                Text(course.level)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.blueGray)
            }

            Text(course.title)
                .font(Theme.Typography.heroTitle)
                .foregroundStyle(Theme.Colors.textPrimary)

            Text("為家長建立可預測、可追蹤的學習安排")
                .font(Theme.Typography.body.weight(.semibold))
                .foregroundStyle(Theme.Colors.primary)

            Text(course.summary)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
                .lineSpacing(2)
        }
    }

    private var footerCTA: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("準備好安排第一步")
                .font(Theme.Typography.cardTitle)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text("完成閱讀後，可直接預約體驗時段，顧問會依孩子程度提供安排建議。")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)

            NavigationLink(destination: BookingView(prefilledCourse: course.title)) {
                HStack {
                    Text("預約體驗")
                    Spacer()
                    Image(systemName: "arrow.right")
                }
                .padding(.vertical, Theme.Spacing.sm)
                .padding(.horizontal, Theme.Spacing.md)
            }
            .buttonStyle(RefinedPrimaryButtonStyle())
        }
        .padding(Theme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Colors.card, in: RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.65), lineWidth: 0.9)
        }
        .subtleCardShadow()
        .padding(.top, Theme.Spacing.xs)
    }

    private func keyModule(title: String, icon: String, content: String) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.Colors.primary)
                .frame(width: 28, height: 28)
                .background(Theme.Colors.mistBlue, in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))

            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Text(title)
                    .font(Theme.Typography.body.weight(.semibold))
                    .foregroundStyle(Theme.Colors.textPrimary)
                Text(content)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .lineSpacing(2)
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.Spacing.md)
        .background(Theme.Colors.card, in: RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.5), lineWidth: 0.8)
        }
    }

    private func detailLine(title: String, content: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(Theme.Typography.caption.weight(.semibold))
                .foregroundStyle(Theme.Colors.textPrimary)
            Text(content)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

#Preview {
    NavigationStack {
        CourseDetailView(course: MockDataStore.courses[1])
    }
}
