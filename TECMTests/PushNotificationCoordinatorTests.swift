import XCTest
@testable import TECM

final class PushNotificationCoordinatorTests: XCTestCase {
    func testDefaultInitializerDoesNotRequireSecretsOrAnActorHop() {
        let coordinator = PushNotificationCoordinator()

        XCTAssertEqual(coordinator.unreadCount, 0)
        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertNil(coordinator.lastErrorMessage)
    }
}
