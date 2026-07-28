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
        let remoteCancelled = expectation(description: "remote deactivation cancelled")
        let service = MockNotificationService(
            deactivationDelayNanoseconds: 60_000_000_000,
            onDeactivationStarted: { remoteStarted.fulfill() },
            onDeactivationCancelled: { remoteCancelled.fulfill() }
        )
        let deadline = ManualDeactivationDeadline(testCase: self)
        defer { deadline.fire() }
        let coordinator = makeCoordinator(
            service: service,
            remoteDeactivationTimeout: .milliseconds(1),
            deadline: deadline
        )
        coordinator.handle(url: URL(string: "tecm://payments/\(UUID().uuidString)")!)

        let cleanupTask = Task { try await coordinator.deactivateCurrentInstallation() }
        await fulfillment(of: [remoteStarted, deadline.waitStarted], timeout: 1)

        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertEqual(coordinator.unreadCount, 0)

        deadline.fire()
        _ = try? await cleanupTask.value
        XCTAssertEqual(deadline.requestedDuration, .milliseconds(1))
        await fulfillment(of: [remoteCancelled], timeout: 1)
    }

    func testRemoteDeactivationTimeoutIsGenericAndLeavesLocalStateCleared() async {
        let remoteCancelled = expectation(description: "remote deactivation cancelled")
        let service = MockNotificationService(
            deactivationDelayNanoseconds: 60_000_000_000,
            onDeactivationCancelled: { remoteCancelled.fulfill() }
        )
        let deadline = ManualDeactivationDeadline(testCase: self)
        defer { deadline.fire() }
        let coordinator = makeCoordinator(
            service: service,
            remoteDeactivationTimeout: .milliseconds(1),
            deadline: deadline
        )
        coordinator.handle(url: URL(string: "tecm://notifications/\(UUID().uuidString)")!)

        let cleanupTask = Task { try await coordinator.deactivateCurrentInstallation() }
        await fulfillment(of: [deadline.waitStarted], timeout: 1)
        deadline.fire()

        do {
            try await cleanupTask.value
            XCTFail("Expected remote cleanup timeout")
        } catch {
            XCTAssertEqual(error as? PushNotificationCleanupError, .remoteDeactivationFailed)
        }

        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertEqual(
            coordinator.lastErrorMessage,
            PushNotificationCleanupError.remoteDeactivationFailed.localizedDescription
        )
        XCTAssertEqual(deadline.requestedDuration, .milliseconds(1))
        await fulfillment(of: [remoteCancelled], timeout: 1)
    }

    func testNonCooperativeDeactivationCannotBlockLogoutOrMutateNextUserState() async {
        let remoteGate = NonCooperativeDeactivationGate(testCase: self)
        let deadline = ManualDeactivationDeadline(testCase: self)
        defer {
            deadline.fire()
            remoteGate.release()
        }
        let service = MockNotificationService(nonCooperativeGate: remoteGate)
        var realtimeCleanupCount = 0
        let coordinator = makeCoordinator(
            service: service,
            remoteDeactivationTimeout: .milliseconds(1),
            deadline: deadline,
            realtimeCleanupObserver: { realtimeCleanupCount += 1 }
        )
        coordinator.handle(url: URL(string: "tecm://payments/\(UUID().uuidString)")!)

        let firstUser = makePushTestUser()
        let secondUser = makePushTestUser()
        let authService = PushTestAuthService(user: firstUser)
        let viewModel = AuthViewModel(
            authService: authService,
            userRoleService: PushTestRoleService(),
            automaticallyRestoreSession: false
        )
        var sensitiveCacheClearCount = 0
        viewModel.configureSensitiveStateCleanup { sensitiveCacheClearCount += 1 }
        viewModel.configureSignOutCleanup { accessToken in
            try await coordinator.deactivateCurrentInstallation(accessToken: accessToken)
        }
        await viewModel.signIn(email: "first@example.invalid", password: "unused")

        let logoutReturned = expectation(description: "logout returned")
        var logoutDidReturn = false
        let logoutTask = Task {
            await viewModel.signOut()
            logoutDidReturn = true
            logoutReturned.fulfill()
        }
        await fulfillment(of: [remoteGate.started, deadline.waitStarted], timeout: 1)
        deadline.fire()
        await fulfillment(of: [logoutReturned], timeout: 1)
        let returnedBeforeRemoteRelease = logoutDidReturn
        if !returnedBeforeRemoteRelease {
            remoteGate.release()
        }
        await logoutTask.value

        XCTAssertTrue(returnedBeforeRemoteRelease)
        XCTAssertEqual(service.deactivationCallCount, 1)
        XCTAssertEqual(service.lastDeactivationAccessToken, "synthetic-access-token")
        XCTAssertTrue(remoteGate.isSuspended)
        XCTAssertEqual(authService.signOutCallCount, 1)
        XCTAssertTrue(authService.localSessionInvalidated)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
        XCTAssertEqual(sensitiveCacheClearCount, 1)
        XCTAssertEqual(realtimeCleanupCount, 1)
        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertEqual(
            coordinator.lastErrorMessage,
            PushNotificationCleanupError.remoteDeactivationFailed.localizedDescription
        )
        XCTAssertEqual(viewModel.errorMessage, AuthViewModel.incompleteRemoteLogoutMessage)
        XCTAssertFalse(coordinator.lastErrorMessage?.contains(MockNotificationError.sensitiveSentinel) ?? true)
        XCTAssertEqual(deadline.requestedDuration, .milliseconds(1))

        authService.user = secondUser
        await viewModel.signIn(email: "second@example.invalid", password: "unused")
        remoteGate.release()
        await fulfillment(of: [remoteGate.finished], timeout: 1)
        await Task.yield()

        XCTAssertEqual(viewModel.currentUser?.id, secondUser.id)
        XCTAssertNotEqual(viewModel.currentUser?.id, firstUser.id)
        XCTAssertTrue(viewModel.hasParentRole)
        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertEqual(sensitiveCacheClearCount, 1)
    }

    func testCancellingCleanupDoesNotWaitForNonCooperativeRemoteWork() async {
        let remoteGate = NonCooperativeDeactivationGate(testCase: self)
        let deadline = ManualDeactivationDeadline(testCase: self)
        defer {
            deadline.fire()
            remoteGate.release()
        }
        let service = MockNotificationService(nonCooperativeGate: remoteGate)
        let coordinator = makeCoordinator(
            service: service,
            remoteDeactivationTimeout: .seconds(5),
            deadline: deadline
        )
        coordinator.handle(url: URL(string: "tecm://notifications/\(UUID().uuidString)")!)

        let cleanupReturned = expectation(description: "cancelled cleanup returned")
        let cleanupTask = Task {
            _ = try? await coordinator.deactivateCurrentInstallation()
            cleanupReturned.fulfill()
        }
        await fulfillment(of: [remoteGate.started, deadline.waitStarted], timeout: 1)
        cleanupTask.cancel()
        await fulfillment(of: [cleanupReturned], timeout: 1)
        await cleanupTask.value

        XCTAssertTrue(remoteGate.isSuspended)
        XCTAssertNil(coordinator.pendingRoute)
        XCTAssertEqual(
            coordinator.lastErrorMessage,
            PushNotificationCleanupError.remoteDeactivationFailed.localizedDescription
        )

        remoteGate.release()
        deadline.fire()
        await fulfillment(of: [remoteGate.finished], timeout: 1)
        await Task.yield()
    }

    private func makeCoordinator(
        service: MockNotificationService,
        remoteDeactivationTimeout: Duration = .seconds(5),
        deadline: ManualDeactivationDeadline? = nil,
        realtimeCleanupObserver: (() -> Void)? = nil
    ) -> PushNotificationCoordinator {
        PushNotificationCoordinator(
            notificationService: service,
            client: SupabaseClient(
                supabaseURL: URL(string: "https://invalid.supabase.co")!,
                supabaseKey: "invalid-publishable-key"
            ),
            remoteDeactivationTimeout: remoteDeactivationTimeout,
            waitForRemoteDeactivationDeadline: { duration in
                if let deadline {
                    await deadline.wait(for: duration)
                } else {
                    try? await ContinuousClock().sleep(for: duration)
                }
            },
            realtimeCleanupObserver: realtimeCleanupObserver
        )
    }
}

@MainActor
private final class MockNotificationService: NotificationServicing {
    let deactivationError: Error?
    let deactivationDelayNanoseconds: UInt64?
    let onDeactivationStarted: (() -> Void)?
    let onDeactivationCancelled: (() -> Void)?
    let nonCooperativeGate: NonCooperativeDeactivationGate?
    private(set) var deactivationCallCount = 0
    private(set) var lastDeactivationAccessToken: String?

    init(
        deactivationError: Error? = nil,
        deactivationDelayNanoseconds: UInt64? = nil,
        onDeactivationStarted: (() -> Void)? = nil,
        onDeactivationCancelled: (() -> Void)? = nil,
        nonCooperativeGate: NonCooperativeDeactivationGate? = nil
    ) {
        self.deactivationError = deactivationError
        self.deactivationDelayNanoseconds = deactivationDelayNanoseconds
        self.onDeactivationStarted = onDeactivationStarted
        self.onDeactivationCancelled = onDeactivationCancelled
        self.nonCooperativeGate = nonCooperativeGate
    }

    func fetchMyNotifications(parentID: UUID) async throws -> [ParentNotificationItem] { [] }
    func markNotificationRead(notificationID: UUID) async throws {}
    func markAllNotificationsRead() async throws {}
    func fetchUnreadNotificationCount() async throws -> Int { 0 }
    func registerPushDevice(_ registration: PushDeviceRegistration) async throws {}

    func deactivatePushDevice(installationID: String, accessToken: String?) async throws {
        deactivationCallCount += 1
        lastDeactivationAccessToken = accessToken
        onDeactivationStarted?()
        if let nonCooperativeGate {
            await nonCooperativeGate.suspendIgnoringCancellation()
        }
        if let deactivationDelayNanoseconds {
            do {
                try await Task.sleep(nanoseconds: deactivationDelayNanoseconds)
            } catch {
                onDeactivationCancelled?()
                throw error
            }
        }
        if let deactivationError { throw deactivationError }
    }
}

@MainActor
private final class ManualDeactivationDeadline {
    let waitStarted: XCTestExpectation
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var requestedDuration: Duration?

    init(testCase: XCTestCase) {
        waitStarted = testCase.expectation(description: "deadline wait started")
    }

    func wait(for duration: Duration) async {
        requestedDuration = duration
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            waitStarted.fulfill()
        }
    }

    func fire() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class NonCooperativeDeactivationGate {
    let started: XCTestExpectation
    let finished: XCTestExpectation
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var isSuspended = false

    init(testCase: XCTestCase) {
        started = testCase.expectation(description: "non-cooperative deactivation started")
        finished = testCase.expectation(description: "non-cooperative deactivation finished")
    }

    func suspendIgnoringCancellation() async {
        isSuspended = true
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            started.fulfill()
        }
        isSuspended = false
        finished.fulfill()
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class PushTestAuthService: AuthServicing {
    var user: User
    private(set) var signOutCallCount = 0
    private(set) var localSessionInvalidated = false

    init(user: User) {
        self.user = user
    }

    func signIn(email: String, password: String) async throws -> User {
        localSessionInvalidated = false
        return user
    }

    func prepareSignOut() throws -> AuthSignOutPreparation {
        guard !localSessionInvalidated else {
            return AuthSignOutPreparation(accessToken: nil, remoteOperation: nil)
        }
        return AuthSignOutPreparation(
            accessToken: "synthetic-access-token",
            remoteOperation: RemoteAuthSignOutOperation { @MainActor [weak self] in
                self?.signOutCallCount += 1
            }
        )
    }

    func invalidateLocalSession() throws {
        localSessionInvalidated = true
    }

    func restoreSession() async throws -> User? { localSessionInvalidated ? nil : user }
    func currentUser() async throws -> User? { localSessionInvalidated ? nil : user }
    func handleAuthCallback(url: URL) async throws -> User { user }
}

private struct PushTestRoleService: UserRoleServicing {
    func resolveCapabilities(userID: UUID) async throws -> UserRoleCapabilities {
        UserRoleCapabilities.resolve(organizationRoleNames: [], hasParentProfile: true)
    }
}

private func makePushTestUser(id: UUID = UUID()) -> User {
    User(
        id: id,
        appMetadata: [:],
        userMetadata: [:],
        aud: "authenticated",
        createdAt: Date(),
        updatedAt: Date()
    )
}

private enum MockNotificationError: LocalizedError {
    case remote

    static let sensitiveSentinel = "device-token-secret-sentinel"

    var errorDescription: String? { Self.sensitiveSentinel }
}
