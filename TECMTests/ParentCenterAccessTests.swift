import Foundation
import XCTest
@testable import TECM

@MainActor
final class ParentCenterAccessTests: XCTestCase {
    func testGuestVisibleTabPolicyContainsParentCenterButNotTeacher() {
        let tabs = AppTab.visibleTabs(for: .guest)

        XCTAssertTrue(tabs.contains(.parentCenter))
        XCTAssertFalse(tabs.contains(.teacher))
    }

    func testParentVisibleTabPolicyContainsParentCenter() {
        let capabilities = UserRoleCapabilities.resolve(
            organizationRoleNames: [],
            hasParentProfile: true
        )

        XCTAssertTrue(AppTab.visibleTabs(for: capabilities).contains(.parentCenter))
    }

    func testTeacherVisibleTabPolicyContainsTeacherAndParentCenter() {
        let capabilities = UserRoleCapabilities.resolve(
            organizationRoleNames: ["teacher"],
            hasParentProfile: false
        )
        let tabs = AppTab.visibleTabs(for: capabilities)

        XCTAssertTrue(tabs.contains(.teacher))
        XCTAssertTrue(tabs.contains(.parentCenter))
        XCTAssertEqual(tabs.count, 6)
    }

    func testSignedOutPresentationResolvesToLogin() {
        XCTAssertEqual(
            presentation(userID: nil, hasParentRole: false),
            .signedOut
        )
    }

    func testAuthResolvingPresentationDoesNotExposeParentContent() {
        XCTAssertEqual(
            presentation(userID: UUID(), hasParentRole: false, isAuthLoading: true),
            .resolving
        )
    }

    func testAuthenticatedNonParentPresentationIsSafeUnlinkedState() {
        XCTAssertEqual(
            presentation(
                userID: UUID(),
                hasParentRole: false,
                errorMessage: ParentCenterTestError.sensitiveSentinel
            ),
            .unlinkedParent
        )
    }

    func testAuthenticatedParentPresentationResolvesToLoadingAndContent() {
        let userID = UUID()

        XCTAssertEqual(
            presentation(userID: userID, hasParentRole: true),
            .loading
        )
        XCTAssertEqual(
            presentation(userID: userID, hasParentRole: true, hasProfile: true),
            .content
        )
    }

    func testGenuineParentLoadingFailureRemainsDistinct() {
        XCTAssertEqual(
            presentation(
                userID: UUID(),
                hasParentRole: true,
                errorMessage: "Unable to load parent data."
            ),
            .failure("Unable to load parent data.")
        )
    }

    func testLosingParentCapabilityResetsPathWithoutForcingHome() {
        let router = TabRouter()
        router.select(.parentCenter)
        router.parentCenterPath.append(ParentRoute.operations)

        router.reconcileCapabilities(.guest)

        XCTAssertTrue(router.parentCenterPath.isEmpty)
        XCTAssertEqual(router.selectedTab, .parentCenter)
    }

    func testLogoutFromParentCenterReturnsToLoginRoot() {
        let router = TabRouter()
        router.select(.parentCenter)
        router.parentCenterPath.append(ParentRoute.notificationCenter(focusID: UUID()))

        router.reconcileCapabilities(.guest)

        XCTAssertEqual(router.selectedTab, .parentCenter)
        XCTAssertTrue(router.parentCenterPath.isEmpty)
        XCTAssertEqual(presentation(userID: nil, hasParentRole: false), .signedOut)
    }

    func testSignedOutStateDoesNotInvokeParentServices() async {
        let services = ParentCenterServiceMocks()
        let viewModel = services.makeViewModel()

        await viewModel.load(userID: nil, hasParentRole: false)

        services.assertNoCalls()
        XCTAssertNil(viewModel.profile)
        XCTAssertFalse(viewModel.isLoading)
    }

    func testNonParentStateDoesNotInvokeParentServices() async {
        let services = ParentCenterServiceMocks()
        let viewModel = services.makeViewModel()

        await viewModel.load(userID: UUID(), hasParentRole: false)

        services.assertNoCalls()
        XCTAssertNil(viewModel.profile)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testNotificationCenterRoleLossClearsContentWithoutNewRequests() async {
        let userID = UUID()
        let profile = ParentProfileServiceMock(profile: makeParentProfile(userID: userID))
        let notification = ParentNotificationServiceMock(
            notifications: [makeParentNotification()]
        )
        let viewModel = NotificationCenterViewModel(
            parentProfileService: profile,
            notificationService: notification
        )

        await viewModel.load(userID: userID, hasParentRole: true)
        XCTAssertEqual(viewModel.notifications.count, 1)

        await viewModel.load(userID: userID, hasParentRole: false)

        XCTAssertTrue(viewModel.notifications.isEmpty)
        XCTAssertEqual(profile.fetchCallCount, 1)
        XCTAssertEqual(notification.fetchCallCount, 1)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testNotificationCenterNonParentDoesNotRequestData() async {
        let profile = ParentProfileServiceMock(profile: makeParentProfile())
        let notification = ParentNotificationServiceMock()
        let viewModel = NotificationCenterViewModel(
            parentProfileService: profile,
            notificationService: notification
        )

        await viewModel.load(userID: UUID(), hasParentRole: false)

        XCTAssertEqual(profile.fetchCallCount, 0)
        XCTAssertEqual(notification.fetchCallCount, 0)
        XCTAssertTrue(viewModel.notifications.isEmpty)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testBookingDetailDoesNotRequestDataWithoutParentCapability() async {
        let booking = BookingServiceMock()
        let viewModel = ParentBookingDetailViewModel(
            bookingID: UUID(),
            parentID: UUID(),
            bookingService: booking
        )

        await viewModel.load(isAuthorizedParent: false)

        XCTAssertEqual(booking.fetchDetailCallCount, 0)
        XCTAssertNil(viewModel.detail)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testParentStateLoadsAuthorizedContent() async {
        let userID = UUID()
        let services = ParentCenterServiceMocks(profile: makeParentProfile(userID: userID))
        let viewModel = services.makeViewModel()

        await viewModel.load(userID: userID, hasParentRole: true)

        XCTAssertEqual(services.profile.fetchCallCount, 1)
        XCTAssertEqual(services.booking.fetchCallCount, 1)
        XCTAssertEqual(services.notification.fetchCallCount, 1)
        XCTAssertEqual(services.exam.fetchParentCallCount, 1)
        XCTAssertEqual(viewModel.profile?.userID, userID)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testLosingParentCapabilityClearsLoadedSensitiveContent() async {
        let userID = UUID()
        let services = ParentCenterServiceMocks(profile: makeParentProfile(userID: userID))
        let viewModel = services.makeViewModel()
        await viewModel.load(userID: userID, hasParentRole: true)

        await viewModel.load(userID: userID, hasParentRole: false)

        XCTAssertNil(viewModel.profile)
        XCTAssertTrue(viewModel.reservations.isEmpty)
        XCTAssertTrue(viewModel.notifications.isEmpty)
        XCTAssertTrue(viewModel.examSummaries.isEmpty)
        XCTAssertEqual(services.profile.fetchCallCount, 1)
    }

    func testLosingAuthenticatedUserClearsLoadedSensitiveContent() async {
        let userID = UUID()
        let services = ParentCenterServiceMocks(profile: makeParentProfile(userID: userID))
        let viewModel = services.makeViewModel()
        await viewModel.load(userID: userID, hasParentRole: true)

        await viewModel.load(userID: nil, hasParentRole: false)

        XCTAssertNil(viewModel.profile)
        XCTAssertTrue(viewModel.reservations.isEmpty)
        XCTAssertTrue(viewModel.notifications.isEmpty)
        XCTAssertTrue(viewModel.examSummaries.isEmpty)
        XCTAssertEqual(services.profile.fetchCallCount, 1)
    }

    func testLateProfileCompletionFromPreviousSessionIsIgnored() async {
        let firstUserID = UUID()
        let secondUserID = UUID()
        let profileStarted = expectation(description: "previous profile load started")
        var continuation: CheckedContinuation<ParentProfile, Error>?
        defer {
            continuation?.resume(throwing: ParentCenterTestError.unused)
        }
        let secondProfile = makeParentProfile(userID: secondUserID)
        let services = ParentCenterServiceMocks(profile: secondProfile)
        services.profile.fetchHandler = { userID in
            if userID == firstUserID {
                return try await withCheckedThrowingContinuation { pendingContinuation in
                    continuation = pendingContinuation
                    profileStarted.fulfill()
                }
            }
            return secondProfile
        }
        let viewModel = services.makeViewModel()

        let previousLoad = Task {
            await viewModel.load(userID: firstUserID, hasParentRole: true)
        }
        await fulfillment(of: [profileStarted], timeout: 1)

        await viewModel.load(userID: secondUserID, hasParentRole: true)
        let previousContinuation = continuation
        continuation = nil
        previousContinuation?.resume(returning: makeParentProfile(userID: firstUserID))
        await previousLoad.value

        XCTAssertEqual(viewModel.profile?.userID, secondUserID)
        XCTAssertTrue(viewModel.reservations.isEmpty)
        XCTAssertTrue(viewModel.notifications.isEmpty)
        XCTAssertTrue(viewModel.examSummaries.isEmpty)
        XCTAssertEqual(services.profile.fetchCallCount, 2)
        XCTAssertEqual(services.booking.fetchCallCount, 1)
        XCTAssertEqual(services.notification.fetchCallCount, 1)
        XCTAssertEqual(services.exam.fetchParentCallCount, 1)
    }

    private func presentation(
        userID: UUID?,
        hasParentRole: Bool,
        isAuthLoading: Bool = false,
        isDataLoading: Bool = false,
        hasProfile: Bool = false,
        errorMessage: String? = nil
    ) -> ParentCenterPresentation {
        resolveParentCenterPresentation(
            userID: userID,
            hasParentRole: hasParentRole,
            isAuthLoading: isAuthLoading,
            isDataLoading: isDataLoading,
            hasProfile: hasProfile,
            errorMessage: errorMessage
        )
    }
}

@MainActor
private final class ParentCenterServiceMocks {
    let profile: ParentProfileServiceMock
    let booking = BookingServiceMock()
    let notification = ParentNotificationServiceMock()
    let exam = ExamCohortServiceMock()

    init(profile: ParentProfile = makeParentProfile()) {
        self.profile = ParentProfileServiceMock(profile: profile)
    }

    func makeViewModel() -> ParentCenterViewModel {
        ParentCenterViewModel(
            parentProfileService: profile,
            bookingService: booking,
            notificationService: notification,
            examCohortService: exam
        )
    }

    func assertNoCalls() {
        XCTAssertEqual(profile.fetchCallCount, 0)
        XCTAssertEqual(booking.fetchCallCount, 0)
        XCTAssertEqual(notification.fetchCallCount, 0)
        XCTAssertEqual(exam.fetchParentCallCount, 0)
    }
}

@MainActor
private final class ParentProfileServiceMock: ParentProfileServicing {
    var fetchHandler: (@MainActor (UUID) async throws -> ParentProfile)?
    private(set) var fetchCallCount = 0
    private let profile: ParentProfile

    init(profile: ParentProfile) {
        self.profile = profile
    }

    func fetchCurrentParentProfile(userID: UUID) async throws -> ParentProfile {
        fetchCallCount += 1
        if let fetchHandler {
            return try await fetchHandler(userID)
        }
        return profile
    }
}

@MainActor
private final class BookingServiceMock: BookingServicing {
    private(set) var fetchCallCount = 0
    private(set) var fetchDetailCallCount = 0

    func submitBooking(input: BookingFormInput, profile: ParentProfile) async throws -> BookingRecord {
        throw ParentCenterTestError.unused
    }

    func fetchMyBookings(parentID: UUID) async throws -> [ParentReservationSummaryItem] {
        fetchCallCount += 1
        return []
    }

    func fetchBookingDetail(bookingID: UUID, parentID: UUID) async throws -> ParentBookingDetail {
        fetchDetailCallCount += 1
        throw ParentCenterTestError.unused
    }
}

@MainActor
private final class ParentNotificationServiceMock: NotificationServicing {
    private(set) var fetchCallCount = 0
    private let notifications: [ParentNotificationItem]

    init(notifications: [ParentNotificationItem] = []) {
        self.notifications = notifications
    }

    func fetchMyNotifications(parentID: UUID) async throws -> [ParentNotificationItem] {
        fetchCallCount += 1
        return notifications
    }

    func markNotificationRead(notificationID: UUID) async throws {}
    func markAllNotificationsRead() async throws {}
    func fetchUnreadNotificationCount() async throws -> Int { 0 }
    func registerPushDevice(_ registration: PushDeviceRegistration) async throws {}
    func deactivatePushDevice(installationID: String, accessToken: String?) async throws {}
}

@MainActor
private final class ExamCohortServiceMock: ExamCohortServicing {
    private(set) var fetchParentCallCount = 0

    func fetchTeacherTodaySessions() async throws -> [TeacherTodaySession] { [] }

    func fetchParentAttendanceSummary() async throws -> [ParentExamAttendanceSummary] {
        fetchParentCallCount += 1
        return []
    }
}

private enum ParentCenterTestError: LocalizedError {
    case unused

    static let sensitiveSentinel = "postgrest-profile-not-found-sensitive"

    var errorDescription: String? {
        Self.sensitiveSentinel
    }
}

private func makeParentProfile(userID: UUID = UUID()) -> ParentProfile {
    ParentProfile(
        id: UUID(),
        userID: userID,
        fullName: "Synthetic Parent",
        phone: nil,
        children: []
    )
}

private func makeParentNotification() -> ParentNotificationItem {
    ParentNotificationItem(
        id: UUID(),
        title: "Synthetic notification",
        detail: "Synthetic detail",
        isRead: false,
        category: nil,
        deepLink: nil,
        entityType: nil,
        entityID: nil,
        createdAt: Date()
    )
}
