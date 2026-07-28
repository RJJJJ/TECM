import Auth
import Foundation
import Supabase
import XCTest
@testable import TECM

@MainActor
final class AuthViewModelTests: XCTestCase {
    func testLocalPrivacyBoundaryPrecedesRemoteAuthCompletionAndSurvivesRestart() async {
        let remoteGate = NonCooperativeAuthSignOutGate(testCase: self)
        let deadline = ManualAuthSignOutDeadline(testCase: self)
        let firstUser = makeUser()
        let authService = MockAuthService(user: firstUser)
        authService.remoteSignOut = {
            await remoteGate.suspendIgnoringCancellation()
        }
        let viewModel = await makeSignedInViewModel(
            authService: authService,
            deadline: deadline
        )
        let localState = LocalPrivacyState()
        viewModel.configureSensitiveStateCleanup { localState.clearSensitiveState() }
        viewModel.configureSignOutCleanup { _ in localState.clearProtectedAppState() }

        let logoutReturned = expectation(description: "logout returned")
        let logoutTask = Task {
            await viewModel.signOut()
            logoutReturned.fulfill()
        }
        await fulfillment(of: [remoteGate.started, deadline.waitStarted], timeout: 1)

        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertTrue(authService.localSessionInvalidated)
        XCTAssertEqual(localState.sensitiveCacheClearCount, 1)

        deadline.fire()
        await fulfillment(of: [logoutReturned], timeout: 1)
        await logoutTask.value

        XCTAssertTrue(remoteGate.isSuspended)
        XCTAssertTrue(localState.protectedRoutesCleared)
        XCTAssertTrue(localState.realtimeStopped)
        XCTAssertTrue(localState.notificationsCleared)
        XCTAssertEqual(viewModel.errorMessage, AuthViewModel.incompleteRemoteLogoutMessage)

        let restartedViewModel = AuthViewModel(
            authService: authService,
            userRoleService: MockUserRoleService(),
            automaticallyRestoreSession: false
        )
        await restartedViewModel.restoreSession()
        XCTAssertNil(restartedViewModel.currentUser)
        XCTAssertEqual(restartedViewModel.currentCapabilities, .guest)

        remoteGate.release()
        await fulfillment(of: [remoteGate.finished], timeout: 1)
        await Task.yield()
    }

    func testLateRemoteAuthCompletionCannotMutateNewUserOrProtectedState() async {
        let remoteGate = NonCooperativeAuthSignOutGate(testCase: self)
        let deadline = ManualAuthSignOutDeadline(testCase: self)
        let firstUser = makeUser()
        let secondUser = makeUser()
        let authService = MockAuthService(user: firstUser)
        authService.remoteSignOut = {
            await remoteGate.suspendIgnoringCancellation()
        }
        let viewModel = await makeSignedInViewModel(
            authService: authService,
            deadline: deadline
        )
        let localState = LocalPrivacyState()
        viewModel.configureSensitiveStateCleanup { localState.clearSensitiveState() }
        viewModel.configureSignOutCleanup { _ in localState.clearProtectedAppState() }

        let logoutTask = Task { await viewModel.signOut() }
        await fulfillment(of: [remoteGate.started, deadline.waitStarted], timeout: 1)
        deadline.fire()
        await logoutTask.value

        authService.user = secondUser
        await viewModel.signIn(email: "second@example.invalid", password: "unused")
        localState.establishProtectedStateForNewUser()

        remoteGate.release()
        await fulfillment(of: [remoteGate.finished], timeout: 1)
        await Task.yield()

        XCTAssertEqual(viewModel.currentUser?.id, secondUser.id)
        XCTAssertNotEqual(viewModel.currentUser?.id, firstUser.id)
        XCTAssertTrue(viewModel.hasParentRole)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertTrue(localState.hasNewUserProtectedState)
        XCTAssertEqual(localState.sensitiveCacheClearCount, 1)
    }

    func testRemoteAuthFailureStillClearsLocalSessionAndSensitiveState() async {
        let authService = MockAuthService()
        authService.remoteSignOut = { throw MockError.network }
        let viewModel = await makeSignedInViewModel(authService: authService)
        var sensitiveStateCleared = false
        viewModel.configureSensitiveStateCleanup { sensitiveStateCleared = true }

        await viewModel.signOut()

        XCTAssertEqual(authService.remoteSignOutCallCount, 1)
        XCTAssertEqual(authService.localInvalidationCallCount, 1)
        XCTAssertTrue(authService.localSessionInvalidated)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
        XCTAssertTrue(sensitiveStateCleared)
        XCTAssertEqual(viewModel.errorMessage, AuthViewModel.incompleteRemoteLogoutMessage)
        XCTAssertFalse(viewModel.errorMessage?.contains(MockError.sensitiveSentinel) ?? true)
    }

    func testLocalPersistenceFailureSkipsRemoteAuthButStillClearsAppState() async {
        let authService = MockAuthService()
        authService.localInvalidationError = MockError.network
        authService.remoteSignOut = { XCTFail("Remote auth must not start") }
        let viewModel = await makeSignedInViewModel(authService: authService)
        var sensitiveStateCleared = false
        var appStateCleared = false
        var cleanupAccessToken: String?
        viewModel.configureSensitiveStateCleanup { sensitiveStateCleared = true }
        viewModel.configureSignOutCleanup { accessToken in
            cleanupAccessToken = accessToken
            appStateCleared = true
        }

        await viewModel.signOut()

        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
        XCTAssertTrue(sensitiveStateCleared)
        XCTAssertTrue(appStateCleared)
        XCTAssertNil(cleanupAccessToken)
        XCTAssertEqual(authService.remoteSignOutCallCount, 0)
        XCTAssertEqual(viewModel.errorMessage, AuthViewModel.incompleteRemoteLogoutMessage)
    }

    func testParentCancellationCannotWaitForNonCooperativeRemoteAuthSignOut() async {
        let remoteGate = NonCooperativeAuthSignOutGate(testCase: self)
        let deadline = ManualAuthSignOutDeadline(testCase: self)
        let authService = MockAuthService()
        authService.remoteSignOut = {
            await remoteGate.suspendIgnoringCancellation()
        }
        let viewModel = await makeSignedInViewModel(
            authService: authService,
            deadline: deadline
        )

        let logoutReturned = expectation(description: "cancelled logout returned")
        let logoutTask = Task {
            await viewModel.signOut()
            logoutReturned.fulfill()
        }
        await fulfillment(of: [remoteGate.started, deadline.waitStarted], timeout: 1)
        logoutTask.cancel()
        await fulfillment(of: [logoutReturned], timeout: 1)
        await logoutTask.value

        XCTAssertTrue(remoteGate.isSuspended)
        XCTAssertTrue(authService.localSessionInvalidated)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)

        remoteGate.release()
        deadline.fire()
        await fulfillment(of: [remoteGate.finished], timeout: 1)
        await Task.yield()
    }

    func testConcurrentAndRepeatedLogoutAreIdempotent() async {
        let remoteGate = NonCooperativeAuthSignOutGate(testCase: self)
        let deadline = ManualAuthSignOutDeadline(testCase: self)
        let authService = MockAuthService()
        authService.remoteSignOut = {
            await remoteGate.suspendIgnoringCancellation()
        }
        let viewModel = await makeSignedInViewModel(
            authService: authService,
            deadline: deadline
        )
        var appCleanupCount = 0
        viewModel.configureSignOutCleanup { _ in appCleanupCount += 1 }

        let firstLogout = Task { await viewModel.signOut() }
        await fulfillment(of: [remoteGate.started, deadline.waitStarted], timeout: 1)
        let concurrentLogout = Task { await viewModel.signOut() }
        await concurrentLogout.value

        XCTAssertEqual(authService.prepareRemoteSignOutCallCount, 1)
        XCTAssertEqual(authService.localInvalidationCallCount, 1)
        XCTAssertEqual(appCleanupCount, 1)

        deadline.fire()
        await firstLogout.value
        await viewModel.signOut()

        XCTAssertEqual(authService.remoteSignOutCallCount, 1)
        XCTAssertEqual(authService.localInvalidationCallCount, 2)
        XCTAssertEqual(appCleanupCount, 1)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)

        remoteGate.release()
        await fulfillment(of: [remoteGate.finished], timeout: 1)
        await Task.yield()
    }

    func testPersistedSupabaseSessionIsRemovedFromConfiguredStorage() throws {
        let storage = InMemoryAuthLocalStorage()
        let storageKey = "test-auth-session"
        let persistence = AuthSessionPersistence(
            underlyingStorage: storage,
            storageKey: storageKey
        )
        let user = makeUser()
        let firstSession = Session(
            accessToken: makeTestJWT(sessionID: "old-session"),
            tokenType: "bearer",
            expiresIn: 3_600,
            expiresAt: Date().addingTimeInterval(3_600).timeIntervalSince1970,
            refreshToken: "sensitive-refresh-token",
            user: user
        )
        try persistence.activate(firstSession)

        XCTAssertEqual(try persistence.accessToken(), firstSession.accessToken)
        try persistence.invalidate()

        let staleFirstSessionData = try AuthClient.Configuration.jsonEncoder.encode(firstSession)
        try persistence.store(key: storageKey, value: staleFirstSessionData)
        XCTAssertNil(try storage.retrieve(key: storageKey))

        let secondSession = Session(
            accessToken: makeTestJWT(sessionID: "new-session"),
            tokenType: "bearer",
            expiresIn: 3_600,
            expiresAt: Date().addingTimeInterval(3_600).timeIntervalSince1970,
            refreshToken: "second-refresh-token",
            user: user
        )
        try persistence.activate(secondSession)
        try persistence.store(key: storageKey, value: staleFirstSessionData)

        let relaunchedPersistence = AuthSessionPersistence(
            underlyingStorage: storage,
            storageKey: storageKey
        )
        XCTAssertEqual(try relaunchedPersistence.accessToken(), secondSession.accessToken)
    }

    func testFailedPersistenceRemovalRemainsRetryableAndRejectsStaleStores() throws {
        let storage = InMemoryAuthLocalStorage()
        storage.removeFailuresRemaining = 1
        let storageKey = "retryable-auth-session"
        let persistence = AuthSessionPersistence(
            underlyingStorage: storage,
            storageKey: storageKey
        )
        let session = Session(
            accessToken: makeTestJWT(sessionID: "old-session"),
            tokenType: "bearer",
            expiresIn: 3_600,
            expiresAt: Date().addingTimeInterval(3_600).timeIntervalSince1970,
            refreshToken: "old-refresh-token",
            user: makeUser()
        )
        try persistence.activate(session)
        let staleData = try AuthClient.Configuration.jsonEncoder.encode(session)

        XCTAssertThrowsError(try persistence.invalidate())
        try persistence.store(key: storageKey, value: staleData)
        XCTAssertNotNil(try storage.retrieve(key: storageKey))

        try persistence.invalidate()
        let relaunchedPersistence = AuthSessionPersistence(
            underlyingStorage: storage,
            storageKey: storageKey
        )
        XCTAssertNil(try relaunchedPersistence.accessToken())
    }

    func testStaleRoleResolutionCannotRestoreSignedOutCapabilities() async {
        let roleGate = NonCooperativeRoleResolutionGate(testCase: self)
        let authService = MockAuthService()
        let viewModel = AuthViewModel(
            authService: authService,
            userRoleService: GatedUserRoleService(gate: roleGate),
            automaticallyRestoreSession: false
        )

        let signInTask = Task {
            await viewModel.signIn(email: "first@example.invalid", password: "unused")
        }
        await fulfillment(of: [roleGate.started], timeout: 1)
        await viewModel.signOut()

        roleGate.release()
        await fulfillment(of: [roleGate.finished], timeout: 1)
        await signInTask.value

        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
    }

    private func makeSignedInViewModel(
        authService: MockAuthService,
        deadline: ManualAuthSignOutDeadline? = nil
    ) async -> AuthViewModel {
        let viewModel = AuthViewModel(
            authService: authService,
            userRoleService: MockUserRoleService(),
            automaticallyRestoreSession: false,
            remoteAuthSignOutTimeout: .milliseconds(1),
            waitForRemoteAuthSignOutDeadline: { duration in
                if let deadline {
                    await deadline.wait(for: duration)
                } else {
                    try? await ContinuousClock().sleep(for: duration)
                }
            }
        )
        await viewModel.signIn(email: "test@example.invalid", password: "unused")
        return viewModel
    }
}

private final class MockAuthService: AuthServicing {
    var user: User
    var remoteSignOut: (() async throws -> Void)?
    var localInvalidationError: Error?
    private(set) var prepareRemoteSignOutCallCount = 0
    private(set) var remoteSignOutCallCount = 0
    private(set) var localInvalidationCallCount = 0
    private(set) var localSessionInvalidated = false

    init(user: User = makeUser()) {
        self.user = user
    }

    func signIn(email: String, password: String) async throws -> User {
        localSessionInvalidated = false
        return user
    }

    func prepareSignOut() throws -> AuthSignOutPreparation {
        prepareRemoteSignOutCallCount += 1
        guard !localSessionInvalidated else {
            return AuthSignOutPreparation(accessToken: nil, remoteOperation: nil)
        }
        return AuthSignOutPreparation(
            accessToken: "synthetic-access-token",
            remoteOperation: RemoteAuthSignOutOperation { @MainActor [weak self] in
                guard let self else { return }
                remoteSignOutCallCount += 1
                try await remoteSignOut?()
            }
        )
    }

    func invalidateLocalSession() throws {
        localInvalidationCallCount += 1
        if let localInvalidationError {
            throw localInvalidationError
        }
        localSessionInvalidated = true
    }

    func restoreSession() async throws -> User? {
        localSessionInvalidated ? nil : user
    }

    func currentUser() async throws -> User? {
        localSessionInvalidated ? nil : user
    }

    func handleAuthCallback(url: URL) async throws -> User {
        localSessionInvalidated = false
        return user
    }
}

private struct MockUserRoleService: UserRoleServicing {
    func resolveCapabilities(userID: UUID) async throws -> UserRoleCapabilities {
        UserRoleCapabilities.resolve(organizationRoleNames: [], hasParentProfile: true)
    }
}

private struct GatedUserRoleService: UserRoleServicing {
    let gate: NonCooperativeRoleResolutionGate

    func resolveCapabilities(userID: UUID) async throws -> UserRoleCapabilities {
        await gate.suspendIgnoringCancellation()
        return UserRoleCapabilities.resolve(
            organizationRoleNames: [],
            hasParentProfile: true
        )
    }
}

@MainActor
private final class ManualAuthSignOutDeadline {
    let waitStarted: XCTestExpectation
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var requestedDuration: Duration?

    init(testCase: XCTestCase) {
        waitStarted = testCase.expectation(description: "auth sign-out deadline started")
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
private final class NonCooperativeAuthSignOutGate {
    let started: XCTestExpectation
    let finished: XCTestExpectation
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var isSuspended = false

    init(testCase: XCTestCase) {
        started = testCase.expectation(description: "non-cooperative auth sign-out started")
        finished = testCase.expectation(description: "non-cooperative auth sign-out finished")
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
private final class NonCooperativeRoleResolutionGate {
    let started: XCTestExpectation
    let finished: XCTestExpectation
    private var continuation: CheckedContinuation<Void, Never>?

    init(testCase: XCTestCase) {
        started = testCase.expectation(description: "role resolution started")
        finished = testCase.expectation(description: "role resolution finished")
    }

    func suspendIgnoringCancellation() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            started.fulfill()
        }
        finished.fulfill()
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class LocalPrivacyState {
    private(set) var sensitiveCacheClearCount = 0
    private(set) var protectedRoutesCleared = false
    private(set) var realtimeStopped = false
    private(set) var notificationsCleared = false
    private(set) var hasNewUserProtectedState = false

    func clearSensitiveState() {
        sensitiveCacheClearCount += 1
    }

    func clearProtectedAppState() {
        protectedRoutesCleared = true
        realtimeStopped = true
        notificationsCleared = true
        hasNewUserProtectedState = false
    }

    func establishProtectedStateForNewUser() {
        hasNewUserProtectedState = true
    }
}

private final class InMemoryAuthLocalStorage: AuthLocalStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]
    var removeFailuresRemaining = 0

    func store(key: String, value: Data) throws {
        lock.lock()
        defer { lock.unlock() }
        values[key] = value
    }

    func retrieve(key: String) throws -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return values[key]
    }

    func remove(key: String) throws {
        lock.lock()
        defer { lock.unlock() }
        if removeFailuresRemaining > 0 {
            removeFailuresRemaining -= 1
            throw InMemoryStorageError.removeFailed
        }
        values.removeValue(forKey: key)
    }
}

private enum InMemoryStorageError: Error {
    case removeFailed
}

private enum MockError: LocalizedError {
    case network

    static let sensitiveSentinel = "auth-token-secret-sentinel"

    var errorDescription: String? {
        Self.sensitiveSentinel
    }
}

private func makeUser(id: UUID = UUID()) -> User {
    User(
        id: id,
        appMetadata: [:],
        userMetadata: [:],
        aud: "authenticated",
        createdAt: Date(),
        updatedAt: Date()
    )
}

private func makeTestJWT(sessionID: String) -> String {
    let payload = try! JSONSerialization.data(
        withJSONObject: ["session_id": sessionID],
        options: [.sortedKeys]
    )
    let encodedPayload = payload
        .base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "test-header.\(encodedPayload).test-signature"
}
