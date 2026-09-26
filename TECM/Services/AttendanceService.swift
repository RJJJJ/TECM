import Foundation
import Supabase

#if DEBUG
private enum AttendanceRPCDiagnostics {
    struct Scope {
        let sessionID: UUID
        let studentID: UUID
        let correlationID = UUID()
    }

    static func scope(sessionID: UUID, studentID: UUID? = nil) -> Scope? {
        let environment = ProcessInfo.processInfo.environment
        guard environment["TECM_NETWORK_DIAGNOSTICS"] == "1",
              let configuredSessionID = environment["TECM_NATIVE_ATTENDANCE_SESSION_ID"].flatMap(UUID.init(uuidString:)),
              let configuredStudentID = environment["TECM_NATIVE_ATTENDANCE_STUDENT_ID"].flatMap(UUID.init(uuidString:)),
              sessionID == configuredSessionID,
              studentID == nil || studentID == configuredStudentID else {
            return nil
        }
        return Scope(sessionID: configuredSessionID, studentID: configuredStudentID)
    }

    static func recordFetchStarted(_ scope: Scope) {
        record(scope: scope, operation: "fetch_roster", event: "started")
    }

    static func recordFetchCompleted(_ scope: Scope, rows: [TeacherSessionStudentDTO]) {
        let ownedRows = rows.filter { $0.studentID == scope.studentID }
        let details: [String: Any] = [
            "total_count": rows.count,
            "owned_count": ownedRows.count,
            "owned_rows": ownedRows.map { row in
                [
                    "student_id": row.studentID.uuidString,
                    "attendance_status": nullable(row.attendanceStatus),
                    "attendance_revision": nullable(row.attendanceRevision)
                ]
            }
        ]
        record(scope: scope, operation: "fetch_roster", event: "completed", details: details)
    }

    static func recordSubmitStarted(_ scope: Scope, request: AttendanceSubmissionRequest) {
        record(scope: scope, operation: "submit_attendance", event: "started", request: request)
    }

    static func recordSubmitCompleted(
        _ scope: Scope,
        request: AttendanceSubmissionRequest,
        result: TeacherAttendanceSubmissionResultDTO
    ) {
        let details: [String: Any] = [
            "changed": result.changed,
            "revision": result.revision,
            "replayed": nullable(result.idempotentReplay)
        ]
        record(
            scope: scope,
            operation: "submit_attendance",
            event: "completed",
            request: request,
            details: details
        )
    }

    static func recordFailed(
        _ scope: Scope,
        operation: String,
        error: Error,
        mappedError: AttendanceServiceError,
        request: AttendanceSubmissionRequest? = nil
    ) {
        let nsError = error as NSError
        let details: [String: Any] = [
            "error_domain": nsError.domain,
            "error_code": nsError.code,
            "service_error": serviceErrorName(mappedError)
        ]
        record(
            scope: scope,
            operation: operation,
            event: "failed",
            request: request,
            details: details
        )
    }

    private static func record(
        scope: Scope,
        operation: String,
        event: String,
        request: AttendanceSubmissionRequest? = nil,
        details: [String: Any] = [:]
    ) {
        var output: [String: Any] = [
            "timestamp": timestamp(Date()),
            "evidence_layer": "attendance_service_decoded_result",
            "operation": operation,
            "event": event,
            "correlation_uuid": scope.correlationID.uuidString,
            "attendance_session_id": scope.sessionID.uuidString,
            "attendance_student_id": scope.studentID.uuidString
        ]
        if let request {
            output.merge(submissionRequestRecord(request)) { _, new in new }
        }
        output.merge(details) { _, new in new }
        NetworkDiagnosticsDelegate.appendAttendanceEvent(output)
    }

    private static func submissionRequestRecord(_ request: AttendanceSubmissionRequest) -> [String: Any] {
        var output: [String: Any] = [
            "request_id": request.requestID,
            "student_id": request.studentID.uuidString,
            "attendance_session_id": request.sessionID.uuidString,
            "status": request.status.rawValue,
            "expected_revision": nullable(request.expectedRevision),
            "reason_present": !request.reason.isEmpty
        ]

        if request.reason.isEmpty {
            output["reason"] = ""
            output["reason_redacted"] = false
        } else if let allowedReason = ProcessInfo.processInfo.environment["TECM_NATIVE_ATTENDANCE_REASON"],
                  isSyntheticReason(allowedReason),
                  request.reason == allowedReason {
            output["reason"] = request.reason
            output["reason_redacted"] = false
        } else {
            output["reason_redacted"] = true
        }
        return output
    }

    private static func isSyntheticReason(_ value: String) -> Bool {
        value.range(of: #"^UAT[a-f0-9]{8}$"#, options: .regularExpression) != nil
    }

    private static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func nullable<Value>(_ value: Value?) -> Any {
        guard let value else { return NSNull() }
        return value
    }

    private static func serviceErrorName(_ error: AttendanceServiceError) -> String {
        switch error {
        case .attendanceChanged: return "attendance_changed"
        case .retryable: return "retryable"
        case .authorizationDenied: return "authorization_denied"
        case .reasonRequired: return "reason_required"
        case .sessionNotStarted: return "session_not_started"
        case .sessionCancelled: return "session_cancelled"
        case .sessionFinalized: return "session_finalized"
        case .generic: return "generic"
        }
    }
}
#endif

protocol AttendanceServicing {
    func fetchSessionStudents(sessionID: UUID) async throws -> [TeacherSessionStudent]
    func submitAttendance(request: AttendanceSubmissionRequest) async throws -> AttendanceSubmissionResult
}

enum AttendanceServiceError: LocalizedError, Equatable {
    case attendanceChanged
    case retryable
    case authorizationDenied
    case reasonRequired
    case sessionNotStarted
    case sessionCancelled
    case sessionFinalized
    case generic

    var errorDescription: String? {
        switch self {
        case .attendanceChanged:
            return "出席紀錄已變更，請重新載入後再試。"
        case .retryable:
            return "提交正在處理中或暫時無法完成，請稍後重試。"
        case .authorizationDenied:
            return "你目前沒有權限更新這堂課的出席紀錄。"
        case .reasonRequired:
            return "課堂已結束，請填寫更正原因後再試。"
        case .sessionNotStarted:
            return "課堂尚未開始，暫時不能提交出席紀錄。"
        case .sessionCancelled:
            return "課堂已取消，不能提交出席紀錄。"
        case .sessionFinalized:
            return "這堂課的出席紀錄已定案，不能再修改。"
        case .generic:
            return "提交出席紀錄失敗，請稍後再試。"
        }
    }

    static func from(_ error: Error) -> Self {
        if let attendanceError = error as? AttendanceServiceError {
            return attendanceError
        }
        // Transport cancellation is not a cancelled lesson. The server may
        // already have committed, so retries must retain the same request ID.
        if error is URLError || error is CancellationError {
            return .retryable
        }

        let descriptions = [
            error.localizedDescription,
            String(describing: error)
        ]

        let normalized = descriptions.joined(separator: " ").lowercased()

        if normalized.contains("attendance has changed")
            || normalized.contains("attendance_has_changed") {
            return .attendanceChanged
        }

        if normalized.contains("attendance update is already in progress") {
            return .retryable
        }

        if normalized.contains("permission denied")
            || normalized.contains("teacher role required")
            || normalized.contains("authenticated user required")
            || normalized.contains("teacher is not assigned to this session")
            || normalized.contains("student is not active in this session cohort") {
            return .authorizationDenied
        }

        if normalized.contains("attendance correction reason is required") {
            return .reasonRequired
        }

        if normalized.contains("future session attendance is not allowed") {
            return .sessionNotStarted
        }

        if normalized.contains("attendance cannot be submitted for a cancelled session") {
            return .sessionCancelled
        }

        if normalized.contains("attendance is linked to finalized leave or makeup records") {
            return .sessionFinalized
        }

        return .generic
    }
}

struct AttendanceService: AttendanceServicing {
    private let clientResolver: SupabaseClientResolver
    private var client: SupabaseClient { clientResolver.client }

    init(client: SupabaseClient? = nil) {
        clientResolver = SupabaseClientResolver(client: client)
    }

    func fetchSessionStudents(sessionID: UUID) async throws -> [TeacherSessionStudent] {
#if DEBUG
        let diagnosticScope = AttendanceRPCDiagnostics.scope(sessionID: sessionID)
        if let diagnosticScope {
            AttendanceRPCDiagnostics.recordFetchStarted(diagnosticScope)
        }
#endif
        do {
            let rows: [TeacherSessionStudentDTO] = try await client
                .rpc(
                    "get_teacher_attendance_roster",
                    params: TeacherAttendanceRosterRPCParams(targetSessionID: sessionID)
                )
                .execute()
                .value

#if DEBUG
            if let diagnosticScope {
                AttendanceRPCDiagnostics.recordFetchCompleted(diagnosticScope, rows: rows)
            }
#endif
            return rows.map { $0.toModel() }
        } catch {
            let mappedError = AttendanceServiceError.from(error)
#if DEBUG
            if let diagnosticScope {
                AttendanceRPCDiagnostics.recordFailed(
                    diagnosticScope,
                    operation: "fetch_roster",
                    error: error,
                    mappedError: mappedError
                )
            }
#endif
            throw mappedError
        }
    }

    func submitAttendance(request: AttendanceSubmissionRequest) async throws -> AttendanceSubmissionResult {
#if DEBUG
        let diagnosticScope = AttendanceRPCDiagnostics.scope(
            sessionID: request.sessionID,
            studentID: request.studentID
        )
        if let diagnosticScope {
            AttendanceRPCDiagnostics.recordSubmitStarted(diagnosticScope, request: request)
        }
#endif
        do {
            let result: TeacherAttendanceSubmissionResultDTO = try await client
                .rpc(
                    "submit_teacher_attendance",
                    params: SubmitTeacherAttendanceRPCParams(request: request)
                )
                .execute()
                .value

#if DEBUG
            if let diagnosticScope {
                AttendanceRPCDiagnostics.recordSubmitCompleted(
                    diagnosticScope,
                    request: request,
                    result: result
                )
            }
#endif
            return result.toModel()
        } catch {
            let mappedError = AttendanceServiceError.from(error)
#if DEBUG
            if let diagnosticScope {
                AttendanceRPCDiagnostics.recordFailed(
                    diagnosticScope,
                    operation: "submit_attendance",
                    error: error,
                    mappedError: mappedError,
                    request: request
                )
            }
#endif
            throw mappedError
        }
    }
}
