import SwiftUI

private enum HomeServiceSegment: String, CaseIterable, Identifiable {
    case featuredCourses = "精選課程"
    case trialBooking = "預約體驗"
    case parentTools = "家長常用"

    var id: String { rawValue }
}

struct HomeView: View {
    @State private var revealInternalAccess = false
    @State private var selectedSegment: HomeServiceSegment = .featuredCourses

    private var featuredCourses: [Course] {
        Array(MockDataStore.courses.filter(\.recommended).prefix(3))
    }

    private var newsItems: [NewsItem] { MockDataStore.news }
    private var featuredNews: NewsItem? { newsItems.first(where: \.isFeatured) }
    private var supportingNews: [NewsItem] { newsItems.filter { !$0.isFeatured }.prefix(2).map { $0 } }

    private let dashboardActions: [DashboardActionItem] = [
        .init(title: "立即預約", subtitle: "安排體驗課時段", icon: "calendar.badge.plus", tint: Theme.Colors.primary),
        .init(title: "課程地圖", subtitle: "快速了解路徑", icon: "square.grid.2x2", tint: Theme.Colors.accent),
        .init(title: "家長中心", subtitle: "查看近期安排", icon: "person.crop.circle", tint: Theme.Colors.blueGray),
        .init(title: "TECM AGENT", subtitle: "常見問題導引", icon: "message.badge", tint: Theme.Colors.success)
    ]
    private var serviceCardWidth: CGFloat { min(UIScreen.main.bounds.width * 0.74, 260) }

    var body: some View {
        ScreenContainer {
            heroSection
                .onLongPressGesture(minimumDuration: 1.2) {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        revealInternalAccess.toggle()
                    }
                }

            if revealInternalAccess {
                HStack {
                    InternalDemoBadge()
                    Spacer()
                    NavigationLink("管理預覽入口") { AdminPreviewView(hasInternalAccess: true) }
                        .font(Theme.Typography.caption.weight(.semibold))
                        .foregroundStyle(Theme.Colors.primary)
                }
                .transition(.opacity)
            }

            todayActionSection
            serviceHubSection
            recentNewsSection
            compactPreviewSection
        }
    }

    private var heroSection: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: Theme.Radius.xl, style: .continuous)
                .fill(LinearGradient(colors: [Theme.Colors.primary, Color(hex: "#3A4F66")], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(alignment: .topTrailing) {
                    Circle()
                        .fill(.white.opacity(0.14))
                        .frame(width: 180)
                        .blur(radius: 2)
                        .offset(x: 50, y: -70)
                }

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                Text("TECM EDUCATION")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.8))

                Text("精緻學習服務中樞")
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(2)

                Text("為家長整合課程、預約與學習追蹤入口，第一眼就掌握孩子本週重點。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(.white.opacity(0.9))
                    .lineLimit(2)

                HStack(spacing: Theme.Spacing.sm) {
                    NavigationLink(destination: BookingView()) {
                        Text("開始預約")
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                            .foregroundStyle(Theme.Colors.primary)
                            .padding(.vertical, Theme.Spacing.sm)
                            .frame(maxWidth: .infinity)
                            .background(.white)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                    }

                    NavigationLink(destination: CoursesView()) {
                        Text("查看課程")
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white)
                            .padding(.vertical, Theme.Spacing.sm)
                            .frame(maxWidth: .infinity)
                            .background(.white.opacity(0.12))
                            .overlay {
                                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                    .stroke(.white.opacity(0.35), lineWidth: 0.8)
                            }
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                    }
                }
                .buttonStyle(PressableScaleStyle())
            }
            .padding(Theme.Spacing.lg)
        }
        .frame(height: 232)
        .subtleCardShadow()
    }

    private var todayActionSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title: "今天可以做什麼", subtitle: "以 dashboard 方式快速進入常用任務")
            QuickActionGrid(actions: dashboardActions) { item in
                switch item.title {
                case "立即預約": return AnyView(BookingView())
                case "課程地圖": return AnyView(CoursesView())
                case "家長中心": return AnyView(ParentCenterView())
                default: return AnyView(AgentView())
                }
            }
        }
    }

    private var serviceHubSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title: "精選服務區", subtitle: "先看摘要，再進入完整內容")

            Picker("服務切換", selection: $selectedSegment) {
                ForEach(HomeServiceSegment.allCases) { segment in
                    Text(segment.rawValue).tag(segment)
                }
            }
            .pickerStyle(.segmented)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.md) {
                    ForEach(serviceCards, id: \.title) { entry in
                        NavigationLink(destination: entry.destination) {
                            serviceCard(title: entry.title, summary: entry.summary, hint: entry.hint)
                        }
                        .buttonStyle(PressableScaleStyle())
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var recentNewsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                SectionHeader(title: "教育中心最近消息", subtitle: "活動成果與家長口碑的精選更新")
                Spacer()
                NavigationLink("查看全部") { ParentCenterView() }
                    .font(Theme.Typography.caption.weight(.semibold))
                    .foregroundStyle(Theme.Colors.primary)
            }

            if let featuredNews {
                NavigationLink(destination: ParentCenterView()) { FeaturedNewsCard(item: featuredNews) }
                    .buttonStyle(PressableScaleStyle())
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.md) {
                    ForEach(supportingNews) { item in
                        NavigationLink(destination: ParentCenterView()) { SupportingNewsCard(item: item) }
                            .buttonStyle(PressableScaleStyle())
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var compactPreviewSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title: "快速預覽", subtitle: "首頁只保留關鍵入口，詳情進入二級頁")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.md) {
                    NavigationLink(destination: LearningCenterView()) {
                        CompactPreviewCard(title: "學習示範", subtitle: "查看課後練習與本週任務", icon: "doc.text.image", tint: Theme.Colors.accent)
                    }
                    .buttonStyle(PressableScaleStyle())

                    NavigationLink(destination: AgentView()) {
                        CompactPreviewCard(title: "TECM AGENT", subtitle: "先回答常見疑問，再接顧問支援", icon: "waveform.path.ecg.text", tint: Theme.Colors.success)
                    }
                    .buttonStyle(PressableScaleStyle())

                    NavigationLink(destination: ParentCenterView()) {
                        CompactPreviewCard(title: "家長中心入口", subtitle: "掌握預約進度與通知摘要", icon: "tray.full", tint: Theme.Colors.primary)
                    }
                    .buttonStyle(PressableScaleStyle())
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var serviceCards: [(title: String, summary: String, hint: String, destination: AnyView)] {
        switch selectedSegment {
        case .featuredCourses:
            return featuredCourses.map {
                (title: $0.title, summary: $0.summary, hint: "\($0.level) ・ \($0.ageGroup)", destination: AnyView(CoursesView()))
            }
        case .trialBooking:
            return [
                ("一對一體驗評估", "以孩子現況建立建議路線，確認首月學習重點。", "預約流程 3 步驟", AnyView(BookingView())),
                ("家長諮詢時段", "與顧問討論學習節奏與課後陪伴策略。", "可選晚間時段", AnyView(BookingView())),
                ("校區參觀", "安排校區導覽，先了解上課環境與支持服務。", "每週開放", AnyView(BookingView()))
            ]
        case .parentTools:
            return [
                ("預約狀態", "即時查看已提交、待確認與已完成安排。", "同步家長中心", AnyView(ParentCenterView())),
                ("學習中心", "每週更新延伸練習，幫助孩子穩定複習。", "10 分鐘模組", AnyView(LearningCenterView())),
                ("常見問題", "先以 Agent 快速定位問題，再接真人顧問。", "FAQ + 顧問支援", AnyView(AgentView()))
            ]
        }
    }

    private func serviceCard(title: String, summary: String, hint: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text(title)
                .font(Theme.Typography.cardTitle)
                .foregroundStyle(Theme.Colors.textPrimary)
                .lineLimit(2)
            Text(summary)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
                .lineLimit(3)
            Spacer()
            HStack {
                Text(hint)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.blueGray)
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.Colors.primary)
            }
        }
        .padding(Theme.Spacing.md)
        .frame(width: serviceCardWidth, minHeight: 152, alignment: .leading)
        .background(Theme.Colors.card)
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.5), lineWidth: 0.8)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        .subtleCardShadow()
    }
}

#Preview {
    NavigationStack { HomeView() }
}
