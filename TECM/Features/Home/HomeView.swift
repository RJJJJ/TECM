import SwiftUI

struct HomeView: View {
    @State private var revealInternalAccess = false

    private var featuredCourses: [Course] {
        MockDataStore.courses.filter(\.recommended)
    }

    var body: some View {
        ScreenContainer(title: "首頁") {
            HeroBanner(title: "精品教育服務體驗", subtitle: "以清晰學習路徑、穩定服務流程，陪伴家長與孩子長期成長")
                .onLongPressGesture(minimumDuration: 1.2) {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        revealInternalAccess.toggle()
                    }
                }

            if revealInternalAccess {
                HStack {
                    InternalDemoBadge()
                    Spacer()
                    NavigationLink("管理預覽入口") {
                        AdminPreviewView(hasInternalAccess: true)
                    }
                    .font(Theme.Typography.caption.weight(.semibold))
                    .foregroundStyle(Theme.Colors.primary)
                }
                .transition(.opacity)
            }

            sectionTodayActions
            sectionFeaturedCourse
            sectionBookingCTA
            sectionParentAndLearning
            sectionAgentPreview
        }
    }

    private var sectionTodayActions: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title: "今日可操作", subtitle: "快速進入最常用服務")
            HStack(spacing: Theme.Spacing.md) {
                NavigationLink(destination: BookingView()) {
                    QuickActionTile(title: "立即預約", subtitle: "安排試堂時段", icon: "calendar.badge.plus")
                }
                NavigationLink(destination: CoursesView()) {
                    QuickActionTile(title: "瀏覽課程", subtitle: "查看程度與重點", icon: "book.closed")
                }
            }
            .buttonStyle(PressableScaleStyle())
        }
    }

    private var sectionFeaturedCourse: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title: "精選課程", subtitle: "由顧問團隊推薦的核心路線")
            ForEach(featuredCourses) { course in
                NavigationLink(destination: CoursesView()) {
                    CourseCard(course: course)
                }
                .buttonStyle(PressableScaleStyle())
            }
        }
    }

    private var sectionBookingCTA: some View {
        ElevatedCard {
            Text("需要顧問協助排課？")
                .font(Theme.Typography.cardTitle)
            Text("預約流程將以 3 步驟完成，並提供提交後狀態追蹤。")
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
            NavigationLink(destination: BookingView()) {
                HStack {
                    Text("開始預約流程")
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                    Image(systemName: "arrow.right")
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

    private var sectionParentAndLearning: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title: "家長服務與延伸學習", subtitle: "以家庭需求為主，學習中心作輔助")
            NavigationLink(destination: ParentCenterView()) {
                QuickActionTile(title: "家長中心", subtitle: "查看近期預約、課程與通知", icon: "person.crop.circle")
            }
            .buttonStyle(PressableScaleStyle())

            NavigationLink(destination: LearningCenterView()) {
                QuietCard {
                    Text("學習中心預覽")
                        .font(Theme.Typography.cardTitle)
                    Text("提供課後延伸資源與練習入口，非刷題導向。")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
            .buttonStyle(PressableScaleStyle())
        }
    }

    private var sectionAgentPreview: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title: "TECM AGENT", subtitle: "目前提供 FAQ 導向的助理服務")
            NavigationLink(destination: AgentView()) {
                OutlineCard {
                    Text("常見問題快速解答")
                        .font(Theme.Typography.cardTitle)
                    Text("後續可升級為真實對話 Agent。")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
            .buttonStyle(PressableScaleStyle())
        }
    }
}

#Preview {
    NavigationStack { HomeView() }
}
