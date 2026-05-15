import SwiftUI

struct TeacherTodayClassView: View {
    @StateObject private var viewModel = TeacherTodayClassViewModel()
    @EnvironmentObject private var authViewModel: AuthViewModel

    var body: some View {
        ScreenContainer(title: "今日課堂", showBackButton: true) {
            PremiumSectionHeader(
                eyebrow: "教師課堂",
                title: "今日課堂",
                subtitle: "只顯示已指派給目前登入教師的考試班課堂。"
            )

            if authViewModel.currentRole != .teacher && authViewModel.currentRole != .admin {
                EmptyStateView(title: "需要教師權限", message: "請使用已建立 teacher_profile 的教師帳號登入後點名。")
            } else if viewModel.isLoading {
                VStack(spacing: Theme.Spacing.md) {
                    SkeletonCard()
                    SkeletonCard()
                }
            } else if let errorMessage = viewModel.errorMessage {
                EmptyStateView(title: "無法載入今日課堂", message: errorMessage)
            } else if viewModel.sessions.isEmpty {
                EmptyStateView(title: "今日暫無課堂", message: "已指派的考試班課堂會顯示在這裡。")
            } else {
                ForEach(viewModel.sessions) { session in
                    NavigationLink(value: TeacherRoute.sessionDetail(session)) {
                        TeacherSessionCard(session: session)
                    }
                    .buttonStyle(PressableScaleStyle())
                }
            }
        }
        .task {
            await loadIfTeacher()
        }
        .refreshable {
            await loadIfTeacher()
        }
    }

    private func loadIfTeacher() async {
        guard authViewModel.currentRole == .teacher || authViewModel.currentRole == .admin else { return }
        await viewModel.load()
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
                    Text("\(session.subject) / \(session.level) · 第 \(session.sequenceNo) 堂")
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
                    Text("已記錄")
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
