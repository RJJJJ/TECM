import SwiftUI

struct CoursesView: View {
    private let levels = ["全部", "Foundation", "Core", "Advanced"]
    @State private var selectedLevel = "全部"

    private var recommended: [Course] {
        MockDataStore.courses.filter(\.recommended)
    }

    private var filteredCourses: [Course] {
        selectedLevel == "全部" ? MockDataStore.courses : MockDataStore.courses.filter { $0.level == selectedLevel }
    }

    var body: some View {
        ScreenContainer(title: "課程") {
            SectionHeader(title: "程度篩選", subtitle: "快速理解每門課程的定位")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.xs) {
                    ForEach(levels, id: \.self) { level in
                        Button {
                            selectedLevel = level
                        } label: {
                            StatusChip(title: level, color: selectedLevel == level ? Theme.Colors.primary : Theme.Colors.blueGray)
                        }
                        .buttonStyle(PressableScaleStyle())
                    }
                }
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                SectionHeader(title: "推薦課程", subtitle: "先看高匹配度課程")
                ForEach(recommended) { course in
                    CourseCard(course: course)
                }
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                SectionHeader(title: "完整課程列表", subtitle: "含年齡、重點與校區資訊")
                ForEach(filteredCourses) { course in
                    ElevatedCard {
                        CourseCardContent(course: course)
                        NavigationLink("查看課程詳情與預約") {
                            BookingView(prefilledCourse: course.title)
                        }
                        .font(Theme.Typography.caption.weight(.semibold))
                        .foregroundStyle(Theme.Colors.primary)
                    }
                }
            }
        }
    }
}

private struct CourseCardContent: View {
    let course: Course

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(course.title)
                .font(Theme.Typography.cardTitle)
            Text(course.summary)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
            HStack(spacing: Theme.Spacing.xs) {
                ForEach(course.focusTags, id: \.self) { tag in
                    StatusChip(title: tag, color: Theme.Colors.accent)
                }
            }
            Text("程度：\(course.level)  ・  年齡：\(course.ageGroup)")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
            Text("\(course.schedule) ・ \(course.campus)")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

#Preview {
    NavigationStack { CoursesView() }
}
