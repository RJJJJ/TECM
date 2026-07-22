import Foundation
import XCTest
@testable import TECM

final class AppDeepLinkTests: XCTestCase {
    func testParsesMagicLinkCallback() {
        XCTAssertEqual(
            AppDeepLinkRoute.parse(URL(string: "tecm://auth/callback?code=abc")!),
            .authCallback
        )
    }

    func testParsesBookingIdentifier() {
        let identifier = UUID()
        XCTAssertEqual(
            AppDeepLinkRoute.parse(URL(string: "tecm://bookings/\(identifier.uuidString)")!),
            .booking(identifier)
        )
    }

    func testMalformedAndUnknownRoutesFallBackSafely() {
        XCTAssertEqual(
            AppDeepLinkRoute.parse(URL(string: "tecm://bookings/not-a-uuid")!),
            .notificationCenter
        )
        XCTAssertEqual(
            AppDeepLinkRoute.parse(URL(string: "tecm://unknown/value")!),
            .notificationCenter
        )
        XCTAssertNil(AppDeepLinkRoute.parse(URL(string: "https://example.com/bookings")!))
    }

    func testGenericOperationsLinksOpenParentOperations() {
        XCTAssertEqual(
            AppDeepLinkRoute.parse(URL(string: "tecm://schedule")!),
            .parentOperations
        )
        XCTAssertEqual(
            AppDeepLinkRoute.parse(URL(string: "tecm://payments")!),
            .parentOperations
        )
    }

    func testPushPayloadRejectsAuthRoute() {
        XCTAssertEqual(
            AppDeepLinkRoute.fromNotificationPayload(["deep_link": "tecm://auth/callback"]),
            .notificationCenter
        )
    }

    func testParentRouteWaitsForAuthenticationBeforeNavigation() {
        let route = AppDeepLinkRoute.notification(UUID())

        XCTAssertFalse(route.isReadyForParentNavigation(hasParentRole: false, userID: nil))
        XCTAssertFalse(route.isReadyForParentNavigation(hasParentRole: true, userID: nil))
        XCTAssertTrue(route.isReadyForParentNavigation(hasParentRole: true, userID: UUID()))
    }

    @MainActor
    func testLogoutResetsProtectedParentNavigationState() {
        let router = TabRouter()
        router.parentCenterPath.append(ParentRoute.operations)

        router.resetParentFlow()

        XCTAssertTrue(router.parentCenterPath.isEmpty)
    }

    @MainActor
    func testBookingLookupCannotAppendProtectedRouteAfterLogout() async {
        let bookingID = UUID()
        let parentID = UUID()
        var isSessionCurrent = true
        var lookupContinuation: CheckedContinuation<UUID, Error>?
        let lookupStarted = expectation(description: "booking parent lookup started")

        let navigationTask = Task {
            await resolveParentBookingRoute(
                bookingID: bookingID,
                loadParentID: {
                    try await withCheckedThrowingContinuation { continuation in
                        lookupContinuation = continuation
                        lookupStarted.fulfill()
                    }
                },
                isSessionCurrent: { isSessionCurrent }
            )
        }

        await fulfillment(of: [lookupStarted], timeout: 1)
        isSessionCurrent = false
        lookupContinuation?.resume(returning: parentID)

        let destination = await navigationTask.value
        XCTAssertNil(destination)
    }
}
