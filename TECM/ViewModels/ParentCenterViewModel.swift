import Foundation

@MainActor
final class ParentCenterViewModel: ObservableObject {
    @Published private(set) var profile: ParentProfile?
    @Published private(set) var reservations: [ParentReservationSummaryItem] = []
    @Published private(set) var notifications: [ParentNotificationItem] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let parentProfileService: ParentProfileServicing
    private let bookingService: BookingServicing
    private let notificationService: NotificationServicing

    init(
        parentProfileService: ParentProfileServicing = ParentProfileService(),
        bookingService: BookingServicing = BookingService(),
        notificationService: NotificationServicing = NotificationService()
    ) {
        self.parentProfileService = parentProfileService
        self.bookingService = bookingService
        self.notificationService = notificationService
    }

    func load(userID: UUID?) async {
        guard let userID else {
            clear()
            return
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let profile = try await parentProfileService.fetchCurrentParentProfile(userID: userID)
            async let bookingsTask = bookingService.fetchMyBookings(parentID: profile.id)
            async let notificationsTask = notificationService.fetchMyNotifications(parentID: profile.id)

            self.profile = profile
            self.reservations = try await bookingsTask
            self.notifications = try await notificationsTask
        } catch {
            clear()
            errorMessage = error.localizedDescription
        }
    }

    func clear() {
        profile = nil
        reservations = []
        notifications = []
        errorMessage = nil
    }
}
