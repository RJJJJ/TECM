import Combine
import Foundation

@MainActor
final class ParentBookingDetailViewModel: ObservableObject {
    @Published private(set) var detail: ParentBookingDetail?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let bookingID: UUID
    private let parentID: UUID
    private let bookingService: BookingServicing
    private var loadGeneration = 0

    init(
        bookingID: UUID,
        parentID: UUID,
        bookingService: BookingServicing = BookingService()
    ) {
        self.bookingID = bookingID
        self.parentID = parentID
        self.bookingService = bookingService
    }

    func load(isAuthorizedParent: Bool) async {
        loadGeneration += 1
        let generation = loadGeneration
        detail = nil
        isLoading = false
        errorMessage = nil

        guard isAuthorizedParent else { return }

        isLoading = true
        defer {
            if loadGeneration == generation {
                isLoading = false
            }
        }

        do {
            let loadedDetail = try await bookingService.fetchBookingDetail(
                bookingID: bookingID,
                parentID: parentID
            )
            guard loadGeneration == generation else { return }
            detail = loadedDetail
        } catch {
            guard loadGeneration == generation else { return }
            detail = nil
            errorMessage = error.localizedDescription
        }
    }
}
