import SwiftUI

struct CoursesView: View {
    private let levels = ["全部", "Foundation", "Core", "Advanced"]
    @State private var selectedLevel = "全部"

    private var filteredCourses: [Course] {
        selectedLevel == "全部" ? MockDataStore.courses : MockDataStore.courses.filter { $0.level == selectedLevel }
    }

    var body: some View {
        ScreenContainer(title: "課程") {
            PremiumSectionHeader(eyebrow: "Curated Catalog", title: "為不同階段設計的學習路線", subtitle: "先了解課程定位，再安排體驗與銜接方向")

            NavigationLink(destination: LearningCenterView()) {
                QuickActionTile(title: "考前練習中心", subtitle: "Python / Scratch / C++ 試卷練習入口", icon: "checklist")
            }
            .buttonStyle(PressableScaleStyle())

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

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                ForEach(filteredCourses) { course in
                    CuratedCourseCard(course: course)
                        .premiumEntrance(delay: 0.02)
                    HStack {
                        Text("學習成果：\(course.focusTags.joined(separator: "、"))")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                        Spacer()
                        NavigationLink("了解更多") {
                            CourseDetailView(course: course)
                        }
                        .font(Theme.Typography.caption.weight(.semibold))
                        .foregroundStyle(Theme.Colors.primary)
                    }
                    .padding(.horizontal, Theme.Spacing.sm)
                    .padding(.bottom, Theme.Spacing.sm)
                }
            }
        }
    }
}

#Preview {
    NavigationStack { CoursesView() }
}
