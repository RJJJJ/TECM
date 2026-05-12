import Foundation

protocol TeacherServicing {
    func fetchTodaySessions() async throws -> [TeacherTodaySession]
    func fetchSessionStudents(sessionID: UUID) async throws -> [TeacherSessionStudent]
}

struct TeacherService: TeacherServicing {
    private let examCohortService: ExamCohortServicing
    private let attendanceService: AttendanceServicing

    init(
        examCohortService: ExamCohortServicing = ExamCohortService(),
        attendanceService: AttendanceServicing = AttendanceService()
    ) {
        self.examCohortService = examCohortService
        self.attendanceService = attendanceService
    }

    func fetchTodaySessions() async throws -> [TeacherTodaySession] {
        try await examCohortService.fetchTeacherTodaySessions()
    }

    func fetchSessionStudents(sessionID: UUID) async throws -> [TeacherSessionStudent] {
        try await attendanceService.fetchSessionStudents(sessionID: sessionID)
    }
}
