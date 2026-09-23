import Auth
import Foundation
import Security
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
        viewModel.configureSignOutCleanup { _ in
            localState.clearProtectedAppState()
            return AppSignOutCleanupPreparation(remoteOperation: nil)
        }

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
        viewModel.configureSignOutCleanup { _ in
            localState.clearProtectedAppState()
            return AppSignOutCleanupPreparation(remoteOperation: nil)
        }

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
        viewModel.configureSignOutCleanup { context in
            cleanupAccessToken = context?.accessToken
            appStateCleared = true
            return AppSignOutCleanupPreparation(remoteOperation: nil)
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

    func testCancellationReturnsBeforeNonCooperativeAppCleanupAndProtectsNextUser() async {
        let appCleanupGate = NonCooperativeAuthSignOutGate(testCase: self)
        let deadline = ManualAuthSignOutDeadline(testCase: self)
        let firstUser = makeUser()
        let secondUser = makeUser()
        let authService = MockAuthService(user: firstUser)
        authService.includesRemoteSignOutOperation = false
        let viewModel = await makeSignedInViewModel(
            authService: authService,
            deadline: deadline
        )
        let localState = LocalPrivacyState()
        viewModel.configureSignOutCleanup { _ in
            localState.clearProtectedAppState()
            return AppSignOutCleanupPreparation(
                remoteOperation: RemoteAuthSignOutOperation {
                    await appCleanupGate.suspendIgnoringCancellation()
                }
            )
        }

        let logoutReturned = expectation(description: "cancelled app-cleanup logout returned")
        let logoutTask = Task {
            await viewModel.signOut()
            logoutReturned.fulfill()
        }
        await fulfillment(of: [appCleanupGate.started, deadline.waitStarted], timeout: 1)

        XCTAssertNil(viewModel.currentUser)
        XCTAssertTrue(localState.protectedRoutesCleared)
        logoutTask.cancel()
        await fulfillment(of: [logoutReturned], timeout: 1)
        await logoutTask.value
        XCTAssertTrue(appCleanupGate.isSuspended)

        authService.user = secondUser
        await viewModel.signIn(email: "second@example.invalid", password: "unused")
        localState.establishProtectedStateForNewUser()
        appCleanupGate.release()
        deadline.fire()
        await fulfillment(of: [appCleanupGate.finished], timeout: 1)
        await Task.yield()

        XCTAssertEqual(viewModel.currentUser?.id, secondUser.id)
        XCTAssertTrue(viewModel.hasParentRole)
        XCTAssertTrue(localState.hasNewUserProtectedState)
        XCTAssertEqual(localState.sensitiveCacheClearCount, 0)
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
        viewModel.configureSignOutCleanup { _ in
            appCleanupCount += 1
            return AppSignOutCleanupPreparation(remoteOperation: nil)
        }

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
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: storageKey
        )
        let user = makeUser()
        let firstSession = Session(
            accessToken: makeTestJWT(sessionID: "old-session", userID: user.id),
            tokenType: "bearer",
            expiresIn: 3_600,
            expiresAt: Date().addingTimeInterval(3_600).timeIntervalSince1970,
            refreshToken: "sensitive-refresh-token",
            user: user
        )
        try persistence.activate(firstSession)

        XCTAssertEqual(try persistence.accessToken(), firstSession.accessToken)
        let cleanupContext = try XCTUnwrap(persistence.signOutCleanupContext())
        XCTAssertEqual(cleanupContext.userID, user.id)
        XCTAssertEqual(cleanupContext.sessionID, "old-session")
        XCTAssertEqual(cleanupContext.accessToken, firstSession.accessToken)
        try persistence.invalidate()

        let staleFirstSessionData = try AuthClient.Configuration.jsonEncoder.encode(firstSession)
        try persistence.store(key: storageKey, value: staleFirstSessionData)
        XCTAssertNil(try storage.retrieve(key: storageKey))

        let secondSession = Session(
            accessToken: makeTestJWT(sessionID: "new-session", userID: user.id),
            tokenType: "bearer",
            expiresIn: 3_600,
            expiresAt: Date().addingTimeInterval(3_600).timeIntervalSince1970,
            refreshToken: "second-refresh-token",
            user: user
        )
        try persistence.activate(secondSession)
        try persistence.store(key: storageKey, value: staleFirstSessionData)

        let relaunchedPersistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: storageKey
        )
        XCTAssertEqual(try relaunchedPersistence.accessToken(), secondSession.accessToken)
    }

    func testFailedPersistenceRemovalSurvivesImmediateRestartAndRejectsStaleStores() throws {
        let storage = InMemoryAuthLocalStorage()
        let storageKey = "retryable-auth-session"
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: storageKey
        )
        let user = makeUser()
        let session = Session(
            accessToken: makeTestJWT(sessionID: "old-session", userID: user.id),
            tokenType: "bearer",
            expiresIn: 3_600,
            expiresAt: Date().addingTimeInterval(3_600).timeIntervalSince1970,
            refreshToken: "old-refresh-token",
            user: user
        )
        try persistence.activate(session)
        let staleData = try AuthClient.Configuration.jsonEncoder.encode(session)
        storage.removeFailuresRemaining = 1

        try persistence.invalidate()
        try persistence.store(key: storageKey, value: staleData)
        XCTAssertNotNil(try storage.retrieve(key: storageKey))

        let relaunchedPersistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: storageKey
        )
        XCTAssertNil(try relaunchedPersistence.accessToken())
        XCTAssertNotNil(try storage.retrieve(key: "\(storageKey).logout-fence-v1"))
    }

    func testConcurrentAdmittedStoreCannotResurrectSessionAfterInvalidation() throws {
        let storageKey = "linearizable-auth-session"
        let storage = BlockingAuthLocalStorage(blockedKey: storageKey)
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: storageKey
        )
        let user = makeUser()
        let session = makeSession(user: user, sessionID: "same-session", refreshToken: "initial")
        try persistence.activate(session)
        let refreshedSession = makeSession(
            user: user,
            sessionID: "same-session",
            refreshToken: "refreshed"
        )
        let refreshedData = try AuthClient.Configuration.jsonEncoder.encode(refreshedSession)

        storage.blockNextStore()
        let storeFinished = expectation(description: "admitted store finished")
        DispatchQueue.global().async {
            try? persistence.store(key: storageKey, value: refreshedData)
            storeFinished.fulfill()
        }
        XCTAssertTrue(storage.waitUntilStoreIsBlocked())

        let invalidationFinished = expectation(description: "invalidation finished")
        DispatchQueue.global().async {
            try? persistence.invalidate()
            invalidationFinished.fulfill()
        }

        XCTAssertFalse(storage.waitUntilRemovalStarts(timeout: 0.1))
        storage.releaseBlockedStore()
        wait(for: [storeFinished, invalidationFinished], timeout: 1)

        let relaunchedPersistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: storageKey
        )
        XCTAssertNil(try relaunchedPersistence.accessToken())
    }

    func testMissingMalformedAndMismatchedJWTLineageFailClosed() throws {
        let storageKey = "lineage-auth-session"
        let storage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: storageKey
        )
        let user = makeUser()
        let invalidTokens = [
            "malformed-token",
            makeTestJWT(claims: ["sub": user.id.uuidString]),
            makeTestJWT(claims: ["session_id": "missing-sub"]),
            makeTestJWT(
                claims: [
                    "sub": UUID().uuidString,
                    "session_id": "mismatched-sub",
                ]
            ),
            makeTestJWT(
                claims: [
                    "sub": user.id.uuidString,
                    "session_id": 42,
                ]
            ),
        ]

        for token in invalidTokens {
            let session = makeSession(
                user: user,
                sessionID: "unused",
                refreshToken: "invalid",
                accessToken: token
            )
            XCTAssertThrowsError(try persistence.activate(session))
            let data = try AuthClient.Configuration.jsonEncoder.encode(session)
            try persistence.store(key: storageKey, value: data)
            XCTAssertNil(try storage.retrieve(key: storageKey))
        }
    }

    func testSameUserDifferentSessionCannotOverwriteAcceptedLineage() throws {
        let storageKey = "same-user-lineage"
        let storage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: storageKey
        )
        let user = makeUser()
        let accepted = makeSession(user: user, sessionID: "new-session", refreshToken: "new")
        let stale = makeSession(user: user, sessionID: "old-session", refreshToken: "old")

        try persistence.activate(accepted)
        try persistence.store(
            key: storageKey,
            value: AuthClient.Configuration.jsonEncoder.encode(stale)
        )

        XCTAssertEqual(try persistence.accessToken(), accepted.accessToken)
    }

    func testStaleStoreCannotClearDurableLogoutFence() throws {
        let storageKey = "durable-fence-session"
        let fenceKey = "\(storageKey).logout-fence-v1"
        let storage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: storageKey
        )
        let user = makeUser()
        let session = makeSession(user: user, sessionID: "old-session", refreshToken: "old")
        let data = try AuthClient.Configuration.jsonEncoder.encode(session)
        try persistence.activate(session)

        try persistence.invalidate()
        try persistence.store(key: storageKey, value: data)

        XCTAssertNotNil(try storage.retrieve(key: fenceKey))
        XCTAssertNil(try persistence.retrieve(key: storageKey))
    }

    func testExplicitValidActivationClearsFenceWithoutPersistingSecretsInIt() throws {
        let storageKey = "activation-clears-fence"
        let fenceKey = "\(storageKey).logout-fence-v1"
        let storage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: storageKey
        )
        let oldUser = makeUser()
        let oldSession = makeSession(
            user: oldUser,
            sessionID: "private-session-sentinel",
            refreshToken: "private-refresh-sentinel"
        )
        try persistence.activate(oldSession)
        try persistence.invalidate()

        let fence = try XCTUnwrap(storage.retrieve(key: fenceKey))
        let fenceText = String(decoding: fence, as: UTF8.self)
        XCTAssertFalse(fenceText.contains("private-session-sentinel"))
        XCTAssertFalse(fenceText.contains("private-refresh-sentinel"))
        XCTAssertFalse(fenceText.contains(oldUser.id.uuidString))

        let newUser = makeUser()
        let newSession = makeSession(user: newUser, sessionID: "new-session", refreshToken: "new")
        try persistence.activate(newSession)

        XCTAssertNil(try storage.retrieve(key: fenceKey))
        XCTAssertEqual(try persistence.accessToken(), newSession.accessToken)
    }

    func testIndependentSafetyFenceRejectsRestoreAfterLegacyFenceAndSessionRemovalBothFail() throws {
        let storageKey = "double-failure-session"
        let projectKey = "project-a"
        let legacyFenceKey = "\(storageKey).logout-fence-v1"
        let sessionStorage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let oldSession = makeSession(
            user: makeUser(),
            sessionID: "old-session",
            refreshToken: "old-refresh"
        )
        let persistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        try persistence.activate(oldSession)
        sessionStorage.failNextStore(key: legacyFenceKey)
        sessionStorage.removeFailuresRemaining = 1

        try persistence.invalidate()

        XCTAssertNotNil(try sessionStorage.retrieve(key: storageKey))
        XCTAssertEqual(try safetyFenceStorage.read(projectKey: projectKey), .loggedOut)

        let restartedPersistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        XCTAssertNil(try restartedPersistence.retrieve(key: storageKey))
        XCTAssertNil(try restartedPersistence.accessToken())
    }

    func testSafetyFenceReadFailureRejectsPersistedSession() throws {
        let storageKey = "read-failure-session"
        let projectKey = "project-read-failure"
        let sessionStorage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let session = makeSession(
            user: makeUser(),
            sessionID: "persisted-session",
            refreshToken: "persisted-refresh"
        )
        try sessionStorage.store(
            key: storageKey,
            value: AuthClient.Configuration.jsonEncoder.encode(session)
        )
        safetyFenceStorage.readFailuresRemaining = 1

        let persistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )

        XCTAssertNil(try persistence.retrieve(key: storageKey))
        XCTAssertEqual(try safetyFenceStorage.read(projectKey: projectKey), .loggedOut)
    }

    func testCorruptProductionSafetyFenceRejectsPersistedSession() throws {
        let suiteName = "AuthViewModelTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let storageKey = "corrupt-fence-session"
        let projectKey = "project-corrupt"
        let sessionStorage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = UserDefaultsLogoutSafetyFenceStorage(defaults: defaults)
        let session = makeSession(
            user: makeUser(),
            sessionID: "persisted-session",
            refreshToken: "persisted-refresh"
        )
        try sessionStorage.store(
            key: storageKey,
            value: AuthClient.Configuration.jsonEncoder.encode(session)
        )
        defaults.set(
            Data("not-a-valid-fence".utf8),
            forKey: "tecm.auth.logout-safety-fence.v1.\(projectKey)"
        )

        let persistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )

        XCTAssertNil(try persistence.retrieve(key: storageKey))
        XCTAssertEqual(try safetyFenceStorage.read(projectKey: projectKey), .loggedOut)
    }

    func testStaleRefreshCannotClearIndependentFenceAfterDoubleFailure() throws {
        let storageKey = "stale-double-failure-session"
        let projectKey = "project-stale"
        let legacyFenceKey = "\(storageKey).logout-fence-v1"
        let sessionStorage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let oldSession = makeSession(
            user: makeUser(),
            sessionID: "old-session",
            refreshToken: "old-refresh"
        )
        let oldData = try AuthClient.Configuration.jsonEncoder.encode(oldSession)
        let persistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        try persistence.activate(oldSession)
        sessionStorage.failNextStore(key: legacyFenceKey)
        sessionStorage.removeFailuresRemaining = 1
        try persistence.invalidate()

        try persistence.store(key: storageKey, value: oldData)

        XCTAssertEqual(try safetyFenceStorage.read(projectKey: projectKey), .loggedOut)
        let restartedPersistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        XCTAssertNil(try restartedPersistence.retrieve(key: storageKey))
    }

    func testExplicitActivationReplacesFencedSessionAndRestoresOnlyNewLineage() throws {
        let storageKey = "explicit-new-session"
        let projectKey = "project-explicit"
        let sessionStorage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let oldSession = makeSession(
            user: makeUser(),
            sessionID: "old-session",
            refreshToken: "old-refresh"
        )
        try sessionStorage.store(
            key: storageKey,
            value: AuthClient.Configuration.jsonEncoder.encode(oldSession)
        )
        try safetyFenceStorage.markLoggedOut(projectKey: projectKey)
        let persistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        XCTAssertNil(try persistence.retrieve(key: storageKey))

        let newSession = makeSession(
            user: makeUser(),
            sessionID: "new-session",
            refreshToken: "new-refresh"
        )
        try persistence.activate(newSession)

        XCTAssertEqual(try persistence.accessToken(), newSession.accessToken)
        XCTAssertEqual(try safetyFenceStorage.read(projectKey: projectKey), .allowsRestore)
        let restartedPersistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        XCTAssertEqual(try restartedPersistence.accessToken(), newSession.accessToken)
        XCTAssertNotEqual(try restartedPersistence.accessToken(), oldSession.accessToken)
    }

    func testActivationSessionWriteFailureRemainsFailClosed() throws {
        let storageKey = "activation-write-failure"
        let projectKey = "project-write-failure"
        let sessionStorage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        try safetyFenceStorage.markLoggedOut(projectKey: projectKey)
        let persistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        sessionStorage.failNextStore(key: storageKey)

        XCTAssertThrowsError(
            try persistence.activate(
                makeSession(
                    user: makeUser(),
                    sessionID: "new-session",
                    refreshToken: "new-refresh"
                )
            )
        )

        XCTAssertEqual(try safetyFenceStorage.read(projectKey: projectKey), .loggedOut)
        let restartedPersistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        XCTAssertNil(try restartedPersistence.retrieve(key: storageKey))
    }

    func testActivationSafetyFenceClearFailureRemainsFailClosed() throws {
        let storageKey = "activation-clear-failure"
        let projectKey = "project-clear-failure"
        let sessionStorage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        try safetyFenceStorage.markLoggedOut(projectKey: projectKey)
        let persistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        safetyFenceStorage.clearFailuresRemaining = 1

        XCTAssertThrowsError(
            try persistence.activate(
                makeSession(
                    user: makeUser(),
                    sessionID: "new-session",
                    refreshToken: "new-refresh"
                )
            )
        )

        XCTAssertEqual(try safetyFenceStorage.read(projectKey: projectKey), .loggedOut)
        XCTAssertNil(try sessionStorage.retrieve(key: storageKey))
    }

    func testLegacyFenceMigrationFailureRemainsFailClosedAcrossRestart() throws {
        let storageKey = "legacy-migration-failure"
        let projectKey = "project-legacy-failure"
        let legacyFenceKey = "\(storageKey).logout-fence-v1"
        let sessionStorage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let oldSession = makeSession(
            user: makeUser(),
            sessionID: "old-session",
            refreshToken: "old-refresh"
        )
        try sessionStorage.store(
            key: storageKey,
            value: AuthClient.Configuration.jsonEncoder.encode(oldSession)
        )
        try sessionStorage.store(key: legacyFenceKey, value: Data([1]))
        safetyFenceStorage.markFailuresRemaining = 2
        sessionStorage.removeFailuresRemaining = 1

        let firstUpgrade = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        XCTAssertNil(try firstUpgrade.retrieve(key: storageKey))

        let restartedUpgrade = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )
        XCTAssertNil(try restartedUpgrade.retrieve(key: storageKey))
        XCTAssertEqual(try safetyFenceStorage.read(projectKey: projectKey), .loggedOut)
    }

    func testProjectScopedFenceIsolationAndSecretFreeNamespace() throws {
        let sessionStorage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let projectA = "project-a"
        let projectB = "project-b"
        let storageKeyA = "session-a"
        let storageKeyB = "session-b"
        let sessionA = makeSession(
            user: makeUser(),
            sessionID: "session-a",
            refreshToken: "refresh-a"
        )
        let sessionB = makeSession(
            user: makeUser(),
            sessionID: "session-b",
            refreshToken: "refresh-b"
        )
        try sessionStorage.store(
            key: storageKeyA,
            value: AuthClient.Configuration.jsonEncoder.encode(sessionA)
        )
        try sessionStorage.store(
            key: storageKeyB,
            value: AuthClient.Configuration.jsonEncoder.encode(sessionB)
        )
        try safetyFenceStorage.markLoggedOut(projectKey: projectA)

        let persistenceA = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKeyA,
            projectKey: projectA
        )
        let persistenceB = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKeyB,
            projectKey: projectB
        )

        XCTAssertNil(try persistenceA.retrieve(key: storageKeyA))
        XCTAssertEqual(try persistenceB.accessToken(), sessionB.accessToken)
        XCTAssertTrue(
            safetyFenceStorage.observedProjectKeys.allSatisfy {
                $0 == projectA || $0 == projectB
            }
        )
        XCTAssertFalse(
            safetyFenceStorage.observedProjectKeys.joined().contains(sessionA.accessToken)
        )

        let invalidSecretProjectKey = sessionA.accessToken
        _ = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: "invalid-project-session",
            projectKey: invalidSecretProjectKey
        )
        XCTAssertFalse(safetyFenceStorage.observedProjectKeys.contains(invalidSecretProjectKey))
    }

    func testLegacyLogoutFenceMigratesBeforeOldSessionCanRestore() throws {
        let storageKey = "legacy-upgrade-session"
        let projectKey = "project-legacy-upgrade"
        let legacyFenceKey = "\(storageKey).logout-fence-v1"
        let sessionStorage = InMemoryAuthLocalStorage()
        let safetyFenceStorage = InMemoryLogoutSafetyFenceStorage()
        let oldSession = makeSession(
            user: makeUser(),
            sessionID: "old-session",
            refreshToken: "old-refresh"
        )
        try sessionStorage.store(
            key: storageKey,
            value: AuthClient.Configuration.jsonEncoder.encode(oldSession)
        )
        try sessionStorage.store(key: legacyFenceKey, value: Data([1]))

        let upgradedPersistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: safetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey
        )

        XCTAssertNil(try upgradedPersistence.retrieve(key: storageKey))
        XCTAssertEqual(try safetyFenceStorage.read(projectKey: projectKey), .loggedOut)
        XCTAssertNotNil(try sessionStorage.retrieve(key: legacyFenceKey))
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

    @MainActor
    func testSignInPersistenceFailureShowsGenericMessage() async {
        let authService = MockAuthService()
        authService.signInError = AuthSessionPersistenceError.activationFailed
        let viewModel = AuthViewModel(
            authService: authService,
            userRoleService: MockUserRoleService(),
            automaticallyRestoreSession: false
        )

        await viewModel.signIn(email: "test@example.invalid", password: "unused")

        XCTAssertEqual(
            viewModel.errorMessage,
            AuthSessionPersistenceError.userFacingMessage
        )
        XCTAssertFalse(viewModel.errorMessage?.contains("AuthSessionPersistenceError") ?? true)
        XCTAssertFalse(viewModel.errorMessage?.contains("activationFailed") ?? true)
    }

    @MainActor
    func testCallbackPersistenceFailureShowsGenericMessage() async {
        let authService = MockAuthService()
        authService.callbackError = AuthSessionPersistenceError.activationFailed
        let viewModel = AuthViewModel(
            authService: authService,
            userRoleService: MockUserRoleService(),
            automaticallyRestoreSession: false
        )

        await viewModel.handleAuthCallback(
            url: URL(string: "tecm://auth/callback?code=synthetic")!
        )

        XCTAssertEqual(
            viewModel.errorMessage,
            AuthSessionPersistenceError.userFacingMessage
        )
        XCTAssertFalse(viewModel.errorMessage?.contains("AuthSessionPersistenceError") ?? true)
        XCTAssertFalse(viewModel.errorMessage?.contains("activationFailed") ?? true)
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

final class AuthKeychainLocalStorageTests: XCTestCase {
    func testFreshActivationSucceedsWhenLegacyFenceItemsAreMissing() throws {
        let operations = StrictAuthKeychainOperations()
        let storage = AuthKeychainLocalStorage(operations: operations)
        let storageKey = "strict-first-login"
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: InMemoryLogoutSafetyFenceStorage(),
            storageKey: storageKey,
            projectKey: storageKey
        )
        let session = makeSession(
            user: makeUser(),
            sessionID: "strict-first-login",
            refreshToken: "synthetic-refresh"
        )

        XCTAssertNoThrow(try persistence.activate(session))
        XCTAssertEqual(try persistence.accessToken(), session.accessToken)
    }

    func testLegacyFenceIsRemovedBeforeActivationBecomesRestorable() throws {
        let operations = StrictAuthKeychainOperations()
        let storage = AuthKeychainLocalStorage(operations: operations)
        let storageKey = "strict-legacy-fence"
        let legacyFenceKey = "\(storageKey).logout-fence-v1"
        let safetyFence = InMemoryLogoutSafetyFenceStorage()
        try storage.store(key: legacyFenceKey, value: Data([1]))
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFence,
            storageKey: storageKey,
            projectKey: storageKey
        )
        let session = makeSession(
            user: makeUser(),
            sessionID: "strict-legacy-fence",
            refreshToken: "synthetic-refresh"
        )

        try persistence.activate(session)

        XCTAssertNil(try storage.retrieve(key: legacyFenceKey))
        XCTAssertEqual(try persistence.accessToken(), session.accessToken)
        XCTAssertEqual(try safetyFence.read(projectKey: storageKey), .allowsRestore)
    }

    func testNonMissingKeychainErrorKeepsActivationFailClosed() throws {
        let operations = StrictAuthKeychainOperations()
        operations.overrideStatus(errSecInteractionNotAllowed, for: .remove)
        let storage = AuthKeychainLocalStorage(operations: operations)
        let storageKey = "strict-fail-closed"
        let safetyFence = InMemoryLogoutSafetyFenceStorage()
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFence,
            storageKey: storageKey,
            projectKey: storageKey
        )
        let session = makeSession(
            user: makeUser(),
            sessionID: "strict-fail-closed",
            refreshToken: "synthetic-refresh"
        )

        XCTAssertThrowsError(try persistence.activate(session)) { error in
            XCTAssertEqual(error as? AuthSessionPersistenceError, .activationFailed)
        }
        XCTAssertNil(try persistence.accessToken())
        XCTAssertEqual(try safetyFence.read(projectKey: storageKey), .loggedOut)
    }

    func testSessionPersistsAcrossRestartWithStrictKeychainSemantics() throws {
        let operations = StrictAuthKeychainOperations()
        let storage = AuthKeychainLocalStorage(operations: operations)
        let storageKey = "strict-restart"
        let safetyFence = InMemoryLogoutSafetyFenceStorage()
        let session = makeSession(
            user: makeUser(),
            sessionID: "strict-restart",
            refreshToken: "synthetic-refresh"
        )
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFence,
            storageKey: storageKey,
            projectKey: storageKey
        )
        try persistence.activate(session)

        let restarted = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFence,
            storageKey: storageKey,
            projectKey: storageKey
        )

        XCTAssertEqual(try restarted.accessToken(), session.accessToken)
    }

    func testLogoutRestartDoesNotRestoreStrictKeychainSession() throws {
        let operations = StrictAuthKeychainOperations()
        let storage = AuthKeychainLocalStorage(operations: operations)
        let storageKey = "strict-logout-restart"
        let safetyFence = InMemoryLogoutSafetyFenceStorage()
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFence,
            storageKey: storageKey,
            projectKey: storageKey
        )
        try persistence.activate(
            makeSession(
                user: makeUser(),
                sessionID: "strict-logout-restart",
                refreshToken: "synthetic-refresh"
            )
        )

        try persistence.invalidate()
        let restarted = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFence,
            storageKey: storageKey,
            projectKey: storageKey
        )

        XCTAssertNil(try restarted.accessToken())
        XCTAssertEqual(try safetyFence.read(projectKey: storageKey), .loggedOut)
    }

    func testLogoutThenLoginPersistsOnlyNewStrictKeychainSession() throws {
        let operations = StrictAuthKeychainOperations()
        let storage = AuthKeychainLocalStorage(operations: operations)
        let storageKey = "strict-login-again"
        let safetyFence = InMemoryLogoutSafetyFenceStorage()
        let persistence = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFence,
            storageKey: storageKey,
            projectKey: storageKey
        )
        let first = makeSession(
            user: makeUser(),
            sessionID: "strict-first-user",
            refreshToken: "synthetic-first-refresh"
        )
        let second = makeSession(
            user: makeUser(),
            sessionID: "strict-second-user",
            refreshToken: "synthetic-second-refresh"
        )
        try persistence.activate(first)
        try persistence.invalidate()

        try persistence.activate(second)
        let restarted = AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: safetyFence,
            storageKey: storageKey,
            projectKey: storageKey
        )

        XCTAssertEqual(try restarted.accessToken(), second.accessToken)
        XCTAssertNotEqual(try restarted.accessToken(), first.accessToken)
    }

    func testNonMissingStatusesAreReportedWithoutKeyOrValueContext() throws {
        let operations = StrictAuthKeychainOperations()
        operations.overrideStatus(errSecDecode, for: .retrieve)
        let storage = AuthKeychainLocalStorage(operations: operations)

        XCTAssertThrowsError(try storage.retrieve(key: "sensitive-key-sentinel")) { error in
            XCTAssertEqual(
                error as? AuthKeychainStorageError,
                AuthKeychainStorageError(operation: .retrieve, status: errSecDecode)
            )
            XCTAssertFalse(error.localizedDescription.contains("sensitive-key-sentinel"))
        }
    }

    func testStoreUsesUpdateAndDoesNotHideUpdateFailure() throws {
        let operations = StrictAuthKeychainOperations()
        let storage = AuthKeychainLocalStorage(operations: operations)
        try storage.store(key: "strict-update", value: Data("first".utf8))
        operations.overrideStatus(errSecAuthFailed, for: .update)

        XCTAssertThrowsError(
            try storage.store(key: "strict-update", value: Data("second".utf8))
        ) { error in
            XCTAssertEqual(
                error as? AuthKeychainStorageError,
                AuthKeychainStorageError(operation: .update, status: errSecAuthFailed)
            )
        }
    }

    func testPersistenceErrorsExposeOnlyGenericTraditionalChineseMessage() {
        XCTAssertEqual(
            AuthSessionPersistenceError.activationFailed.localizedDescription,
            AuthSessionPersistenceError.userFacingMessage
        )
        XCTAssertFalse(
            AuthSessionPersistenceError.activationFailed.localizedDescription
                .contains("AuthSessionPersistenceError")
        )
        XCTAssertFalse(
            AuthSessionPersistenceError.activationFailed.localizedDescription
                .contains("activationFailed")
        )
    }

    func testRealKeychainRetrieveMissingReturnsNil() throws {
        let fixture = makeRealKeychainFixture()
        defer { fixture.removeAll() }

        XCTAssertNil(try fixture.storage.retrieve(key: fixture.key))
    }

    func testRealKeychainRemoveMissingSucceeds() throws {
        let fixture = makeRealKeychainFixture()
        defer { fixture.removeAll() }

        XCTAssertNoThrow(try fixture.storage.remove(key: fixture.key))
    }

    func testRealKeychainStoreRetrieveRemoveRoundTrip() throws {
        let fixture = makeRealKeychainFixture()
        defer { fixture.removeAll() }
        let value = Data("keychain-round-trip".utf8)

        try fixture.storage.store(key: fixture.key, value: value)
        XCTAssertEqual(try fixture.storage.retrieve(key: fixture.key), value)
        try fixture.storage.remove(key: fixture.key)
        XCTAssertNil(try fixture.storage.retrieve(key: fixture.key))
    }

    private func makeRealKeychainFixture() -> RealKeychainFixture {
        let service = "app.TECMTests.auth-keychain.\(UUID().uuidString)"
        return RealKeychainFixture(
            service: service,
            key: "isolated-test-account",
            storage: AuthKeychainLocalStorage(service: service)
        )
    }
}

private final class MockAuthService: AuthServicing {
    var user: User
    var signInError: Error?
    var callbackError: Error?
    var remoteSignOut: (() async throws -> Void)?
    var includesRemoteSignOutOperation = true
    var localInvalidationError: Error?
    private(set) var prepareRemoteSignOutCallCount = 0
    private(set) var remoteSignOutCallCount = 0
    private(set) var localInvalidationCallCount = 0
    private(set) var localSessionInvalidated = false

    init(user: User = makeUser()) {
        self.user = user
    }

    func signIn(email: String, password: String) async throws -> User {
        if let signInError {
            throw signInError
        }
        localSessionInvalidated = false
        return user
    }

    func prepareSignOut() throws -> AuthSignOutPreparation {
        prepareRemoteSignOutCallCount += 1
        guard !localSessionInvalidated else {
            return AuthSignOutPreparation(accessToken: nil, remoteOperation: nil)
        }
        guard includesRemoteSignOutOperation else {
            return AuthSignOutPreparation(
                accessToken: "synthetic-access-token",
                remoteOperation: nil
            )
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

    func invalidateLocalSession() async throws -> LocalSDKSignOutResult {
        localInvalidationCallCount += 1
        if let localInvalidationError {
            throw localInvalidationError
        }
        localSessionInvalidated = true
        return .signedOutEventObserved
    }

    func restoreSession() async throws -> User? {
        localSessionInvalidated ? nil : user
    }

    func currentUser() async throws -> User? {
        localSessionInvalidated ? nil : user
    }

    func handleAuthCallback(url: URL) async throws -> User {
        if let callbackError {
            throw callbackError
        }
        localSessionInvalidated = false
        return user
    }
}

private struct RealKeychainFixture {
    let service: String
    let key: String
    let storage: AuthKeychainLocalStorage

    func removeAll() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

private final class StrictAuthKeychainOperations:
    AuthKeychainOperating,
    @unchecked Sendable
{
    private struct StorageIdentity: Hashable {
        let service: String?
        let accessGroup: String?
        let account: String
    }

    private let lock = NSLock()
    private var values: [StorageIdentity: Data] = [:]
    private var statusOverrides: [AuthKeychainStorageError.Operation: OSStatus] = [:]

    func overrideStatus(
        _ status: OSStatus,
        for operation: AuthKeychainStorageError.Operation
    ) {
        lock.lock()
        statusOverrides[operation] = status
        lock.unlock()
    }

    func add(
        service: String?,
        accessGroup: String?,
        account: String,
        value: Data
    ) -> OSStatus {
        lock.lock()
        defer { lock.unlock() }
        if let status = statusOverrides[.add] {
            return status
        }
        let identity = StorageIdentity(
            service: service,
            accessGroup: accessGroup,
            account: account
        )
        guard values[identity] == nil else {
            return errSecDuplicateItem
        }
        values[identity] = value
        return errSecSuccess
    }

    func update(
        service: String?,
        accessGroup: String?,
        account: String,
        value: Data
    ) -> OSStatus {
        lock.lock()
        defer { lock.unlock() }
        if let status = statusOverrides[.update] {
            return status
        }
        let identity = StorageIdentity(
            service: service,
            accessGroup: accessGroup,
            account: account
        )
        guard values[identity] != nil else {
            return errSecItemNotFound
        }
        values[identity] = value
        return errSecSuccess
    }

    func retrieve(
        service: String?,
        accessGroup: String?,
        account: String
    ) -> AuthKeychainReadResult {
        lock.lock()
        defer { lock.unlock() }
        if let status = statusOverrides[.retrieve] {
            return AuthKeychainReadResult(status: status, data: nil)
        }
        let identity = StorageIdentity(
            service: service,
            accessGroup: accessGroup,
            account: account
        )
        guard let value = values[identity] else {
            return AuthKeychainReadResult(status: errSecItemNotFound, data: nil)
        }
        return AuthKeychainReadResult(status: errSecSuccess, data: value)
    }

    func remove(
        service: String?,
        accessGroup: String?,
        account: String
    ) -> OSStatus {
        lock.lock()
        defer { lock.unlock() }
        if let status = statusOverrides[.remove] {
            return status
        }
        let identity = StorageIdentity(
            service: service,
            accessGroup: accessGroup,
            account: account
        )
        guard values.removeValue(forKey: identity) != nil else {
            return errSecItemNotFound
        }
        return errSecSuccess
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
    private var storeFailures: [String: Int] = [:]
    var removeFailuresRemaining = 0

    func failNextStore(key: String) {
        lock.lock()
        storeFailures[key, default: 0] += 1
        lock.unlock()
    }

    func store(key: String, value: Data) throws {
        lock.lock()
        defer { lock.unlock() }
        if storeFailures[key, default: 0] > 0 {
            storeFailures[key, default: 0] -= 1
            throw InMemoryStorageError.storeFailed
        }
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

private final class InMemoryLogoutSafetyFenceStorage:
    LogoutSafetyFenceStorage,
    @unchecked Sendable
{
    private let lock = NSLock()
    private var loggedOutProjects: Set<String> = []
    private var corruptProjects: Set<String> = []
    private(set) var observedProjectKeys: [String] = []
    var readFailuresRemaining = 0
    var markFailuresRemaining = 0
    var clearFailuresRemaining = 0

    func read(projectKey: String) throws -> LogoutSafetyFenceState {
        lock.lock()
        defer { lock.unlock() }
        observedProjectKeys.append(projectKey)
        if readFailuresRemaining > 0 {
            readFailuresRemaining -= 1
            throw InMemorySafetyFenceError.readFailed
        }
        if corruptProjects.contains(projectKey) {
            throw InMemorySafetyFenceError.corrupt
        }
        return loggedOutProjects.contains(projectKey) ? .loggedOut : .allowsRestore
    }

    func markLoggedOut(projectKey: String) throws {
        lock.lock()
        defer { lock.unlock() }
        observedProjectKeys.append(projectKey)
        if markFailuresRemaining > 0 {
            markFailuresRemaining -= 1
            throw InMemorySafetyFenceError.markFailed
        }
        corruptProjects.remove(projectKey)
        loggedOutProjects.insert(projectKey)
    }

    func clearAfterValidatedActivation(projectKey: String) throws {
        lock.lock()
        defer { lock.unlock() }
        observedProjectKeys.append(projectKey)
        if clearFailuresRemaining > 0 {
            clearFailuresRemaining -= 1
            throw InMemorySafetyFenceError.clearFailed
        }
        corruptProjects.remove(projectKey)
        loggedOutProjects.remove(projectKey)
    }

    func corrupt(projectKey: String) {
        lock.lock()
        corruptProjects.insert(projectKey)
        lock.unlock()
    }
}

private final class BlockingAuthLocalStorage: AuthLocalStorage, @unchecked Sendable {
    private let lock = NSLock()
    private let blockedKey: String
    private let storeBlocked = DispatchSemaphore(value: 0)
    private let releaseStore = DispatchSemaphore(value: 0)
    private let removalStarted = DispatchSemaphore(value: 0)
    private var values: [String: Data] = [:]
    private var shouldBlockNextStore = false

    init(blockedKey: String) {
        self.blockedKey = blockedKey
    }

    func blockNextStore() {
        lock.lock()
        shouldBlockNextStore = true
        lock.unlock()
    }

    func waitUntilStoreIsBlocked() -> Bool {
        storeBlocked.wait(timeout: .now() + 1) == .success
    }

    func releaseBlockedStore() {
        releaseStore.signal()
    }

    func waitUntilRemovalStarts(timeout: TimeInterval) -> Bool {
        removalStarted.wait(timeout: .now() + timeout) == .success
    }

    func store(key: String, value: Data) throws {
        lock.lock()
        let shouldBlock = key == blockedKey && shouldBlockNextStore
        if shouldBlock {
            shouldBlockNextStore = false
        }
        lock.unlock()

        if shouldBlock {
            storeBlocked.signal()
            releaseStore.wait()
        }

        lock.lock()
        values[key] = value
        lock.unlock()
    }

    func retrieve(key: String) throws -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return values[key]
    }

    func remove(key: String) throws {
        if key == blockedKey {
            removalStarted.signal()
        }
        lock.lock()
        values.removeValue(forKey: key)
        lock.unlock()
    }
}

private enum InMemoryStorageError: Error {
    case storeFailed
    case removeFailed
}

private enum InMemorySafetyFenceError: Error {
    case readFailed
    case markFailed
    case clearFailed
    case corrupt
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

private func makeSession(
    user: User,
    sessionID: String,
    refreshToken: String,
    accessToken: String? = nil
) -> Session {
    Session(
        accessToken: accessToken ?? makeTestJWT(sessionID: sessionID, userID: user.id),
        tokenType: "bearer",
        expiresIn: 3_600,
        expiresAt: Date().addingTimeInterval(3_600).timeIntervalSince1970,
        refreshToken: refreshToken,
        user: user
    )
}

private func makeTestJWT(sessionID: String, userID: UUID) -> String {
    makeTestJWT(
        claims: [
            "session_id": sessionID,
            "sub": userID.uuidString.lowercased(),
        ]
    )
}

private func makeTestJWT(claims: [String: Any]) -> String {
    let payload = try! JSONSerialization.data(
        withJSONObject: claims,
        options: [.sortedKeys]
    )
    let encodedPayload = payload
        .base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "test-header.\(encodedPayload).test-signature"
}
