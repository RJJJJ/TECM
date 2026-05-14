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
    @Published private(set) var isLoading = false
    @Published private(set) var isSubmitting = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var successMessage: String?

    private let attendanceService: AttendanceServicing

    init(attendanceService: AttendanceServicing = AttendanceService()) {
        self.attendanceService = attendanceService
    }

    func load(sessionID: UUID) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            students = try await attendanceService.fetchSessionStudents(sessionID: sessionID)
        } catch {
            students = []
            errorMessage = error.localizedDescription
        }
    }

    func updateStatus(for studentID: UUID, status: ExamAttendanceStatus) {
        guard let index = students.firstIndex(where: { $0.id == studentID }) else { return }
        students[index].status = status
    }

    func submit(sessionID: UUID) async {
        isSubmitting = true
        errorMessage = nil
        successMessage = nil
        defer { isSubmitting = false }

        do {
            try await attendanceService.submitAttendance(sessionID: sessionID, students: students)
            successMessage = "已提交，缺席學生會自動產生補課任務。"
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
