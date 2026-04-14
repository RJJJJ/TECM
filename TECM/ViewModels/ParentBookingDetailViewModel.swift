import Foundation

@MainActor
final class ParentBookingDetailViewModel: ObservableObject {
    @Published private(set) var detail: ParentBookingDetail?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let bookingID: UUID
    private let parentID: UUID
    private let bookingService: BookingServicing

    init(
        bookingID: UUID,
        parentID: UUID,
        bookingService: BookingServicing = BookingService()
    ) {
        self.bookingID = bookingID
        self.parentID = parentID
        self.bookingService = bookingService
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            detail = try await bookingService.fetchBookingDetail(bookingID: bookingID, parentID: parentID)
        } catch {
            detail = nil
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        await load()
    }
}
