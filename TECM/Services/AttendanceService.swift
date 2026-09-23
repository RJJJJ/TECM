import Foundation
import Supabase

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
        do {
            let rows: [TeacherSessionStudentDTO] = try await client
                .rpc(
                    "get_teacher_attendance_roster",
                    params: TeacherAttendanceRosterRPCParams(targetSessionID: sessionID)
                )
                .execute()
                .value

            return rows.map { $0.toModel() }
        } catch {
            throw AttendanceServiceError.from(error)
        }
    }

    func submitAttendance(request: AttendanceSubmissionRequest) async throws -> AttendanceSubmissionResult {
        do {
            let result: TeacherAttendanceSubmissionResultDTO = try await client
                .rpc(
                    "submit_teacher_attendance",
                    params: SubmitTeacherAttendanceRPCParams(request: request)
                )
                .execute()
                .value

            return result.toModel()
        } catch {
            throw AttendanceServiceError.from(error)
        }
    }
}
