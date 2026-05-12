import Foundation
import Supabase

protocol ExamCohortServicing {
    func fetchTeacherTodaySessions() async throws -> [TeacherTodaySession]
    func fetchParentAttendanceSummary() async throws -> [ParentExamAttendanceSummary]
}

struct ExamCohortService: ExamCohortServicing {
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
    }

    func fetchTeacherTodaySessions() async throws -> [TeacherTodaySession] {
        let rows: [TeacherTodaySessionDTO] = try await client
            .rpc("get_teacher_today_sessions")
            .execute()
            .value

        return rows.map { $0.toModel() }
    }

    func fetchParentAttendanceSummary() async throws -> [ParentExamAttendanceSummary] {
        let rows: [ParentExamAttendanceSummaryDTO] = try await client
            .rpc("get_parent_attendance_summary")
            .execute()
            .value

        return rows.map { $0.toModel() }
    }
}
