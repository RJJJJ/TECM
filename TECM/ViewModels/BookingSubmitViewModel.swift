import Foundation

@MainActor
final class BookingSubmitViewModel: ObservableObject {
    @Published private(set) var profile: ParentProfile?
    @Published private(set) var isPreparing = false
    @Published private(set) var isSubmitting = false
    @Published private(set) var submitErrorMessage: String?
    @Published private(set) var prepareErrorMessage: String?
    @Published private(set) var submittedBooking: BookingRecord?

    private let parentProfileService: ParentProfileServicing
    private let bookingService: BookingServicing

    init(
        parentProfileService: ParentProfileServicing = ParentProfileService(),
        bookingService: BookingServicing = BookingService()
    ) {
        self.parentProfileService = parentProfileService
        self.bookingService = bookingService
    }

    func prepare(userID: UUID?) async {
        guard let userID else {
            profile = nil
            return
        }

        isPreparing = true
        prepareErrorMessage = nil
        defer { isPreparing = false }

        do {
            profile = try await parentProfileService.fetchCurrentParentProfile(userID: userID)
        } catch {
            profile = nil
            prepareErrorMessage = error.localizedDescription
        }
    }

    func submit(formInput: BookingFormInput) async -> Bool {
        guard let profile else {
            submitErrorMessage = "請先登入家長帳號再提交預約。"
            return false
        }

        isSubmitting = true
        submitErrorMessage = nil
        defer { isSubmitting = false }

        do {
            submittedBooking = try await bookingService.submitBooking(input: formInput, profile: profile)
            return true
        } catch {
            submitErrorMessage = error.localizedDescription
            return false
        }
    }

    func resetSubmissionState() {
        submittedBooking = nil
        submitErrorMessage = nil
    }
}
