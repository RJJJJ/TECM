import Foundation
import Supabase
import XCTest
@testable import TECM

@MainActor
final class PushNotificationCoordinatorTests: XCTestCase {
    func testDefaultInitializerDoesNotRequireSecretsOrAnActorHop() {
        let coordinator = PushNotificationCoordinator()

        XCTAssertEqual(coordinator.unreadCount, 0)
        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertNil(coordinator.lastErrorMessage)
    }

    func testSuccessfulDeactivationClearsProtectedPendingRoute() async throws {
        let service = MockNotificationService()
        let coordinator = makeCoordinator(service: service)
        coordinator.handle(url: URL(string: "tecm://notifications/\(UUID().uuidString)")!)

        try await coordinator.deactivateCurrentInstallation()

        XCTAssertEqual(service.deactivationCallCount, 1)
        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertEqual(coordinator.unreadCount, 0)
        XCTAssertNil(coordinator.lastErrorMessage)
    }

    func testFailedRemoteDeactivationStillClearsLocalProtectedStateWithoutLeakingError() async {
        let service = MockNotificationService(deactivationError: MockNotificationError.remote)
        let coordinator = makeCoordinator(service: service)
        coordinator.handle(url: URL(string: "tecm://payments/\(UUID().uuidString)")!)

        do {
            try await coordinator.deactivateCurrentInstallation()
            XCTFail("Expected remote cleanup failure")
        } catch {
            XCTAssertEqual(error as? PushNotificationCleanupError, .remoteDeactivationFailed)
        }

        XCTAssertEqual(service.deactivationCallCount, 1)
        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertEqual(coordinator.unreadCount, 0)
        XCTAssertEqual(
            coordinator.lastErrorMessage,
            PushNotificationCleanupError.remoteDeactivationFailed.localizedDescription
        )
        XCTAssertFalse(coordinator.lastErrorMessage?.contains(MockNotificationError.sensitiveSentinel) ?? true)
    }

    func testLocalProtectedStateClearsBeforeRemoteDeactivationFinishes() async {
        let remoteStarted = expectation(description: "remote deactivation started")
        let service = MockNotificationService(
            deactivationDelayNanoseconds: 60_000_000_000,
            onDeactivationStarted: { remoteStarted.fulfill() }
        )
        let coordinator = makeCoordinator(
            service: service,
            remoteDeactivationTimeoutNanoseconds: 60_000_000_000
        )
        coordinator.handle(url: URL(string: "tecm://payments/\(UUID().uuidString)")!)

        let cleanupTask = Task { try await coordinator.deactivateCurrentInstallation() }
        await fulfillment(of: [remoteStarted], timeout: 1)

        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertEqual(coordinator.unreadCount, 0)

        cleanupTask.cancel()
        _ = try? await cleanupTask.value
    }

    func testRemoteDeactivationTimeoutIsGenericAndLeavesLocalStateCleared() async {
        let service = MockNotificationService(deactivationDelayNanoseconds: 60_000_000_000)
        let coordinator = makeCoordinator(service: service, remoteDeactivationTimeoutNanoseconds: 1_000_000)
        coordinator.handle(url: URL(string: "tecm://notifications/\(UUID().uuidString)")!)

        do {
            try await coordinator.deactivateCurrentInstallation()
            XCTFail("Expected remote cleanup timeout")
        } catch {
            XCTAssertEqual(error as? PushNotificationCleanupError, .remoteDeactivationFailed)
        }

        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertEqual(
            coordinator.lastErrorMessage,
            PushNotificationCleanupError.remoteDeactivationFailed.localizedDescription
        )
    }

    private func makeCoordinator(
        service: MockNotificationService,
        remoteDeactivationTimeoutNanoseconds: UInt64 = 5_000_000_000
    ) -> PushNotificationCoordinator {
        PushNotificationCoordinator(
            notificationService: service,
            client: SupabaseClient(
                supabaseURL: URL(string: "https://invalid.supabase.co")!,
                supabaseKey: "invalid-publishable-key"
            ),
            remoteDeactivationTimeoutNanoseconds: remoteDeactivationTimeoutNanoseconds
        )
    }
}

@MainActor
private final class MockNotificationService: NotificationServicing {
    let deactivationError: Error?
    let deactivationDelayNanoseconds: UInt64?
    let onDeactivationStarted: (() -> Void)?
    private(set) var deactivationCallCount = 0

    init(
        deactivationError: Error? = nil,
        deactivationDelayNanoseconds: UInt64? = nil,
        onDeactivationStarted: (() -> Void)? = nil
    ) {
        self.deactivationError = deactivationError
        self.deactivationDelayNanoseconds = deactivationDelayNanoseconds
        self.onDeactivationStarted = onDeactivationStarted
    }

    func fetchMyNotifications(parentID: UUID) async throws -> [ParentNotificationItem] { [] }
    func markNotificationRead(notificationID: UUID) async throws {}
    func markAllNotificationsRead() async throws {}
    func fetchUnreadNotificationCount() async throws -> Int { 0 }
    func registerPushDevice(_ registration: PushDeviceRegistration) async throws {}

    func deactivatePushDevice(installationID: String) async throws {
        deactivationCallCount += 1
        onDeactivationStarted?()
        if let deactivationDelayNanoseconds {
            try await Task.sleep(nanoseconds: deactivationDelayNanoseconds)
        }
        if let deactivationError { throw deactivationError }
    }
}

private enum MockNotificationError: LocalizedError {
    case remote

    static let sensitiveSentinel = "device-token-secret-sentinel"

    var errorDescription: String? { Self.sensitiveSentinel }
}
