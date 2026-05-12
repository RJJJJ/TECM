import SwiftUI

struct TeacherTodayClassView: View {
    @StateObject private var viewModel = TeacherTodayClassViewModel()
    @EnvironmentObject private var authViewModel: AuthViewModel

    var body: some View {
        ScreenContainer(title: "Teacher Classes") {
            PremiumSectionHeader(
                eyebrow: "TeacherTodayClassView",
                title: "Today's exam classes",
                subtitle: "Only sessions assigned to the signed-in teacher are shown."
            )

            if authViewModel.currentRole != .teacher && authViewModel.currentRole != .admin {
                EmptyStateView(title: "Teacher access required", message: "Sign in with a teacher account to take attendance.")
            } else if viewModel.isLoading {
                VStack(spacing: Theme.Spacing.md) {
                    SkeletonCard()
                    SkeletonCard()
                }
            } else if let errorMessage = viewModel.errorMessage {
                EmptyStateView(title: "Unable to load classes", message: errorMessage)
            } else if viewModel.sessions.isEmpty {
                EmptyStateView(title: "No class today", message: "Assigned exam cohort sessions will appear here.")
            } else {
                ForEach(viewModel.sessions) { session in
                    NavigationLink {
                        TeacherLessonSessionDetailView(session: session)
                    } label: {
                        TeacherSessionCard(session: session)
                    }
                    .buttonStyle(PressableScaleStyle())
                }
            }
        }
        .task {
            await viewModel.load()
        }
        .refreshable {
            await viewModel.load()
        }
    }
}

private struct TeacherSessionCard: View {
    let session: TeacherTodaySession

    var body: some View {
        ElevatedCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(session.cohortName)
                        .font(Theme.Typography.cardTitle)
                    Text("\(session.subject) / \(session.level) · Lesson \(session.sequenceNo)")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                    Text(session.lessonTitle)
                        .font(Theme.Typography.body)
                    Text(session.timeRangeText)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.blueGray)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: Theme.Spacing.xs) {
                    Text("\(session.attendanceCount)/\(session.studentCount)")
                        .font(Theme.Typography.cardTitle)
                    Text("recorded")
                        .font(Theme.Typography.chip)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
        }
    }
}

#Preview {
    NavigationStack { TeacherTodayClassView() }
        .environmentObject(AuthViewModel())
}
