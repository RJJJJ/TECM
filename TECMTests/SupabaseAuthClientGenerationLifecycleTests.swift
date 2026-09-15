import Auth
import Foundation
import Supabase
import XCTest
@testable import TECM

final class SupabaseAuthClientGenerationLifecycleTests: XCTestCase {
    override func setUp() {
        super.setUp()
        GenerationURLProtocol.reset()
    }

    override func tearDown() {
        GenerationURLProtocol.respondToAll(statusCode: 200)
        GenerationURLProtocol.reset()
        super.tearDown()
    }

    func testT1OfficialLocalSignOutEmitsGenuineEventBeforeRequestCompletes() async throws {
        let fixture = makeFixture()
        let persistence = fixture.makePersistence()
        let oldSession = makeGenerationSession(user: makeGenerationUser(), sessionID: "t1-old")
        try persistence.activate(oldSession)
        let client = fixture.makeClient(persistence: persistence)
        let signedOut = expectation(description: "SDK emitted signedOut")
        let logoutStarted = expectation(description: "SDK started local logout request")
        GenerationURLProtocol.observeRequests { request in
            if request.url?.path.hasSuffix("/auth/v1/logout") == true {
                logoutStarted.fulfill()
            }
        }
        let registration = await client.auth.onAuthStateChange { event, _ in
            if event == .signedOut {
                signedOut.fulfill()
            }
        }

        let signOutTask = Task {
            try await client.auth.signOut(scope: .local)
        }
        await fulfillment(of: [signedOut, logoutStarted], timeout: 1)

        XCTAssertNil(try fixture.storage.retrieve(key: fixture.storageKey))
        XCTAssertNil(client.auth.currentSession)
        XCTAssertEqual(GenerationURLProtocol.pendingRequestCount, 1)

        GenerationURLProtocol.respondToAll(statusCode: 200)
        try await signOutTask.value
        registration.remove()
    }

    func testT2NonCooperativeLogoutRotatesWithinBoundAndLeavesFenceSignedOut() async throws {
        let fixture = makeFixture(signOutEventTimeout: .milliseconds(100))
        let lifecycle = fixture.makeLifecycle()
        let old = lifecycle.current
        try lifecycle.activate(
            makeGenerationSession(user: makeGenerationUser(), sessionID: "t2-old"),
            in: old
        )
        let genuineEvent = expectation(description: "old SDK client emitted signedOut")
        let registration = await old.client.auth.onAuthStateChange { event, _ in
            if event == .signedOut {
                genuineEvent.fulfill()
            }
        }

        let clock = ContinuousClock()
        let start = clock.now
        let result = try await lifecycle.signOutCurrentGeneration()
        let elapsed = start.duration(to: clock.now)
        await fulfillment(of: [genuineEvent], timeout: 1)

        XCTAssertEqual(result, .signedOutEventObserved)
        XCTAssertLessThan(elapsed, .seconds(1))
        XCTAssertEqual(lifecycle.current.identity, old.identity + 1)
        XCTAssertFalse(lifecycle.current === old)
        XCTAssertNil(try fixture.storage.retrieve(key: fixture.storageKey))
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .loggedOut)
        registration.remove()
    }

    func testT3LateRefreshWriteIsConfinedToDiscardedGeneration() async throws {
        let fixture = makeFixture(signOutEventTimeout: .milliseconds(30))
        let lifecycle = fixture.makeLifecycle(disposeGeneration: { _ in })
        let old = lifecycle.current
        let oldSession = makeGenerationSession(
            user: makeGenerationUser(),
            sessionID: "t3-old",
            refreshToken: "t3-refresh"
        )
        try lifecycle.activate(oldSession, in: old)
        let refreshStarted = expectation(description: "old refresh started")
        let oldTokenRefreshed = expectation(description: "old SDK emitted tokenRefreshed")
        let registration = await old.client.auth.onAuthStateChange { event, _ in
            if event == .tokenRefreshed {
                oldTokenRefreshed.fulfill()
            }
        }
        GenerationURLProtocol.observeRequests { request in
            if request.url?.path.hasSuffix("/auth/v1/token") == true {
                refreshStarted.fulfill()
            }
        }
        let refreshTask = Task {
            try? await old.client.auth.refreshSession()
        }
        await fulfillment(of: [refreshStarted], timeout: 1)

        _ = try await lifecycle.signOutCurrentGeneration()
        let fresh = lifecycle.current
        let lateSession = makeGenerationSession(
            user: oldSession.user,
            sessionID: "t3-late",
            refreshToken: "t3-late-refresh"
        )
        GenerationURLProtocol.respond(
            toPathSuffix: "/auth/v1/token",
            data: try AuthClient.Configuration.jsonEncoder.encode(lateSession)
        )
        await fulfillment(of: [oldTokenRefreshed], timeout: 1)
        _ = await refreshTask.value

        XCTAssertFalse(fresh === old)
        XCTAssertNil(fresh.client.auth.currentSession)
        XCTAssertNil(try fixture.storage.retrieve(key: fixture.storageKey))

        registration.remove()
    }

    func testT4DelayedOldGenerationCannotReplaceNextUser() async throws {
        let fixture = makeFixture()
        let lifecycle = fixture.makeLifecycle(
            disposeGeneration: { _ in }
        )
        let old = lifecycle.current
        let activeResolver = SupabaseClientResolver {
            lifecycle.current.client
        }
        let firstUser = makeGenerationUser()
        let oldSession = makeGenerationSession(user: firstUser, sessionID: "t4-old")
        try lifecycle.activate(oldSession, in: old)
        let refreshStarted = expectation(description: "old refresh started")
        let oldTokenRefreshed = expectation(description: "old tokenRefreshed arrived")
        GenerationURLProtocol.observeRequests { request in
            if request.url?.path.hasSuffix("/auth/v1/token") == true {
                refreshStarted.fulfill()
            }
        }
        let registration = await old.client.auth.onAuthStateChange { event, _ in
            if event == .tokenRefreshed {
                oldTokenRefreshed.fulfill()
            }
        }
        let refreshTask = Task {
            try? await old.client.auth.refreshSession()
        }
        await fulfillment(of: [refreshStarted], timeout: 1)
        _ = try await lifecycle.signOutCurrentGeneration()

        let fresh = lifecycle.current
        XCTAssertTrue(activeResolver.client === fresh.client)
        XCTAssertFalse(activeResolver.client === old.client)
        let secondUser = makeGenerationUser()
        let secondSession = makeGenerationSession(user: secondUser, sessionID: "t4-new")
        try lifecycle.activate(secondSession, in: fresh)

        let lateSession = makeGenerationSession(
            user: firstUser,
            sessionID: "t4-late-old",
            refreshToken: "t4-late-refresh"
        )
        GenerationURLProtocol.respond(
            toPathSuffix: "/auth/v1/token",
            data: try AuthClient.Configuration.jsonEncoder.encode(lateSession)
        )
        await fulfillment(of: [oldTokenRefreshed], timeout: 1)
        _ = await refreshTask.value

        XCTAssertEqual(fresh.client.auth.currentSession?.user.id, secondUser.id)
        XCTAssertNotEqual(fresh.client.auth.currentSession?.user.id, firstUser.id)
        XCTAssertEqual(
            try fresh.sessionPersistence.signOutCleanupContext()?.sessionID,
            "t4-new"
        )
        registration.remove()
    }

    func testT5RestartCannotRestoreOldSessionWhileLogoutRequestIsUnavailable() async throws {
        let fixture = makeFixture()
        let lifecycle = fixture.makeLifecycle()
        let old = lifecycle.current
        try lifecycle.activate(
            makeGenerationSession(user: makeGenerationUser(), sessionID: "t5-old"),
            in: old
        )
        _ = try await lifecycle.signOutCurrentGeneration()

        let relaunched = fixture.makeLifecycle(initialIdentity: 99)

        XCTAssertNil(relaunched.current.client.auth.currentSession)
        XCTAssertNil(try fixture.storage.retrieve(key: fixture.storageKey))
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .loggedOut)
    }

    func testT6MissingSDKEventFailsClosedAndQuarantinesOldClient() async throws {
        let fixture = makeFixture(signOutEventTimeout: .milliseconds(20))
        let lifecycle = fixture.makeLifecycle(
            observeSignOutEvent: { _, _ in nil }
        )
        let old = lifecycle.current
        try lifecycle.activate(
            makeGenerationSession(user: makeGenerationUser(), sessionID: "t6-old"),
            in: old
        )
        let genuineEvent = expectation(description: "SDK still emitted signedOut")
        let registration = await old.client.auth.onAuthStateChange { event, _ in
            if event == .signedOut {
                genuineEvent.fulfill()
            }
        }

        let result = try await lifecycle.signOutCurrentGeneration()
        await fulfillment(of: [genuineEvent], timeout: 1)

        XCTAssertEqual(result, .eventMissing)
        XCTAssertFalse(lifecycle.current === old)
        XCTAssertEqual(lifecycle.current.identity, old.identity + 1)
        XCTAssertNil(lifecycle.current.client.auth.currentSession)
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .loggedOut)
        registration.remove()
    }

    func testT7ConcurrentLogoutRequestsShareOneGenerationTransition() async throws {
        let fixture = makeFixture()
        let lifecycle = fixture.makeLifecycle()
        let old = lifecycle.current
        try lifecycle.activate(
            makeGenerationSession(user: makeGenerationUser(), sessionID: "t7-old"),
            in: old
        )

        async let first = lifecycle.signOutCurrentGeneration()
        async let second = lifecycle.signOutCurrentGeneration()
        let results = try await (first, second)

        XCTAssertEqual(results.0, .signedOutEventObserved)
        XCTAssertEqual(results.1, .signedOutEventObserved)
        XCTAssertEqual(lifecycle.current.identity, old.identity + 1)
        XCTAssertNil(lifecycle.current.client.auth.currentSession)
    }

    @MainActor
    func testT8AuthenticationBegunBeforeRetirementCannotActivateAfterRetirement() async throws {
        let gate = GatedSDKSignOutObserver(testCase: self)
        let fixture = makeFixture()
        let lifecycle = fixture.makeLifecycle(
            observeSignOutEvent: { auth, onSignedOut in
                await gate.observe(auth: auth, onSignedOut: onSignedOut)
            },
            disposeGeneration: { _ in }
        )
        let old = lifecycle.current
        try lifecycle.activate(
            makeGenerationSession(user: makeGenerationUser(), sessionID: "t8-old"),
            in: old
        )
        let signInStarted = expectation(description: "pre-retirement password sign-in token request started")
        GenerationURLProtocol.observeRequests { request in
            if request.url?.path.hasSuffix("/auth/v1/token") == true {
                signInStarted.fulfill()
            }
        }
        let roleService = GenerationRoleService()
        let viewModel = AuthViewModel(
            authService: AuthService(lifecycle: lifecycle),
            userRoleService: roleService,
            automaticallyRestoreSession: false
        )

        let signInTask = Task {
            await viewModel.signIn(email: "first@example.invalid", password: "password")
        }
        await fulfillment(of: [signInStarted], timeout: 1)

        let logoutTask = Task {
            try await lifecycle.signOutCurrentGeneration()
        }
        await fulfillment(of: [gate.observerRegistered, gate.genuineEventObserved], timeout: 1)
        XCTAssertEqual(lifecycle.current.identity, old.identity)

        let attemptedUser = makeGenerationUser()
        GenerationURLProtocol.respond(
            toPathSuffix: "/auth/v1/token",
            data: try AuthClient.Configuration.jsonEncoder.encode(
                makeGenerationSession(user: attemptedUser, sessionID: "t8-attempt")
            )
        )
        await signInTask.value

        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
        XCTAssertEqual(
            viewModel.errorMessage,
            SupabaseClientLifecycle.LifecycleError.generationRetiring.localizedDescription
        )
        XCTAssertEqual(roleService.resolutionCount, 0)
        XCTAssertNil(try fixture.storage.retrieve(key: fixture.storageKey))
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .loggedOut)

        gate.release()
        let logoutResult = try await logoutTask.value
        XCTAssertEqual(logoutResult, .signedOutEventObserved)
        XCTAssertEqual(lifecycle.current.identity, old.identity + 1)
        XCTAssertFalse(lifecycle.current === old)
        XCTAssertNil(lifecycle.current.client.auth.currentSession)
    }

    func testT9PasswordSignInAfterRetirementIsRejectedBeforeNetworkAndFreshLoginSucceeds() async throws {
        let gate = GatedSDKSignOutObserver(testCase: self)
        let fixture = makeFixture()
        let lifecycle = fixture.makeLifecycle(
            observeSignOutEvent: { auth, onSignedOut in
                await gate.observe(auth: auth, onSignedOut: onSignedOut)
            },
            disposeGeneration: { _ in }
        )
        let old = lifecycle.current
        try lifecycle.activate(
            makeGenerationSession(user: makeGenerationUser(), sessionID: "t9-old"),
            in: old
        )
        let authService = AuthService(lifecycle: lifecycle)
        let mutationSession = makeGenerationSession(
            user: makeGenerationUser(),
            sessionID: "t9-mutation-retiring"
        )
        let mutationResponse = try AuthClient.Configuration.jsonEncoder.encode(mutationSession)
        GenerationURLProtocol.observeRequests { request in
            if request.url?.path.hasSuffix("/auth/v1/token") == true {
                GenerationURLProtocol.respond(
                    toPathSuffix: "/auth/v1/token",
                    data: mutationResponse
                )
            }
        }

        let logoutTask = Task {
            try await lifecycle.signOutCurrentGeneration()
        }
        await fulfillment(of: [gate.observerRegistered, gate.genuineEventObserved], timeout: 1)

        do {
            _ = try await authService.signIn(email: "retiring@example.invalid", password: "password")
            XCTFail("Expected retiring generation checkout rejection")
        } catch let error as SupabaseClientLifecycle.LifecycleError {
            XCTAssertEqual(error, .generationRetiring)
            XCTAssertEqual(error.localizedDescription, "Authentication changed. Please try again.")
        }
        XCTAssertEqual(GenerationURLProtocol.requestCount(pathSuffix: "/auth/v1/token"), 0)
        XCTAssertNil(try fixture.storage.retrieve(key: fixture.storageKey))
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .loggedOut)

        gate.release()
        let logoutResult = try await logoutTask.value
        XCTAssertEqual(logoutResult, .signedOutEventObserved)
        let fresh = lifecycle.current
        XCTAssertEqual(fresh.identity, old.identity + 1)

        let tokenStarted = expectation(description: "fresh N+1 token request started")
        GenerationURLProtocol.observeRequests { request in
            if request.url?.path.hasSuffix("/auth/v1/token") == true {
                tokenStarted.fulfill()
            }
        }
        let freshTask = Task {
            try await authService.signIn(email: "fresh@example.invalid", password: "password")
        }
        await fulfillment(of: [tokenStarted], timeout: 1)
        let freshUser = makeGenerationUser()
        GenerationURLProtocol.respond(
            toPathSuffix: "/auth/v1/token",
            data: try AuthClient.Configuration.jsonEncoder.encode(
                makeGenerationSession(user: freshUser, sessionID: "t9-fresh")
            )
        )
        let signedInUser = try await freshTask.value

        XCTAssertEqual(signedInUser.id, freshUser.id)
        XCTAssertEqual(fresh.client.auth.currentSession?.user.id, freshUser.id)
        XCTAssertEqual(try fresh.sessionPersistence.signOutCleanupContext()?.sessionID, "t9-fresh")
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .allowsRestore)
        XCTAssertEqual(GenerationURLProtocol.requestCount(pathSuffix: "/auth/v1/token"), 1)
    }

    @MainActor
    func testT10AuthCallbackDuringRetirementIsRejectedAndLaterCallbackOnFreshGenerationSucceeds() async throws {
        let gate = GatedSDKSignOutObserver(testCase: self)
        let fixture = makeFixture()
        let lifecycle = fixture.makeLifecycle(
            observeSignOutEvent: { auth, onSignedOut in
                await gate.observe(auth: auth, onSignedOut: onSignedOut)
            },
            disposeGeneration: { _ in }
        )
        let old = lifecycle.current
        try lifecycle.activate(
            makeGenerationSession(user: makeGenerationUser(), sessionID: "t10-old"),
            in: old
        )
        let roleService = GenerationRoleService()
        let viewModel = AuthViewModel(
            authService: AuthService(lifecycle: lifecycle),
            userRoleService: roleService,
            automaticallyRestoreSession: false
        )
        let mutationSession = makeGenerationSession(
            user: makeGenerationUser(),
            sessionID: "t10-mutation-retiring"
        )
        let mutationResponse = try AuthClient.Configuration.jsonEncoder.encode(mutationSession)
        GenerationURLProtocol.observeRequests { request in
            if request.url?.path.hasSuffix("/auth/v1/token") == true {
                GenerationURLProtocol.respond(
                    toPathSuffix: "/auth/v1/token",
                    data: mutationResponse
                )
            }
        }

        let logoutTask = Task {
            try await lifecycle.signOutCurrentGeneration()
        }
        await fulfillment(of: [gate.observerRegistered, gate.genuineEventObserved], timeout: 1)

        await viewModel.handleAuthCallback(
            url: URL(string: "tecm://auth/callback?code=retiring")!
        )
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
        XCTAssertEqual(
            viewModel.errorMessage,
            SupabaseClientLifecycle.LifecycleError.generationRetiring.localizedDescription
        )
        XCTAssertEqual(roleService.resolutionCount, 0)
        XCTAssertEqual(GenerationURLProtocol.requestCount(pathSuffix: "/auth/v1/token"), 0)
        XCTAssertNil(try fixture.storage.retrieve(key: fixture.storageKey))
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .loggedOut)

        gate.release()
        let logoutResult = try await logoutTask.value
        XCTAssertEqual(logoutResult, .signedOutEventObserved)
        let fresh = lifecycle.current
        XCTAssertEqual(fresh.identity, old.identity + 1)

        let freshCallbackStarted = expectation(
            description: "fresh N+1 callback token exchange started"
        )
        GenerationURLProtocol.observeRequests { request in
            if request.url?.path.hasSuffix("/auth/v1/token") == true {
                freshCallbackStarted.fulfill()
            }
        }
        let callbackTask = Task {
            await viewModel.handleAuthCallback(
                url: URL(string: "tecm://auth/callback?code=fresh")!
            )
        }
        await fulfillment(of: [freshCallbackStarted], timeout: 1)
        let freshUser = makeGenerationUser()
        GenerationURLProtocol.respond(
            toPathSuffix: "/auth/v1/token",
            data: try AuthClient.Configuration.jsonEncoder.encode(
                makeGenerationSession(user: freshUser, sessionID: "t10-fresh")
            )
        )
        await callbackTask.value

        XCTAssertEqual(viewModel.currentUser?.id, freshUser.id)
        XCTAssertEqual(viewModel.currentCapabilities.hasParentRole, true)
        XCTAssertEqual(roleService.resolutionCount, 1)
        XCTAssertEqual(fresh.client.auth.currentSession?.user.id, freshUser.id)
        XCTAssertEqual(try fresh.sessionPersistence.signOutCleanupContext()?.sessionID, "t10-fresh")
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .allowsRestore)
    }

    @MainActor
    func testT11NextUserIsolationSurvivesDelayedOldAuthenticationActivation() async throws {
        let gate = GatedSDKSignOutObserver(testCase: self)
        let disposedGenerationCount = GenerationAtomicCounter()
        let fixture = makeFixture()
        let lifecycle = fixture.makeLifecycle(
            observeSignOutEvent: { auth, onSignedOut in
                await gate.observe(auth: auth, onSignedOut: onSignedOut)
            },
            disposeGeneration: { _ in disposedGenerationCount.increment() }
        )
        let old = lifecycle.current
        try lifecycle.activate(
            makeGenerationSession(user: makeGenerationUser(), sessionID: "t11-old"),
            in: old
        )
        let firstTokenStarted = expectation(description: "old user token request started")
        let secondTokenStarted = expectation(description: "next user token request started")
        let requestCounter = GenerationRequestCounter(
            firstTokenStarted: firstTokenStarted,
            secondTokenStarted: secondTokenStarted
        )
        GenerationURLProtocol.observeRequests(requestCounter.observe)
        let authService = AuthService(lifecycle: lifecycle)
        let viewModel = AuthViewModel(
            authService: authService,
            userRoleService: GenerationRoleService(),
            automaticallyRestoreSession: false
        )

        let oldSignInTask = Task {
            await viewModel.signIn(email: "old@example.invalid", password: "password")
        }
        await fulfillment(of: [firstTokenStarted], timeout: 1)

        let logoutTask = Task {
            try await lifecycle.signOutCurrentGeneration()
        }
        await fulfillment(of: [gate.observerRegistered, gate.genuineEventObserved], timeout: 1)
        gate.release()
        let logoutResult = try await logoutTask.value
        XCTAssertEqual(logoutResult, .signedOutEventObserved)
        XCTAssertEqual(disposedGenerationCount.value, 1)

        let fresh = lifecycle.current
        let activeResolver = SupabaseClientResolver { lifecycle.current.client }
        XCTAssertTrue(activeResolver.client === fresh.client)
        XCTAssertFalse(activeResolver.client === old.client)

        let newSignInTask = Task {
            await viewModel.signIn(email: "new@example.invalid", password: "password")
        }
        await fulfillment(of: [secondTokenStarted], timeout: 1)
        let secondUser = makeGenerationUser()
        GenerationURLProtocol.respond(
            toPathSuffix: "/auth/v1/token",
            occurrence: 2,
            data: try AuthClient.Configuration.jsonEncoder.encode(
                makeGenerationSession(user: secondUser, sessionID: "t11-new")
            )
        )
        await newSignInTask.value

        let router = TabRouter()
        router.select(.parentCenter)
        let notificationID = UUID()
        let pushCoordinator = PushNotificationCoordinator()
        pushCoordinator.handle(
            url: URL(string: "tecm://notifications/\(notificationID.uuidString)")!
        )
        let expectedRoute = AppDeepLinkRoute.notification(notificationID)
        let expectedDisposeCount = disposedGenerationCount.value
        let expectedRealtimeRefreshSequence = pushCoordinator.refreshSequence

        let firstUser = makeGenerationUser()
        GenerationURLProtocol.respond(
            toPathSuffix: "/auth/v1/token",
            occurrence: 1,
            data: try AuthClient.Configuration.jsonEncoder.encode(
                makeGenerationSession(user: firstUser, sessionID: "t11-late-old")
            )
        )
        await oldSignInTask.value
        await Task.yield()

        XCTAssertEqual(viewModel.currentUser?.id, secondUser.id)
        XCTAssertNotEqual(viewModel.currentUser?.id, firstUser.id)
        XCTAssertEqual(viewModel.currentCapabilities.hasParentRole, true)
        XCTAssertTrue(activeResolver.client === fresh.client)
        XCTAssertEqual(fresh.client.auth.currentSession?.user.id, secondUser.id)
        XCTAssertEqual(try fresh.sessionPersistence.signOutCleanupContext()?.sessionID, "t11-new")
        XCTAssertEqual(router.selectedTab, .parentCenter)
        XCTAssertEqual(pushCoordinator.pendingRoute, expectedRoute)
        XCTAssertEqual(pushCoordinator.refreshSequence, expectedRealtimeRefreshSequence)
        XCTAssertEqual(disposedGenerationCount.value, expectedDisposeCount)
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .allowsRestore)
    }

    func testT12ConcurrentLogoutTransitionClearsAndAllowsFreshAuthentication() async throws {
        let gate = GatedSDKSignOutObserver(testCase: self)
        let disposedGenerationCount = GenerationAtomicCounter()
        let fixture = makeFixture()
        let lifecycle = fixture.makeLifecycle(
            observeSignOutEvent: { auth, onSignedOut in
                await gate.observe(auth: auth, onSignedOut: onSignedOut)
            },
            disposeGeneration: { _ in disposedGenerationCount.increment() }
        )
        let old = lifecycle.current
        try lifecycle.activate(
            makeGenerationSession(user: makeGenerationUser(), sessionID: "t12-old"),
            in: old
        )

        async let first = lifecycle.signOutCurrentGeneration()
        async let second = lifecycle.signOutCurrentGeneration()
        await fulfillment(of: [gate.observerRegistered, gate.genuineEventObserved], timeout: 1)
        gate.release()
        let results = try await (first, second)

        XCTAssertEqual(results.0, .signedOutEventObserved)
        XCTAssertEqual(results.1, .signedOutEventObserved)
        XCTAssertEqual(disposedGenerationCount.value, 1)
        XCTAssertEqual(lifecycle.current.identity, old.identity + 1)
        XCTAssertNil(lifecycle.current.client.auth.currentSession)
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .loggedOut)

        let freshTokenStarted = expectation(description: "post-concurrent-logout fresh token request started")
        GenerationURLProtocol.observeRequests { request in
            if request.url?.path.hasSuffix("/auth/v1/token") == true {
                freshTokenStarted.fulfill()
            }
        }
        let fresh = lifecycle.current
        let authService = AuthService(lifecycle: lifecycle)
        let signInTask = Task {
            try await authService.signIn(email: "fresh@example.invalid", password: "password")
        }
        await fulfillment(of: [freshTokenStarted], timeout: 1)
        let freshUser = makeGenerationUser()
        GenerationURLProtocol.respond(
            toPathSuffix: "/auth/v1/token",
            data: try AuthClient.Configuration.jsonEncoder.encode(
                makeGenerationSession(user: freshUser, sessionID: "t12-fresh")
            )
        )
        let signedInUser = try await signInTask.value

        XCTAssertEqual(signedInUser.id, freshUser.id)
        XCTAssertEqual(fresh.client.auth.currentSession?.user.id, freshUser.id)
        XCTAssertEqual(try fresh.sessionPersistence.signOutCleanupContext()?.sessionID, "t12-fresh")
        XCTAssertEqual(try fixture.fence.read(projectKey: fixture.projectKey), .allowsRestore)
    }
}

private struct GenerationFixture: @unchecked Sendable {
    let storage = GenerationAuthStorage()
    let fence = GenerationFenceStorage()
    let storageKey = "test-generation-auth-token"
    let projectKey = "test-generation-project"
    let configuration = SupabaseConfig(
        url: URL(string: "https://test-generation.supabase.co")!,
        publishableKey: "test-publishable-key"
    )
    let signOutEventTimeout: Duration

    func makePersistence() -> AuthSessionPersistence {
        AuthSessionPersistence(
            sessionStorage: storage,
            logoutSafetyFenceStorage: fence,
            storageKey: storageKey,
            projectKey: projectKey
        )
    }

    func makeClient(persistence: AuthSessionPersistence) -> SupabaseClient {
        SupabaseClient(
            supabaseURL: configuration.url,
            supabaseKey: configuration.publishableKey,
            options: SupabaseClientOptions(
                auth: .init(storage: persistence, storageKey: storageKey),
                global: .init(session: makeURLSession())
            )
        )
    }

    func makeLifecycle(
        initialIdentity: UInt64 = 1,
        observeSignOutEvent: SupabaseClientLifecycle.SignOutEventObserver? = nil,
        disposeGeneration: SupabaseClientLifecycle.GenerationDisposer? = nil
    ) -> SupabaseClientLifecycle {
        SupabaseClientLifecycle(
            configuration: configuration,
            sessionStorage: storage,
            logoutSafetyFenceStorage: fence,
            storageKey: storageKey,
            projectKey: projectKey,
            initialIdentity: initialIdentity,
            signOutEventTimeout: signOutEventTimeout,
            makeSession: makeURLSession,
            observeSignOutEvent:
                observeSignOutEvent ?? SupabaseClientLifecycle.observeGenuineSignOutEvent,
            disposeGeneration:
                disposeGeneration ?? SupabaseClientLifecycle.disposeOldGeneration
        )
    }

    private func makeURLSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GenerationURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

private func makeFixture(
    signOutEventTimeout: Duration = .milliseconds(100)
) -> GenerationFixture {
    GenerationFixture(signOutEventTimeout: signOutEventTimeout)
}

private final class GenerationAuthStorage: AuthLocalStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]

    func store(key: String, value: Data) throws {
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
        lock.lock()
        values.removeValue(forKey: key)
        lock.unlock()
    }
}

private final class GenerationFenceStorage: LogoutSafetyFenceStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var loggedOutProjects: Set<String> = []

    func read(projectKey: String) throws -> LogoutSafetyFenceState {
        lock.lock()
        defer { lock.unlock() }
        return loggedOutProjects.contains(projectKey) ? .loggedOut : .allowsRestore
    }

    func markLoggedOut(projectKey: String) throws {
        lock.lock()
        loggedOutProjects.insert(projectKey)
        lock.unlock()
    }

    func clearAfterValidatedActivation(projectKey: String) throws {
        lock.lock()
        loggedOutProjects.remove(projectKey)
        lock.unlock()
    }
}

private final class GenerationURLProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var pending: [GenerationURLProtocol] = []
    private static var observedRequests: [URLRequest] = []
    private static var requestObserver: ((URLRequest) -> Void)?

    static var pendingRequestCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return pending.count
    }

    static func reset() {
        lock.lock()
        pending = []
        observedRequests = []
        requestObserver = nil
        lock.unlock()
    }

    static func observeRequests(_ observer: @escaping (URLRequest) -> Void) {
        lock.lock()
        requestObserver = observer
        lock.unlock()
    }

    static func requestCount(pathSuffix: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return observedRequests.filter {
            $0.url?.path.hasSuffix(pathSuffix) == true
        }.count
    }

    static func respondToAll(statusCode: Int) {
        lock.lock()
        let requests = pending
        pending = []
        lock.unlock()
        for request in requests {
            respond(request, statusCode: statusCode, data: Data("{}".utf8))
        }
    }

    static func respond(
        toPathSuffix pathSuffix: String,
        occurrence: Int? = nil,
        statusCode: Int = 200,
        data: Data
    ) {
        lock.lock()
        let matching = pending.enumerated().filter {
            $0.element.request.url?.path.hasSuffix(pathSuffix) == true
        }
        let selected: [GenerationURLProtocol]
        if let occurrence {
            guard matching.indices.contains(occurrence - 1) else {
                lock.unlock()
                return
            }
            selected = [matching[occurrence - 1].element]
            pending.removeAll { protocolInstance in
                selected.contains { $0 === protocolInstance }
            }
        } else {
            selected = matching.map { $0.element }
            pending.removeAll {
                $0.request.url?.path.hasSuffix(pathSuffix) == true
            }
        }
        lock.unlock()
        for request in selected {
            respond(request, statusCode: statusCode, data: data)
        }
    }

    private static func respond(
        _ request: GenerationURLProtocol,
        statusCode: Int,
        data: Data
    ) {
        guard let url = request.request.url,
              let response = HTTPURLResponse(
                  url: url,
                  statusCode: statusCode,
                  httpVersion: nil,
                  headerFields: ["Content-Type": "application/json"]
              ) else {
            return
        }
        request.client?.urlProtocol(
            request,
            didReceive: response,
            cacheStoragePolicy: .notAllowed
        )
        request.client?.urlProtocol(request, didLoad: data)
        request.client?.urlProtocolDidFinishLoading(request)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.pending.append(self)
        Self.observedRequests.append(request)
        let observer = Self.requestObserver
        Self.lock.unlock()
        observer?(request)
    }

    override func stopLoading() {
        Self.lock.lock()
        Self.pending.removeAll { $0 === self }
        Self.lock.unlock()
    }
}

private final class GatedSDKSignOutObserver: @unchecked Sendable {
    let observerRegistered: XCTestExpectation
    let genuineEventObserved: XCTestExpectation
    private let lock = NSLock()
    private var callback: (@Sendable () -> Void)?
    private var released = false
    private var observed = false

    init(testCase: XCTestCase) {
        observerRegistered = testCase.expectation(description: "genuine SDK signedOut observer registered")
        genuineEventObserved = testCase.expectation(description: "genuine SDK signedOut event observed")
    }

    func observe(
        auth: AuthClient,
        onSignedOut: @escaping @Sendable () -> Void
    ) async -> (any AuthStateChangeListenerRegistration)? {
        let registration = await auth.onAuthStateChange { [weak self] event, _ in
            guard event == .signedOut else { return }
            self?.capture(onSignedOut)
        }
        observerRegistered.fulfill()
        return registration
    }

    func release() {
        let callbackToRun: (@Sendable () -> Void)?
        lock.lock()
        released = true
        callbackToRun = callback
        callback = nil
        lock.unlock()
        callbackToRun?()
    }

    private func capture(_ onSignedOut: @escaping @Sendable () -> Void) {
        let callbackToRun: (@Sendable () -> Void)?
        lock.lock()
        if !observed {
            observed = true
            genuineEventObserved.fulfill()
        }
        if released {
            callbackToRun = onSignedOut
        } else {
            callback = onSignedOut
            callbackToRun = nil
        }
        lock.unlock()
        callbackToRun?()
    }
}

private final class GenerationRequestCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var tokenRequestCount = 0
    private let firstTokenStarted: XCTestExpectation
    private let secondTokenStarted: XCTestExpectation

    init(
        firstTokenStarted: XCTestExpectation,
        secondTokenStarted: XCTestExpectation
    ) {
        self.firstTokenStarted = firstTokenStarted
        self.secondTokenStarted = secondTokenStarted
    }

    func observe(_ request: URLRequest) {
        guard request.url?.path.hasSuffix("/auth/v1/token") == true else { return }
        let count: Int
        lock.lock()
        tokenRequestCount += 1
        count = tokenRequestCount
        lock.unlock()
        if count == 1 {
            firstTokenStarted.fulfill()
        } else if count == 2 {
            secondTokenStarted.fulfill()
        }
    }
}

private final class GenerationAtomicCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    var value: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    func increment() {
        lock.lock()
        count += 1
        lock.unlock()
    }
}

private final class GenerationRoleService: UserRoleServicing, @unchecked Sendable {
    private let counter = GenerationAtomicCounter()

    var resolutionCount: Int { counter.value }

    func resolveCapabilities(userID: UUID) async throws -> UserRoleCapabilities {
        counter.increment()
        return UserRoleCapabilities.resolve(
            organizationRoleNames: [],
            hasParentProfile: true
        )
    }
}

private func makeGenerationUser(id: UUID = UUID()) -> User {
    User(
        id: id,
        appMetadata: [:],
        userMetadata: [:],
        aud: "authenticated",
        createdAt: Date(),
        updatedAt: Date()
    )
}

private func makeGenerationSession(
    user: User,
    sessionID: String,
    refreshToken: String = "test-refresh-token"
) -> Session {
    Session(
        accessToken: makeGenerationJWT(sessionID: sessionID, userID: user.id),
        tokenType: "bearer",
        expiresIn: 3_600,
        expiresAt: Date().addingTimeInterval(3_600).timeIntervalSince1970,
        refreshToken: refreshToken,
        user: user
    )
}

private func makeGenerationJWT(sessionID: String, userID: UUID) -> String {
    let payload = try! JSONSerialization.data(
        withJSONObject: [
            "session_id": sessionID,
            "sub": userID.uuidString.lowercased(),
        ],
        options: [.sortedKeys]
    )
    let encoded = payload
        .base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "test-header.\(encoded).test-signature"
}
