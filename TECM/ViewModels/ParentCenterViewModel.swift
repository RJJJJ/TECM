import Foundation
import Combine

@MainActor
final class ParentCenterViewModel: ObservableObject {
    @Published private(set) var profile: ParentProfile?
    @Published private(set) var reservations: [ParentReservationSummaryItem] = []
    @Published private(set) var notifications: [ParentNotificationItem] = []
    @Published private(set) var examSummaries: [ParentExamAttendanceSummary] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let parentProfileService: ParentProfileServicing
    private let bookingService: BookingServicing
    private let notificationService: NotificationServicing
    private let examCohortService: ExamCohortServicing

    init(
        parentProfileService: ParentProfileServicing = ParentProfileService(),
        bookingService: BookingServicing = BookingService(),
        notificationService: NotificationServicing = NotificationService(),
        examCohortService: ExamCohortServicing = ExamCohortService()
    ) {
        self.parentProfileService = parentProfileService
        self.bookingService = bookingService
        self.notificationService = notificationService
        self.examCohortService = examCohortService
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
            self.profile = profile

            do {
                reservations = try await bookingService.fetchMyBookings(parentID: profile.id)
            } catch {
                reservations = []
            }

            do {
                notifications = try await notificationService.fetchMyNotifications(parentID: profile.id)
            } catch {
                notifications = []
            }

            do {
                examSummaries = try await examCohortService.fetchParentAttendanceSummary()
            } catch {
                examSummaries = []
            }
        } catch {
            clear()
            errorMessage = error.localizedDescription
        }
    }

    func clear() {
        profile = nil
        reservations = []
        notifications = []
        examSummaries = []
        errorMessage = nil
    }
}
