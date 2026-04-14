import SwiftUI

struct CoursesView: View {
    private let levels = ["全部", "Foundation", "Core", "Advanced"]
    @State private var selectedLevel = "全部"
    @StateObject private var viewModel = CoursesViewModel()

    private var filteredCourses: [Course] {
        selectedLevel == "全部" ? viewModel.courses : viewModel.courses.filter { $0.level == selectedLevel }
    }

    var body: some View {
        ScreenContainer(title: "課程") {
            PremiumSectionHeader(eyebrow: "Curated Catalog", title: "為不同階段設計的學習路線", subtitle: "先了解課程定位，再安排體驗與銜接方向")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.xs) {
                    ForEach(levels, id: \.self) { level in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) { selectedLevel = level }
                        } label: {
                            FAQChip(title: level, selected: selectedLevel == level)
                        }
                        .buttonStyle(PressableScaleStyle())
                    }
                }
            }

            if viewModel.isLoading {
                VStack(spacing: Theme.Spacing.md) {
                    SkeletonCard()
                    SkeletonCard()
                }
            } else if let errorMessage = viewModel.errorMessage {
                EmptyStateView(title: "課程資料載入失敗", message: errorMessage)
            } else if filteredCourses.isEmpty {
                EmptyStateView(title: "目前沒有符合條件的課程", message: "請切換 level 或稍後再試。")
            } else {
                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    ForEach(filteredCourses) { course in
                        CuratedCourseCard(course: course)
                            .premiumEntrance(delay: 0.02)
                        HStack(alignment: .center) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(course.ageGroup) · \(course.level)")
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(Theme.Colors.blueGray)
                                Text("學習重點：\(course.focusTags.joined(separator: "、"))")
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(Theme.Colors.textSecondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            NavigationLink("了解更多") {
                                CourseDetailView(course: course)
                            }
                            .font(Theme.Typography.caption.weight(.semibold))
                            .foregroundStyle(Theme.Colors.primary)
                        }
                        .padding(.horizontal, Theme.Spacing.sm)
                        .padding(.top, -4)
                        .padding(.bottom, Theme.Spacing.xs)
                    }
                }
            }

            Text("其他學習工具可於首頁精選入口進入。")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
                .padding(.horizontal, Theme.Spacing.sm)
        }
        .task {
            await viewModel.loadCourses()
        }
    }
}

#Preview {
    NavigationStack { CoursesView() }
}
