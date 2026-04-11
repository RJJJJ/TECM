import SwiftUI

struct CourseDetailView: View {
    let course: Course

    var body: some View {
        ScreenContainer(title: "課程詳情") {
            ElevatedCard {
                Text(course.category)
                    .font(Theme.Typography.chip)
                    .foregroundStyle(Theme.Colors.accent)
                Text(course.title)
                    .font(Theme.Typography.heroTitle)
                    .foregroundStyle(Theme.Colors.textPrimary)
                Text(course.summary)
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            detailSection(title: "課程定位", content: "以 \(course.focusTags.joined(separator: "、")) 為主軸，讓孩子在可理解的節奏中建立穩定能力，而非短期填鴨。")
            detailSection(title: "適合對象", content: "\(course.ageGroup) 孩子；希望在 \(course.category) 建立基礎到進階能力的家庭。")
            detailSection(title: "學習內容摘要", content: "課堂會透過情境任務、拆題示範與回饋，讓孩子理解『為什麼這樣做』，再建立可複用的方法。")
            detailSection(title: "課程特色", content: "小班互動、顧問式進度追蹤、家長可理解的學習回饋，確保每一步都有明確目標。")
            detailSection(title: "可銜接方向", content: "完成本階段後可銜接下一級課程或專題型學習路線，保持能力連續成長。")

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
    }

    private func detailSection(title: String, content: String) -> some View {
        ElevatedCard {
            Text(title)
                .font(Theme.Typography.cardTitle)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text(content)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
                .lineSpacing(2)
        }
    }
}

#Preview {
    NavigationStack {
        CourseDetailView(course: MockDataStore.courses[1])
    }
}
