import Foundation
import Combine

@MainActor
final class CoursesViewModel: ObservableObject {
    @Published private(set) var courses: [Course] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let service: CourseServicing

    init(service: CourseServicing = CourseService()) {
        self.service = service
    }

    func loadCourses() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            courses = try await service.fetchCourses()
        } catch {
            courses = []
            errorMessage = error.localizedDescription
        }
    }
}
