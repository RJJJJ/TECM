import SwiftUI

struct TeacherAttendanceView: View {
    let session: TeacherTodaySession
    @StateObject private var viewModel = TeacherAttendanceViewModel()

    var body: some View {
        ScreenContainer(title: "學生出席") {
            PremiumSectionHeader(
                eyebrow: "TeacherAttendanceView",
                title: "第 \(session.sequenceNo) 堂學生出席",
                subtitle: "標記缺席或請假後，系統會按課堂內容自動產生補課任務。"
            )

            if viewModel.isLoading {
                VStack(spacing: Theme.Spacing.md) {
                    SkeletonCard()
                    SkeletonCard()
                }
            } else if let errorMessage = viewModel.errorMessage {
                EmptyStateView(title: "無法載入學生出席", message: errorMessage)
            } else if viewModel.students.isEmpty {
                EmptyStateView(title: "暫無學生", message: "此考試班的 active 學生會顯示在這裡。")
            } else {
                ForEach(viewModel.students) { student in
                    ElevatedCard {
                        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                            HStack {
                                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                                    Text(student.displayName)
                                        .font(Theme.Typography.body.weight(.semibold))
                                    if let schoolName = student.schoolName {
                                        Text(schoolName)
                                            .font(Theme.Typography.caption)
                                            .foregroundStyle(Theme.Colors.textSecondary)
                                    }
                                }
                                Spacer()
                                Image(systemName: student.status.systemImage)
                                    .foregroundStyle(Theme.Colors.primary)
                            }

                            Picker("出席狀態", selection: binding(for: student.id)) {
                                ForEach([ExamAttendanceStatus.present, ExamAttendanceStatus.absent, ExamAttendanceStatus.excused]) { status in
                                    Text(status.title).tag(status)
                                }
                            }
                            .pickerStyle(.segmented)
                        }
                    }
                }

                PrimaryCTAButton(
                    title: viewModel.isSubmitting ? "提交中..." : "提交點名",
                    isDisabled: viewModel.isSubmitting
                ) {
                    Task { await viewModel.submit(sessionID: session.id) }
                }
                .frame(height: 48)
            }

            if let successMessage = viewModel.successMessage {
                SuccessStateView(title: "已提交", message: successMessage)
            }
        }
        .task {
            await viewModel.load(sessionID: session.id)
        }
    }

    private func binding(for studentID: UUID) -> Binding<ExamAttendanceStatus> {
        Binding(
            get: {
                viewModel.students.first(where: { $0.id == studentID })?.status ?? .present
            },
            set: { newStatus in
                viewModel.updateStatus(for: studentID, status: newStatus)
            }
        )
    }
}
