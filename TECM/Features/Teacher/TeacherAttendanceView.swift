import SwiftUI

struct TeacherAttendanceView: View {
    let session: TeacherTodaySession
    @StateObject private var viewModel = TeacherAttendanceViewModel()

    var body: some View {
        ScreenContainer(title: "Attendance") {
            PremiumSectionHeader(
                eyebrow: "TeacherAttendanceView",
                title: "Lesson \(session.sequenceNo) attendance",
                subtitle: "Absent and excused records create lesson-specific makeup tasks."
            )

            if viewModel.isLoading {
                VStack(spacing: Theme.Spacing.md) {
                    SkeletonCard()
                    SkeletonCard()
                }
            } else if let errorMessage = viewModel.errorMessage {
                EmptyStateView(title: "Unable to load attendance", message: errorMessage)
            } else if viewModel.students.isEmpty {
                EmptyStateView(title: "No students", message: "Active cohort students will appear here.")
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

                            Picker("Status", selection: binding(for: student.id)) {
                                ForEach(ExamAttendanceStatus.allCases) { status in
                                    Text(status.title).tag(status)
                                }
                            }
                            .pickerStyle(.segmented)
                        }
                    }
                }

                PrimaryCTAButton(
                    title: viewModel.isSubmitting ? "Submitting..." : "Submit attendance",
                    isDisabled: viewModel.isSubmitting
                ) {
                    Task { await viewModel.submit(sessionID: session.id) }
                }
                .frame(height: 48)
            }

            if let successMessage = viewModel.successMessage {
                SuccessStateView(title: "Submitted", message: successMessage)
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
