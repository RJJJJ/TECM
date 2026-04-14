import Foundation

@MainActor
final class HomeViewModel: ObservableObject {
    @Published private(set) var featuredNews: [NewsItem] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let service: NewsServicing

    init(service: NewsServicing = NewsService()) {
        self.service = service
    }

    func loadNews() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            featuredNews = try await service.fetchActiveNews(limit: 3)
        } catch {
            featuredNews = []
            errorMessage = error.localizedDescription
        }
    }
}
