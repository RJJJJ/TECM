import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var accessState: DemoAccessState

    var body: some View {
        ScreenContainer(title: "首頁") {
            roleSwitchSection
            heroSection
            latestNewsSection
            quickActionsSection
            learningCenterSection
            coursePreviewSection
        }
    }

    private var roleSwitchSection: some View {
        InfoCard {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("示範身份")
                        .font(.subheadline.weight(.semibold))
                    Text(accessState.role.rawValue)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                Spacer()
                Button(accessState.isInternal ? "切換為家長" : "切換為中心") {
                    accessState.toggleRole()
                }
                .buttonStyle(PressableScaleStyle())
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, Theme.Spacing.xs)
                .background(Theme.Colors.softBlue)
                .clipShape(Capsule())
            }
            if accessState.isInternal {
                Text("內部示範模式可查看「管理預覽頁」，只供中心演示使用。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.warning)
            }
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
                .buttonStyle(PressableScaleStyle())

                NavigationLink(destination: AgentView()) {
                    TagChip(title: "了解 TECM AGENT", isSelected: false)
                }
                .buttonStyle(PressableScaleStyle())
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
                .buttonStyle(PressableScaleStyle())

                if accessState.isInternal {
                    NavigationLink(destination: AdminPreviewView()) {
                        quickActionCard(title: "管理預覽", icon: "lock.shield")
                    }
                    .buttonStyle(PressableScaleStyle())
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: accessState.isInternal)
    }

    private var learningCenterSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            SectionHeader(title: "學習中心", subtitle: "輔助學習示範（次要功能）")
            NavigationLink(destination: LearningCenterView()) {
                InfoCard {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("前往學習中心")
                                .font(.headline)
                            Text("包含選擇題與判斷題示範，作為課後支援工具")
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Colors.textSecondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                }
            }
            .buttonStyle(PressableScaleStyle())
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
