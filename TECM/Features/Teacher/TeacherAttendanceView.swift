import SwiftUI

struct TeacherAttendanceView: View {
    let session: TeacherTodaySession
    @StateObject private var viewModel = TeacherAttendanceViewModel()
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var tabRouter: TabRouter

    private var sessionHasEnded: Bool {
        Date() >= session.endsAt
    }

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
            } else {
                if let errorMessage = viewModel.errorMessage {
                    errorFeedbackCard(message: errorMessage)
                }

                if let noticeMessage = viewModel.noticeMessage {
                    QuietCard {
                        Label(noticeMessage, systemImage: "info.circle")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                }

                if let successMessage = viewModel.successMessage {
                    SuccessStateView(title: "已提交", message: successMessage)
                }

                if !viewModel.visibleUnsubmittedDrafts.isEmpty {
                    QuietCard {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("以下草稿尚未儲存；重新載入後請確認是否套用，或放棄此草稿。")
                            ForEach(viewModel.visibleUnsubmittedDrafts) { draft in
                                Text("\(draft.displayName)：原先選擇「\(draft.status.title)」")
                                Button("放棄此草稿") {
                                    viewModel.discardConflictingDraft(studentID: draft.id)
                                }
                                .disabled(viewModel.isLoading || viewModel.isSubmitting)
                            }
                        }
                        .font(Theme.Typography.caption)
                    }
                }

                if !viewModel.unavailablePendingStudents.isEmpty {
                    QuietCard {
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            Text("以下待確認的提交目前不在最新名單，請重新載入；學生再次出現後才會重試。")
                            ForEach(viewModel.unavailablePendingStudents) { student in
                                Text("\(student.displayName)：待確認的原提交：\(student.status.title)")
                            }
                            Button("重新載入最新狀態") {
                                Task { await viewModel.load(sessionID: session.id) }
                            }
                            .font(Theme.Typography.caption.weight(.semibold))
                            .foregroundStyle(Theme.Colors.primary)
                            .disabled(viewModel.isLoading || viewModel.isSubmitting)
                        }
                        .font(Theme.Typography.caption)
                    }
                }

                if viewModel.students.isEmpty {
                    EmptyStateView(
                        title: viewModel.errorMessage == nil ? "暫無學生" : "無法載入學生出席",
                        message: viewModel.errorMessage ?? "此考試班的 active 學生會顯示在這裡。"
                    )
                } else {
                    if sessionHasEnded {
                        correctionReasonCard
                    }

                    LazyVStack(spacing: Theme.Spacing.sm) {
                        ForEach(viewModel.students) { student in
                            TeacherAttendanceStudentRow(
                                student: student,
                                selection: binding(for: student.id),
                                isEditable: viewModel.canEdit(studentID: student.id),
                                pendingSubmission: viewModel.pendingSubmission(for: student.id),
                                authoritativeStatusTitle: viewModel.authoritativeStatusTitle(for: student.id)
                            )
                        }
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
        !viewModel.isLoading
            && !viewModel.students.isEmpty
            && !viewModel.requiresAuthoritativeReload
    }

    private var submitBar: some View {
        bottomActionBar {
            PrimaryCTAButton(
                title: viewModel.isSubmitting ? "提交中..." : "提交出席紀錄",
                isDisabled: viewModel.isSubmitting
            ) {
                Task {
                    await viewModel.submit(
                        sessionID: session.id,
                        sessionEnded: sessionHasEnded
                    )
                }
            }
            .frame(height: 48)
        }
    }

    private var correctionReasonCard: some View {
        ElevatedCard {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Text("更正原因（會套用至本次需要提交的學生）")
                    .font(Theme.Typography.cardTitle)
                    .foregroundStyle(Theme.Colors.textPrimary)
                TextField("例如：家長臨時請假", text: $viewModel.correctionReason, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .disabled(
                        viewModel.isSubmitting
                            || viewModel.requiresAuthoritativeReload
                    )
                if viewModel.hasPendingUncertainRequests {
                    Text("重試會沿用該筆原有資料；此處新原因只套用至尚未送出的請求。")
                        .font(Theme.Typography.caption)
                }
                Text("課堂結束後，任何新增或變更都必須填寫原因。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }

    private func errorFeedbackCard(message: String) -> some View {
        ElevatedCard {
            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Theme.Colors.warning)
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("提交未完成")
                        .font(Theme.Typography.cardTitle)
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Text(message)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)

                    if viewModel.requiresAuthoritativeReload {
                        Button("重新載入最新狀態") {
                            Task { await viewModel.load(sessionID: session.id) }
                        }
                        .font(Theme.Typography.caption.weight(.semibold))
                        .foregroundStyle(Theme.Colors.primary)
                        .disabled(viewModel.isLoading || viewModel.isSubmitting)
                    }
                }
            }
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
    let isEditable: Bool
    let pendingSubmission: AttendanceSubmissionRequest?
    let authoritativeStatusTitle: String?

    private var isPending: Bool {
        pendingSubmission != nil
    }

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

                    if isPending {
                        Text("待重試")
                            .font(Theme.Typography.caption.weight(.semibold))
                            .foregroundStyle(Theme.Colors.warning)
                    }

                    Image(systemName: student.status.systemImage)
                        .foregroundStyle(Theme.Colors.primary)
                        .accessibilityHidden(true)
                }

                if let pendingSubmission {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text("伺服器目前狀態：\(authoritativeStatusTitle ?? "尚未取得")")
                            .font(Theme.Typography.caption.weight(.semibold))
                            .foregroundStyle(Theme.Colors.textSecondary)
                        Text("待確認的原提交：\(pendingSubmission.status.title)")
                            .font(Theme.Typography.caption.weight(.semibold))
                            .foregroundStyle(Theme.Colors.textSecondary)
                        if !pendingSubmission.reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text("原提交原因：\(pendingSubmission.reason)")
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Colors.textSecondary)
                        }
                        Text("重試會沿用原提交資料")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                } else if isEditable {
                    Picker("出席狀態", selection: $selection) {
                        ForEach([ExamAttendanceStatus.present, .absent, .excused]) { status in
                            Text(status.title).tag(status)
                        }
                    }
                    .pickerStyle(.segmented)
                    .disabled(!isEditable)
                } else {
                    HStack(spacing: Theme.Spacing.xs) {
                        Text(student.statusDisplayTitle)
                            .font(Theme.Typography.caption.weight(.semibold))
                            .foregroundStyle(Theme.Colors.textSecondary)
                        Text("唯讀")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                }
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
                    TeacherAttendanceStudentRow(
                        student: student,
                        selection: $statuses[index],
                        isEditable: true,
                        pendingSubmission: nil,
                        authoritativeStatusTitle: nil
                    )
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
