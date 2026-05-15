import SwiftUI

struct TeacherAttendanceView: View {
    let session: TeacherTodaySession
    @StateObject private var viewModel = TeacherAttendanceViewModel()
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var tabRouter: TabRouter

    var body: some View {
        ScreenContainer(title: "學生出席", showBackButton: true, bottomSpacing: .rootTab) {
            PremiumSectionHeader(
                eyebrow: "學生出席",
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
                if let successMessage = viewModel.successMessage {
                    SuccessStateView(title: "已提交", message: successMessage)
                }

                LazyVStack(spacing: Theme.Spacing.sm) {
                    ForEach(viewModel.students) { student in
                        TeacherAttendanceStudentRow(
                            student: student,
                            selection: binding(for: student.id)
                        )
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if viewModel.successMessage != nil {
                successActionBar
            } else if shouldShowSubmitBar {
                submitBar
            }
        }
        .task {
            await viewModel.load(sessionID: session.id)
        }
    }

    private var shouldShowSubmitBar: Bool {
        !viewModel.isLoading && !viewModel.students.isEmpty && viewModel.successMessage == nil
    }

    private var submitBar: some View {
        bottomActionBar {
            PrimaryCTAButton(
                title: viewModel.isSubmitting ? "提交中..." : "提交出席紀錄",
                isDisabled: viewModel.isSubmitting
            ) {
                Task { await viewModel.submit(sessionID: session.id) }
            }
            .frame(height: 48)
        }
    }

    private var successActionBar: some View {
        bottomActionBar {
            VStack(spacing: Theme.Spacing.sm) {
                SecondaryCTAButton(title: "返回課堂詳情") {
                    dismiss()
                }

                PrimaryCTAButton(title: "完成並返回今日課堂") {
                    tabRouter.resetTeacherFlow()
                }
            }
        }
    }

    private func bottomActionBar<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: Theme.Spacing.xs) {
            content()
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.top, Theme.Spacing.sm)
        .padding(.bottom, Theme.Spacing.sm)
        .background(.ultraThinMaterial)
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

private struct TeacherAttendanceStudentRow: View {
    let student: TeacherSessionStudent
    @Binding var selection: ExamAttendanceStatus

    var body: some View {
        ElevatedCard {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text(student.displayName)
                            .font(Theme.Typography.body.weight(.semibold))
                            .foregroundStyle(Theme.Colors.textPrimary)
                            .lineLimit(1)

                        if let schoolName = student.schoolName, !schoolName.isEmpty {
                            Text(schoolName)
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Colors.textSecondary)
                                .lineLimit(1)
                        }
                    }

                    Spacer(minLength: Theme.Spacing.sm)

                    Image(systemName: selection.systemImage)
                        .foregroundStyle(Theme.Colors.primary)
                        .accessibilityHidden(true)
                }

                Picker("出席狀態", selection: $selection) {
                    ForEach([ExamAttendanceStatus.present, .absent, .excused]) { status in
                        Text(status.title).tag(status)
                    }
                }
                .pickerStyle(.segmented)
            }
        }
    }
}

private struct TeacherAttendanceRowsPreview: View {
    @State private var statuses = Array(repeating: ExamAttendanceStatus.present, count: 13)

    var body: some View {
        ScrollView {
            LazyVStack(spacing: Theme.Spacing.sm) {
                ForEach(Array(mockStudents.enumerated()), id: \.element.id) { index, student in
                    TeacherAttendanceStudentRow(student: student, selection: $statuses[index])
                }
            }
            .padding()
        }
    }

    private var mockStudents: [TeacherSessionStudent] {
        (1...13).map { index in
            TeacherSessionStudent(
                id: UUID(),
                displayName: "學生 \(index)",
                schoolName: index.isMultiple(of: 2) ? "TECM 小學" : nil,
                status: statuses[index - 1]
            )
        }
    }
}

#Preview("13 students") {
    TeacherAttendanceRowsPreview()
}
