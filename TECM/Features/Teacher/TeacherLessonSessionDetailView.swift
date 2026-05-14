import SwiftUI

struct TeacherLessonSessionDetailView: View {
    let session: TeacherTodaySession

    var body: some View {
        ScreenContainer(title: "課堂詳情") {
            PremiumSectionHeader(
                eyebrow: "TeacherLessonSessionDetailView",
                title: "第 \(session.sequenceNo) 堂：\(session.lessonTitle)",
                subtitle: "\(session.cohortName) · \(session.timeRangeText)"
            )

            ElevatedCard {
                Text("教學內容")
                    .font(Theme.Typography.cardTitle)
                Text(session.teachingContent ?? "此課堂尚未輸入教學內容。")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            NavigationLink {
                TeacherAttendanceView(session: session)
            } label: {
                QuickActionTile(
                    title: "學生出席",
                    subtitle: "標記出席、缺席或請假，缺席會自動產生補課任務。",
                    icon: "checklist.checked"
                )
            }
            .buttonStyle(PressableScaleStyle())
        }
    }
}
