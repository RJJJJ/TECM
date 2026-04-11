import SwiftUI

struct HomeView: View {
    @State private var revealInternalAccess = false
    @State private var goBooking = false
    @State private var goCourses = false

    private var featuredNews: [NewsItem] {
        Array(MockDataStore.news.prefix(3))
    }

    private let proofItems: [(String, String)] = [
        ("AI 即時判題", "課堂示範中提供即時回饋，協助家長理解孩子思路。"),
        ("顧問式課程規劃", "由入門到進階建立階段目標，而非一次性單堂體驗。"),
        ("評估式體驗", "先確認起點與學習節奏，再安排合適課程路線。")
    ]

    private let growthPath = ["啟蒙探索", "邏輯建立", "進階實作", "競賽與專題"]

    var body: some View {
        ScreenContainer {
            BrandHeroSection(
                title: "為孩子安排一條可持續成長的學習路徑",
                subtitle: "TECM 以顧問式方式串連評估、課程與體驗安排，讓家長在第一步就感到安心。",
                primaryTitle: "預約評估",
                secondaryTitle: "查看課程路線",
                primaryAction: { goBooking = true },
                secondaryAction: { goCourses = true }
            )
            .onLongPressGesture(minimumDuration: 1.2) {
                withAnimation(.easeInOut(duration: 0.24)) { revealInternalAccess.toggle() }
            }
            .overlay(alignment: .topTrailing) {
                if revealInternalAccess {
                    NavigationLink(destination: AdminPreviewView(hasInternalAccess: true)) {
                        Text("內部預覽")
                            .font(Theme.Typography.chip)
                            .foregroundStyle(Theme.Colors.primary)
                            .padding(.horizontal, Theme.Spacing.xs)
                            .padding(.vertical, Theme.Spacing.xxs)
                            .background(Theme.Colors.mistBlue.opacity(0.75), in: Capsule())
                    }
                    .padding(Theme.Spacing.sm)
                    .transition(.opacity)
                }
            }
            .premiumEntrance()
            .background {
                Group {
                    NavigationLink("", destination: BookingView(), isActive: $goBooking).hidden()
                    NavigationLink("", destination: CoursesView(), isActive: $goCourses).hidden()
                }
            }

            curatedUpdatesSection
                .premiumEntrance(delay: 0.03)

            proofSection
                .premiumEntrance(delay: 0.06)

            growthPathSection
                .premiumEntrance(delay: 0.1)

            curatedShortcutSection
                .premiumEntrance(delay: 0.12)
        }
    }

    private var curatedUpdatesSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(eyebrow: "Curated Updates", title: "精選資訊", subtitle: "活動、課程資訊與最新消息")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.md) {
                    ForEach(featuredNews) { item in
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            HStack {
                                StatusChip(title: item.category, color: Theme.Colors.accent)
                                Spacer()
                                Text(item.date)
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(Theme.Colors.blueGray)
                            }
                            Text(item.title)
                                .font(.system(size: 17, weight: .semibold, design: .rounded))
                                .foregroundStyle(Theme.Colors.textPrimary)
                                .lineLimit(2)
                            Text(item.summary)
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Colors.textSecondary)
                                .lineLimit(2)
                        }
                        .padding(Theme.Spacing.md)
                        .frame(width: min(UIScreen.main.bounds.width * 0.78, 290), alignment: .leading)
                        .background(Theme.Colors.card)
                        .overlay {
                            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                                .stroke(Theme.Colors.line.opacity(0.5), lineWidth: 0.8)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var proofSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(eyebrow: "Why TECM", title: "品牌證據", subtitle: "以方法論與服務流程建立信任")
            ForEach(proofItems, id: \.0) { item in
                ProofCard(title: item.0, detail: item.1)
            }
        }
    }

    private var growthPathSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(eyebrow: "Learning Path", title: "課程成長路徑", subtitle: "從探索到專題，逐步建立能力")
            ForEach(Array(growthPath.enumerated()), id: \.offset) { index, step in
                HStack(spacing: Theme.Spacing.sm) {
                    Text("0\(index + 1)")
                        .font(Theme.Typography.chip)
                        .foregroundStyle(Theme.Colors.blueGray)
                        .frame(width: 28)
                    Text(step)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Spacer()
                }
                .padding(.vertical, 6)
                if index < growthPath.count - 1 {
                    Divider().overlay(Theme.Colors.line.opacity(0.5))
                }
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.vertical, Theme.Spacing.xs)
            .background(Theme.Colors.warmSurface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        }
    }

    private var curatedShortcutSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(eyebrow: "Quick Access", title: "精選入口", subtitle: "保留必要入口，不讓首頁變成功能牆")
            NavigationLink(destination: CoursesView()) {
                QuickActionTile(title: "課程總覽", subtitle: "查看完整課程策展與建議起點", icon: "book.closed")
            }
            .buttonStyle(PressableScaleStyle())

            NavigationLink(destination: BookingView()) {
                QuickActionTile(title: "預約體驗", subtitle: "以 3-4 步驟完成顧問式預約", icon: "calendar.badge.plus")
            }
            .buttonStyle(PressableScaleStyle())

            NavigationLink(destination: AgentView()) {
                QuickActionTile(title: "常見問題", subtitle: "透過 TECM AGENT 先了解常見決策問題", icon: "bubble.left.and.text.bubble.right")
            }
            .buttonStyle(PressableScaleStyle())
        }
    }
}

#Preview {
    NavigationStack { HomeView() }
}
