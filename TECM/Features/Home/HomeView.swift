import SwiftUI

struct HomeView: View {
    @State private var revealInternalAccess = false
    @State private var goBooking = false
    @State private var goCourses = false

    private var featuredNews: [NewsItem] {
        Array(MockDataStore.news.prefix(3))
    }

    private let proofItems: [(String, String)] = [
        ("Python / Scratch / C++ 系統課程", "對應不同年齡與起點，從基礎理解到考級與比賽應用。"),
        ("考級與比賽導向支援", "課程與練習設計可銜接公開評核與賽事準備，重視實作與表達。"),
        ("顧問式入學評估流程", "先評估程度與學習節奏，再安排最合適的課程與體驗時段。")
    ]

    var body: some View {
        ScreenContainer {
            BrandHeroSection(
                title: "TECM 澳門編程教育中心",
                subtitle: "聚焦 Python、Scratch、C++ 的系統化學習路線，結合評估、課堂與考前練習，讓家長清楚看見孩子的下一步。",
                primaryTitle: "預約體驗",
                secondaryTitle: "瀏覽課程",
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

            practiceEntrySection
                .premiumEntrance(delay: 0.09)

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
            PremiumSectionHeader(eyebrow: "Why TECM", title: "品牌證據", subtitle: "公開課程重點與服務流程，讓家長可判斷、可比較")
            ForEach(proofItems, id: \.0) { item in
                ProofCard(title: item.0, detail: item.1)
            }
        }
    }

    private var practiceEntrySection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(eyebrow: "Learning Tools", title: "考前練習入口", subtitle: "用短題練習快速檢查觀念，維持考前節奏")
            NavigationLink(destination: LearningCenterView()) {
                QuickActionTile(title: "進入考前練習中心", subtitle: "先選科目，再選等級與試卷開始練習", icon: "checklist")
            }
            .buttonStyle(PressableScaleStyle())
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
