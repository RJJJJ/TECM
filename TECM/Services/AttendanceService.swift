import Foundation
import Supabase

protocol AttendanceServicing {
    func fetchSessionStudents(sessionID: UUID) async throws -> [TeacherSessionStudent]
    func submitAttendance(sessionID: UUID, students: [TeacherSessionStudent]) async throws
}

struct AttendanceService: AttendanceServicing {
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
    }

    func fetchSessionStudents(sessionID: UUID) async throws -> [TeacherSessionStudent] {
        let rows: [TeacherSessionStudentDTO] = try await client
            .rpc("get_lesson_session_students", params: SessionStudentsRPCParams(targetSessionID: sessionID.uuidString))
            .execute()
            .value

        return rows.map { $0.toModel() }
    }

    func submitAttendance(sessionID: UUID, students: [TeacherSessionStudent]) async throws {
        let records = students.map {
            AttendanceSubmitPayload(
                studentID: $0.id,
                status: $0.status.rawValue,
                internalNote: nil
            )
        }

        try await client
            .rpc(
                "submit_attendance",
                params: SubmitAttendanceRPCParams(targetSessionID: sessionID.uuidString, records: records)
            )
            .execute()
    }
}

private struct SessionStudentsRPCParams: Encodable {
    let targetSessionID: String

    enum CodingKeys: String, CodingKey {
        case targetSessionID = "target_session_id"
    }
}

private struct SubmitAttendanceRPCParams: Encodable {
    let targetSessionID: String
    let records: [AttendanceSubmitPayload]

    enum CodingKeys: String, CodingKey {
        case targetSessionID = "target_session_id"
        case records
    }
}
