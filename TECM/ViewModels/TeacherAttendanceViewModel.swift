import Foundation
import Combine

@MainActor
final class TeacherTodayClassViewModel: ObservableObject {
    @Published private(set) var sessions: [TeacherTodaySession] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let examCohortService: ExamCohortServicing

    init(examCohortService: ExamCohortServicing = ExamCohortService()) {
        self.examCohortService = examCohortService
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            sessions = try await examCohortService.fetchTeacherTodaySessions()
        } catch {
            sessions = []
            errorMessage = error.localizedDescription
        }
    }
}

@MainActor
final class TeacherAttendanceViewModel: ObservableObject {
    @Published var students: [TeacherSessionStudent] = []
    @Published var correctionReason = ""
    @Published private(set) var isLoading = false
    @Published private(set) var isSubmitting = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var noticeMessage: String?
    @Published private(set) var successMessage: String?
    @Published private(set) var requiresAuthoritativeReload = false
    @Published private(set) var conflictingDrafts: [TeacherSessionStudent] = []

    private struct AttendanceBaseline: Equatable {
        let status: ExamAttendanceStatus
        let revision: Int64?
    }

    private struct PreservedDraft {
        let student: TeacherSessionStudent
        let baseline: AttendanceBaseline?
    }

    private let attendanceService: AttendanceServicing
    private var authoritativeBaseline: [UUID: AttendanceBaseline] = [:]
    private var pendingRequests: [UUID: AttendanceSubmissionRequest] = [:]
    private var pendingStudentSnapshots: [UUID: TeacherSessionStudent] = [:]
    private var uncertainRequestIDs: Set<UUID> = []
    private var preservedDrafts: [UUID: PreservedDraft] = [:]
    private var explicitlyDiscardedDraftIDs: Set<UUID> = []
    private var errorOccurredDuringLoad = false

    var errorFeedbackTitle: String {
        guard errorOccurredDuringLoad else { return "提交未完成" }
        return uncertainRequestIDs.isEmpty ? "無法載入學生出席" : "提交結果待確認"
    }

    init(attendanceService: AttendanceServicing = AttendanceService()) {
        self.attendanceService = attendanceService
    }

    func load(sessionID: UUID) async {
        guard !isSubmitting, !isLoading, !Task.isCancelled else { return }

        let wasAuthoritativeReloadRequired = requiresAuthoritativeReload
        errorOccurredDuringLoad = true
        isLoading = true
        errorMessage = nil
        noticeMessage = nil
        successMessage = nil
        defer { isLoading = false }

        do {
            let roster = try await attendanceService.fetchSessionStudents(sessionID: sessionID)
            guard !Task.isCancelled else { return }
            reconcileAuthoritativeRoster(roster)
            if wasAuthoritativeReloadRequired {
                noticeMessage = "已重新載入；未衝突的草稿已保留，請確認後提交。"
            }
        } catch {
            guard !Task.isCancelled else { return }
            preserveCurrentDrafts()
            clearActiveRosterForReload()
            requiresAuthoritativeReload = true
            errorMessage = (error as? AttendanceServiceError) == .authorizationDenied
                ? "目前無法取得這堂課的學生出席權限，請確認帳號後重新載入。"
                : "無法載入學生出席，請稍後重新載入。"
        }
    }

    func updateStatus(for studentID: UUID, status: ExamAttendanceStatus) {
        guard !isSubmitting, !isLoading, !requiresAuthoritativeReload else { return }
        guard let index = students.firstIndex(where: { $0.id == studentID }) else { return }
        guard students[index].isEditable, status.isWritable else { return }
        let isSubmissionConflict = hasSubmissionConflict(studentID: studentID)
        guard pendingRequests[studentID] == nil || isSubmissionConflict else { return }

        students[index].status = status
        if isSubmissionConflict {
            clearPendingRequest(for: studentID)
        }
        conflictingDrafts.removeAll { $0.id == studentID }
        preservedDrafts.removeValue(forKey: studentID)
        explicitlyDiscardedDraftIDs.remove(studentID)
        successMessage = nil
        noticeMessage = nil
    }

    func requiresSelectionConfirmation(studentID: UUID) -> Bool {
        explicitlyDiscardedDraftIDs.contains(studentID)
            || conflictingDrafts.contains(where: { $0.id == studentID })
    }

    func confirmCurrentSelection(studentID: UUID) {
        guard requiresSelectionConfirmation(studentID: studentID),
              canEdit(studentID: studentID),
              let currentStatus = students.first(where: { $0.id == studentID })?.status else {
            return
        }
        updateStatus(for: studentID, status: currentStatus)
    }

    func canEdit(studentID: UUID) -> Bool {
        guard !isSubmitting, !isLoading, !requiresAuthoritativeReload else { return false }
        guard let student = students.first(where: { $0.id == studentID }) else { return false }
        if pendingRequests[studentID] != nil {
            return hasSubmissionConflict(studentID: studentID) && student.isEditable
        }
        return student.isEditable
    }

    func isPending(studentID: UUID) -> Bool {
        pendingRequests[studentID] != nil
    }

    func pendingSubmission(for studentID: UUID) -> AttendanceSubmissionRequest? {
        pendingRequests[studentID]
    }

    func authoritativeStatusTitle(for studentID: UUID) -> String? {
        guard let baseline = authoritativeBaseline[studentID] else { return nil }
        guard baseline.revision == nil else { return baseline.status.title }
        guard let student = students.first(where: { $0.id == studentID }) else {
            return "紀錄不完整，請重新載入"
        }
        return student.attendanceStatusRawValue == nil
            ? "尚未記錄"
            : "紀錄不完整，請重新載入"
    }

    func hasSubmissionConflict(studentID: UUID) -> Bool {
        pendingRequests[studentID] != nil
            && conflictingDrafts.contains(where: { $0.id == studentID })
    }

    func canDiscardDraft(studentID: UUID) -> Bool {
        guard !isLoading, !isSubmitting else { return false }
        guard visibleUnsubmittedDrafts.contains(where: { $0.id == studentID }) else {
            return false
        }
        guard pendingRequests[studentID] != nil else { return true }
        return hasSubmissionConflict(studentID: studentID)
            && !requiresAuthoritativeReload
    }

    func discardConflictingDraft(studentID: UUID) {
        guard canDiscardDraft(studentID: studentID) else { return }
        if pendingRequests[studentID] != nil {
            clearPendingRequest(for: studentID)
        }
        conflictingDrafts.removeAll { $0.id == studentID }
        preservedDrafts.removeValue(forKey: studentID)
        explicitlyDiscardedDraftIDs.insert(studentID)
    }

    var hasPendingUncertainRequests: Bool {
        !pendingRequests.isEmpty
    }

    var visibleUnsubmittedDrafts: [TeacherSessionStudent] {
        var drafts = conflictingDrafts
        for preservedDraft in preservedDrafts.values
            where !drafts.contains(where: { $0.id == preservedDraft.student.id }) {
            drafts.append(preservedDraft.student)
        }
        return drafts.sorted { $0.displayName < $1.displayName }
    }

    var unavailablePendingStudents: [TeacherSessionStudent] {
        pendingRequests.keys
            .filter { pendingStudentID in
                !students.contains(where: { $0.id == pendingStudentID })
            }
            .compactMap { pendingStudentSnapshots[$0] }
            .sorted { $0.displayName < $1.displayName }
    }

    func submit(sessionID: UUID, sessionEnded: Bool = false) async {
        guard !isSubmitting, !isLoading, !requiresAuthoritativeReload, !Task.isCancelled else { return }
        errorOccurredDuringLoad = false

        isSubmitting = true
        errorMessage = nil
        noticeMessage = nil
        successMessage = nil
        defer { isSubmitting = false }

        let trimmedReason = correctionReason.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidates = students.filter { student in
            guard !conflictingDrafts.contains(where: { $0.id == student.id }) else { return false }
            if pendingRequests[student.id] != nil {
                return true
            }
            guard student.isEditable else { return false }
            return needsSubmission(student)
        }

        guard !candidates.isEmpty else {
            if !visibleUnsubmittedDrafts.isEmpty {
                noticeMessage = "仍有保留的草稿，請重新載入後確認或放棄。"
            } else if !pendingRequests.isEmpty {
                noticeMessage = "仍有待確認的提交，請重新載入最新狀態。"
            } else {
                noticeMessage = "目前沒有新的出席變更。"
            }
            return
        }

        let hasNewPayload = candidates.contains { pendingRequests[$0.id] == nil }
        if sessionEnded && hasNewPayload && trimmedReason.isEmpty {
            errorMessage = "課堂已結束，請填寫更正原因後再提交。"
            return
        }

        var completedCount = 0

        for student in candidates {
            guard !Task.isCancelled else { return }
            let request: AttendanceSubmissionRequest
            if let pendingRequest = pendingRequests[student.id] {
                request = pendingRequest
            } else {
                let newRequest = AttendanceSubmissionRequest(
                    sessionID: sessionID,
                    studentID: student.id,
                    status: student.status,
                    expectedRevision: student.attendanceRevision,
                    reason: trimmedReason,
                    requestID: "ios:\(UUID().uuidString)"
                )
                pendingRequests[student.id] = newRequest
                pendingStudentSnapshots[student.id] = pendingSnapshot(
                    for: newRequest,
                    currentStudent: student
                )
                request = newRequest
            }

            do {
                let result = try await attendanceService.submitAttendance(request: request)
                clearPendingRequest(for: student.id)
                applySuccessfulSubmission(request: request, result: result)
                completedCount += 1

                if result.idempotentReplay == true {
                    requiresAuthoritativeReload = true
                    if Task.isCancelled {
                        preserveCurrentDrafts()
                        clearActiveRosterForReload()
                        errorMessage = "提交結果已確認，請重新載入最新出席狀態。"
                        return
                    }
                    let reloaded = await reloadAuthoritativeRoster(sessionID: sessionID)
                    if Task.isCancelled {
                        if !reloaded {
                            preserveCurrentDrafts()
                            clearActiveRosterForReload()
                            errorMessage = "提交結果已確認，請重新載入最新出席狀態。"
                        }
                        return
                    }
                    if reloaded {
                        noticeMessage = "已確認該請求曾完成，並已重新載入；其餘未衝突的草稿已保留，請確認後再次提交。"
                    } else {
                        errorMessage = "提交結果已確認，但無法重新載入最新出席狀態；請重新載入後再編輯。"
                    }
                    return
                }

                guard !Task.isCancelled else { return }
            } catch {
                let serviceError = AttendanceServiceError.from(error)
                if serviceError == .attendanceChanged,
                   uncertainRequestIDs.contains(student.id) {
                    // A stale response after an earlier uncertain outcome is
                    // still unsafe to interpret as a non-commit. Preserve the
                    // original request and draft until explicit recovery.
                    let draft = pendingStudentSnapshots[student.id]
                        ?? pendingSnapshot(for: request, currentStudent: student)
                    appendConflictingDraftIfNeeded(draft)
                    requiresAuthoritativeReload = true
                    preserveCurrentDrafts()
                    clearActiveRosterForReload()
                    errorMessage = uncertainConflictMessage(completedCount: completedCount)
                } else if serviceError == .attendanceChanged {
                    let draft = pendingStudentSnapshots[student.id]
                        ?? pendingSnapshot(for: request, currentStudent: student)
                    clearPendingRequest(for: student.id)
                    conflictingDrafts.removeAll { $0.id == student.id }
                    conflictingDrafts.append(draft)
                    requiresAuthoritativeReload = true
                    if Task.isCancelled {
                        errorMessage = "出席紀錄已變更，請重新載入最新狀態後再提交。"
                        return
                    }
                    let reloaded = await reloadAuthoritativeRoster(sessionID: sessionID)
                    if Task.isCancelled {
                        if !reloaded {
                            preserveCurrentDrafts()
                            clearActiveRosterForReload()
                            errorMessage = "出席紀錄已變更，且無法重新載入最新狀態；請重新載入後再提交。"
                        }
                        return
                    }
                    if reloaded {
                        errorMessage = "出席紀錄已變更，已重新載入最新狀態；請確認後再提交。"
                    } else {
                        errorMessage = "出席紀錄已變更，且無法重新載入最新狀態；請重新載入後再提交。"
                    }
                } else if serviceError == .authorizationDenied {
                    if !uncertainRequestIDs.contains(student.id) {
                        clearPendingRequest(for: student.id)
                    }
                    // Authorization failure invalidates the active roster. Keep
                    // any unresolved request and drafts until a fresh read.
                    requiresAuthoritativeReload = true
                    preserveCurrentDrafts()
                    clearActiveRosterForReload()
                    errorMessage = partialFailureMessage(
                        completedCount: completedCount,
                        error: error
                    )
                } else if isUncertainOutcome(serviceError) {
                    uncertainRequestIDs.insert(student.id)
                    errorMessage = partialFailureMessage(
                        completedCount: completedCount,
                        error: error
                    )
                } else if uncertainRequestIDs.contains(student.id) {
                    // A later denial or lifecycle rejection cannot establish that
                    // an earlier uncertain request never reached the server.
                    requiresAuthoritativeReload = true
                    preserveCurrentDrafts()
                    clearActiveRosterForReload()
                    errorMessage = partialFailureMessage(
                        completedCount: completedCount,
                        error: error
                    )
                } else {
                    clearPendingRequest(for: student.id)
                    errorMessage = partialFailureMessage(
                        completedCount: completedCount,
                        error: error
                    )
                }
                return
            }
        }

        if !conflictingDrafts.isEmpty {
            noticeMessage = "本次提交已完成，但仍有保留的衝突草稿需要確認。"
        } else if !unavailablePendingStudents.isEmpty {
            noticeMessage = "本次提交已完成，但仍有名單外待確認的提交；請重新載入最新狀態。"
        } else {
            successMessage = "已提交，缺席學生會自動產生補課任務。"
        }
    }

    private func needsSubmission(_ student: TeacherSessionStudent) -> Bool {
        guard student.isEditable else { return false }
        guard !explicitlyDiscardedDraftIDs.contains(student.id) else { return false }
        if pendingRequests[student.id] != nil {
            return true
        }
        guard let baseline = authoritativeBaseline[student.id] else { return true }
        if student.attendanceRevision == nil && baseline.revision == nil {
            return true
        }
        return student.status != baseline.status
            || student.attendanceRevision != baseline.revision
    }

    private func applySuccessfulSubmission(
        request: AttendanceSubmissionRequest,
        result: AttendanceSubmissionResult
    ) {
        guard let index = students.firstIndex(where: { $0.id == request.studentID }) else { return }

        students[index].status = request.status
        students[index].attendanceRevision = result.revision
        authoritativeBaseline[request.studentID] = AttendanceBaseline(
            status: request.status,
            revision: result.revision
        )
    }

    private func reconcileAuthoritativeRoster(_ roster: [TeacherSessionStudent]) {
        let originalStudents = students
        let originalBaselines = authoritativeBaseline
        let existingConflictIDs = Set(conflictingDrafts.map(\.id))
        var drafts = preservedDrafts

        for student in originalStudents {
            guard pendingRequests[student.id] == nil,
                  !existingConflictIDs.contains(student.id),
                  hasUnsentDraft(student, baseline: originalBaselines[student.id]) else {
                continue
            }
            drafts[student.id] = PreservedDraft(
                student: student,
                baseline: originalBaselines[student.id]
            )
        }

        students = roster
        authoritativeBaseline = roster.reduce(into: [:]) { result, student in
            result[student.id] = AttendanceBaseline(
                status: student.status,
                revision: student.attendanceRevision
            )
        }
        preservedDrafts.removeAll()
        requiresAuthoritativeReload = false

        for draft in drafts.values {
            guard pendingRequests[draft.student.id] == nil,
                  !conflictingDrafts.contains(where: { $0.id == draft.student.id }) else {
                continue
            }

            if let index = students.firstIndex(where: { $0.id == draft.student.id }),
               let draftBaseline = draft.baseline,
               authoritativeBaseline[draft.student.id] == draftBaseline,
               students[index].isEditable {
                students[index].status = draft.student.status
            } else {
                appendConflictingDraftIfNeeded(draft.student)
            }
        }
    }

    private func reloadAuthoritativeRoster(sessionID: UUID) async -> Bool {
        isLoading = true
        defer { isLoading = false }

        do {
            let roster = try await attendanceService.fetchSessionStudents(sessionID: sessionID)
            guard !Task.isCancelled else { return false }
            reconcileAuthoritativeRoster(roster)
            return true
        } catch {
            guard !Task.isCancelled else { return false }
            preserveCurrentDrafts()
            clearActiveRosterForReload()
            requiresAuthoritativeReload = true
            return false
        }
    }

    private func hasUnsentDraft(
        _ student: TeacherSessionStudent,
        baseline: AttendanceBaseline?
    ) -> Bool {
        guard pendingRequests[student.id] == nil,
              !conflictingDrafts.contains(where: { $0.id == student.id }) else {
            return false
        }
        guard let baseline else { return true }
        return student.status != baseline.status
            || student.attendanceRevision != baseline.revision
    }

    private func preserveCurrentDrafts() {
        let currentBaselines = authoritativeBaseline
        for student in students {
            guard hasUnsentDraft(student, baseline: currentBaselines[student.id]) else {
                continue
            }
            preservedDrafts[student.id] = PreservedDraft(
                student: student,
                baseline: currentBaselines[student.id]
            )
        }
    }

    private func clearActiveRosterForReload() {
        students.removeAll()
        authoritativeBaseline.removeAll()
    }

    private func clearPendingRequest(for studentID: UUID) {
        pendingRequests.removeValue(forKey: studentID)
        pendingStudentSnapshots.removeValue(forKey: studentID)
        uncertainRequestIDs.remove(studentID)
    }

    private func pendingSnapshot(
        for request: AttendanceSubmissionRequest,
        currentStudent: TeacherSessionStudent
    ) -> TeacherSessionStudent {
        TeacherSessionStudent(
            id: request.studentID,
            displayName: currentStudent.displayName,
            schoolName: currentStudent.schoolName,
            status: request.status,
            attendanceRevision: currentStudent.attendanceRevision,
            attendanceStatusRawValue: currentStudent.attendanceStatusRawValue
        )
    }

    private func appendConflictingDraftIfNeeded(_ draft: TeacherSessionStudent) {
        guard !conflictingDrafts.contains(where: { $0.id == draft.id }) else { return }
        conflictingDrafts.append(draft)
    }

    private func uncertainConflictMessage(completedCount: Int) -> String {
        let message = "原提交結果仍未確認；重試遇到出席紀錄已變更，請重新載入最新狀態後重新選擇或放棄。"
        if completedCount > 0 {
            return "部分提交完成（已處理 \(completedCount) 位）；\(message)"
        }
        return message
    }

    private func isUncertainOutcome(_ error: AttendanceServiceError) -> Bool {
        switch error {
        case .retryable, .generic:
            return true
        case .attendanceChanged,
             .authorizationDenied,
             .reasonRequired,
             .sessionNotStarted,
             .sessionCancelled,
             .sessionFinalized:
            return false
        }
    }

    private func partialFailureMessage(completedCount: Int, error: Error) -> String {
        let failure = safeErrorMessage(error)
        if completedCount > 0 {
            return "部分提交完成（已處理 \(completedCount) 位）；\(failure)"
        }
        return failure
    }

    private func safeErrorMessage(_ error: Error) -> String {
        if let serviceError = error as? AttendanceServiceError {
            return serviceError.localizedDescription
        }
        return "操作無法完成，請稍後再試。"
    }
}
