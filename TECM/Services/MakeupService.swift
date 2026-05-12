import Foundation

protocol MakeupServicing {
    func fetchParentMakeupSummaries() async throws -> [ParentExamAttendanceSummary]
}

struct MakeupService: MakeupServicing {
    private let examCohortService: ExamCohortServicing

    init(examCohortService: ExamCohortServicing = ExamCohortService()) {
        self.examCohortService = examCohortService
    }

    func fetchParentMakeupSummaries() async throws -> [ParentExamAttendanceSummary] {
        try await examCohortService.fetchParentAttendanceSummary()
    }
}
