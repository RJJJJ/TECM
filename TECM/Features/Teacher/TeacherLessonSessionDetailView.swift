import SwiftUI

struct TeacherLessonSessionDetailView: View {
    let session: TeacherTodaySession

    var body: some View {
        ScreenContainer(title: "Lesson Detail") {
            PremiumSectionHeader(
                eyebrow: "TeacherLessonSessionDetailView",
                title: "Lesson \(session.sequenceNo): \(session.lessonTitle)",
                subtitle: "\(session.cohortName) · \(session.timeRangeText)"
            )

            ElevatedCard {
                Text("Teaching content")
                    .font(Theme.Typography.cardTitle)
                Text(session.teachingContent ?? "No teaching content has been entered for this lesson.")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            NavigationLink {
                TeacherAttendanceView(session: session)
            } label: {
                QuickActionTile(
                    title: "Take attendance",
                    subtitle: "Mark present, excused, absent or makeup completed.",
                    icon: "checklist.checked"
                )
            }
            .buttonStyle(PressableScaleStyle())
        }
    }
}
