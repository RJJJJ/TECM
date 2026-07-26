import Foundation
import Combine

enum ParentCenterPresentation: Equatable {
    case signedOut
    case resolving
    case unlinkedParent
    case loading
    case content
    case failure(String)
}

func resolveParentCenterPresentation(
    userID: UUID?,
    hasParentRole: Bool,
    isAuthLoading: Bool,
    isDataLoading: Bool,
    hasProfile: Bool,
    errorMessage: String?
) -> ParentCenterPresentation {
    if isAuthLoading {
        return .resolving
    }
    guard userID != nil else {
        return .signedOut
    }
    guard hasParentRole else {
        return .unlinkedParent
    }
    if isDataLoading {
        return .loading
    }
    if hasProfile {
        return .content
    }
    if let errorMessage {
        return .failure(errorMessage)
    }
    return .loading
}

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
    private var loadGeneration = 0
    private var requestedUserID: UUID?

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

    func load(userID: UUID?, hasParentRole: Bool) async {
        loadGeneration &+= 1
        let generation = loadGeneration
        requestedUserID = userID
        resetContent()

        guard let userID else {
            return
        }

        isLoading = true
        errorMessage = nil
        defer {
            if isCurrentLoad(generation, userID: userID) {
                isLoading = false
            }
        }

        do {
            let profile = try await parentProfileService.fetchCurrentParentProfile(userID: userID)
            guard isCurrentLoad(generation, userID: userID) else { return }
            self.profile = profile

            do {
                let reservations = try await bookingService.fetchMyBookings(parentID: profile.id)
                guard isCurrentLoad(generation, userID: userID) else { return }
                self.reservations = reservations
            } catch {
                guard isCurrentLoad(generation, userID: userID) else { return }
                reservations = []
            }

            do {
                let notifications = try await notificationService.fetchMyNotifications(parentID: profile.id)
                guard isCurrentLoad(generation, userID: userID) else { return }
                self.notifications = notifications
            } catch {
                guard isCurrentLoad(generation, userID: userID) else { return }
                notifications = []
            }

            do {
                let examSummaries = try await examCohortService.fetchParentAttendanceSummary()
                guard isCurrentLoad(generation, userID: userID) else { return }
                self.examSummaries = examSummaries
            } catch {
                guard isCurrentLoad(generation, userID: userID) else { return }
                examSummaries = []
            }
        } catch {
            guard isCurrentLoad(generation, userID: userID) else { return }
            resetContent()
            errorMessage = error.localizedDescription
        }
    }

    func clear() {
        loadGeneration &+= 1
        requestedUserID = nil
        resetContent()
    }

    private func resetContent() {
        profile = nil
        reservations = []
        notifications = []
        examSummaries = []
        isLoading = false
        errorMessage = nil
    }

    private func isCurrentLoad(_ generation: Int, userID: UUID) -> Bool {
        generation == loadGeneration && requestedUserID == userID
    }
}
