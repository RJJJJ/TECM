import Foundation

@MainActor
final class BookingViewModel: ObservableObject {
    @Published private(set) var campuses: [String] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let service: CampusServicing

    init(service: CampusServicing = CampusService()) {
        self.service = service
    }

    func loadCampuses() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            campuses = try await service.fetchCampuses()
        } catch {
            campuses = []
            errorMessage = error.localizedDescription
        }
    }
}
