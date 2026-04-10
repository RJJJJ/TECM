import SwiftUI

struct HomeView: View {
    var body: some View {
        ScreenContainer(title: "首頁") {
            heroSection
            latestNewsSection
            quickActionsSection
            coursePreviewSection
        }
    }

    private var heroSection: some View {
        InfoCard {
            Text("TECM 教育中心")
                .font(Theme.Typography.heroTitle)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text("為家長提供清晰、可信賴的一站式學習服務")
                .foregroundStyle(Theme.Colors.textSecondary)
            HStack(spacing: Theme.Spacing.sm) {
                NavigationLink(destination: BookingView()) {
                    Text("立即預約試堂")
                        .fontWeight(.semibold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, Theme.Spacing.md)
                        .padding(.vertical, Theme.Spacing.sm)
                        .background(Theme.Colors.primaryBlue)
                        .clipShape(Capsule())
                }
                NavigationLink(destination: AgentView()) {
                    TagChip(title: "了解 TECM AGENT", isSelected: false)
                }
            }
        }
    }

    private var latestNewsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            SectionHeader(title: "最新消息", subtitle: "第一時間掌握中心動向")
            ForEach(MockDataStore.news) { item in
                InfoCard {
                    Text(item.title)
                        .font(.headline)
                    Text(item.date)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
        }
    }

    private var quickActionsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            SectionHeader(title: "快捷功能", subtitle: nil)
            HStack(spacing: Theme.Spacing.sm) {
                NavigationLink(destination: BookingView()) {
                    quickActionCard(title: "預約試堂", icon: "calendar")
                }
                NavigationLink(destination: AdminPreviewView()) {
                    quickActionCard(title: "管理預覽", icon: "list.bullet.rectangle")
                }
            }
        }
    }

    private var coursePreviewSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            SectionHeader(title: "課程精選", subtitle: "本月熱門課程")
            ForEach(MockDataStore.courses.prefix(2)) { course in
                InfoCard {
                    Text(course.title)
                        .font(.headline)
                    Text(course.summary)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
        }
    }

    private func quickActionCard(title: String, icon: String) -> some View {
        VStack(spacing: Theme.Spacing.xs) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Theme.Colors.primaryBlue)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.Colors.textPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Theme.Spacing.md)
        .background(Theme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.card, style: .continuous))
        .shadow(color: Theme.Shadow.card, radius: 8, y: 2)
    }
}
