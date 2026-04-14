import Foundation
import Combine

@MainActor
final class AgentViewModel: ObservableObject {
    @Published private(set) var faqItems: [FAQItem] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let service: FAQServicing

    init(service: FAQServicing = FAQService()) {
        self.service = service
    }

    var topics: [String] {
        ["全部"] + Array(Set(faqItems.map(\.topic))).sorted()
    }

    func loadFAQ() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            faqItems = try await service.fetchFAQ()
        } catch {
            faqItems = []
            errorMessage = error.localizedDescription
        }
    }
}
