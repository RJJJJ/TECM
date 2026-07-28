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
    private static var requestObserver: ((URLRequest) -> Void)?

    static var pendingRequestCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return pending.count
    }

    static func reset() {
        lock.lock()
        pending = []
        requestObserver = nil
        lock.unlock()
    }

    static func observeRequests(_ observer: @escaping (URLRequest) -> Void) {
        lock.lock()
        requestObserver = observer
        lock.unlock()
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
        statusCode: Int = 200,
        data: Data
    ) {
        lock.lock()
        let matching = pending.filter {
            $0.request.url?.path.hasSuffix(pathSuffix) == true
        }
        pending.removeAll {
            $0.request.url?.path.hasSuffix(pathSuffix) == true
        }
        lock.unlock()
        for request in matching {
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
        let observer = Self.requestObserver
        Self.lock.unlock()
        observer?(request)
    }

    override func stopLoading() {
        // Intentionally non-cooperative. Tests decide if and when to respond.
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
