import Auth
import Foundation
import Supabase

enum LocalSDKSignOutResult: Sendable, Equatable {
    case signedOutEventObserved
    case eventMissing
}

private actor LocalSDKSignOutRace {
    private var result: LocalSDKSignOutResult?
    private var continuation: CheckedContinuation<LocalSDKSignOutResult, Never>?

    func waitForResult() async -> LocalSDKSignOutResult {
        if let result {
            return result
        }
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func resolve(_ result: LocalSDKSignOutResult) {
        guard self.result == nil else { return }
        self.result = result
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(returning: result)
    }
}

final class SupabaseClientLifecycle: @unchecked Sendable {
    enum LifecycleError: Error {
        case staleGeneration
    }

    final class Generation: @unchecked Sendable {
        let identity: UInt64
        let client: SupabaseClient
        let session: URLSession
        let sessionPersistence: AuthSessionPersistence

        init(
            identity: UInt64,
            client: SupabaseClient,
            session: URLSession,
            sessionPersistence: AuthSessionPersistence
        ) {
            self.identity = identity
            self.client = client
            self.session = session
            self.sessionPersistence = sessionPersistence
        }
    }

    typealias SessionFactory = @Sendable () -> URLSession
    typealias DeadlineWaiter = @Sendable (Duration) async -> Void
    typealias SignOutEventObserver = @Sendable (
        AuthClient,
        @escaping @Sendable () -> Void
    ) async -> (any AuthStateChangeListenerRegistration)?
    typealias GenerationDisposer = @Sendable (Generation) -> Void

    private let configuration: SupabaseConfig
    private let sessionStorage: any AuthLocalStorage
    private let logoutSafetyFenceStorage: any LogoutSafetyFenceStorage
    private let storageKey: String
    private let projectKey: String
    private let generationAuthority: AuthSessionGenerationAuthority
    private let signOutEventTimeout: Duration
    private let makeSession: SessionFactory
    private let waitForDeadline: DeadlineWaiter
    private let observeSignOutEvent: SignOutEventObserver
    private let disposeGeneration: GenerationDisposer
    private let lock = NSLock()
    private var activeGeneration: Generation!
    private var signOutTransition: (
        identity: UInt64,
        task: Task<LocalSDKSignOutResult, Error>
    )?

    init(
        configuration: SupabaseConfig,
        sessionStorage: any AuthLocalStorage,
        logoutSafetyFenceStorage: any LogoutSafetyFenceStorage,
        storageKey: String,
        projectKey: String,
        initialIdentity: UInt64 = 1,
        signOutEventTimeout: Duration = .seconds(5),
        makeSession: @escaping SessionFactory = SupabaseClientLifecycle.makeDedicatedSession,
        waitForDeadline: @escaping DeadlineWaiter = { duration in
            try? await ContinuousClock().sleep(for: duration)
        },
        observeSignOutEvent: @escaping SignOutEventObserver =
            SupabaseClientLifecycle.observeGenuineSignOutEvent,
        disposeGeneration: @escaping GenerationDisposer =
            SupabaseClientLifecycle.disposeOldGeneration
    ) {
        self.configuration = configuration
        self.sessionStorage = sessionStorage
        self.logoutSafetyFenceStorage = logoutSafetyFenceStorage
        self.storageKey = storageKey
        self.projectKey = projectKey
        generationAuthority = AuthSessionGenerationAuthority(initialIdentity: initialIdentity)
        self.signOutEventTimeout = signOutEventTimeout
        self.makeSession = makeSession
        self.waitForDeadline = waitForDeadline
        self.observeSignOutEvent = observeSignOutEvent
        self.disposeGeneration = disposeGeneration
        activeGeneration = makeGeneration(identity: initialIdentity)
    }

    var current: Generation {
        lock.lock()
        defer { lock.unlock() }
        return activeGeneration
    }

    func activate(_ session: Session, in generation: Generation) throws {
        lock.lock()
        defer { lock.unlock() }
        guard activeGeneration === generation else {
            throw LifecycleError.staleGeneration
        }
        try generation.sessionPersistence.activate(session)
    }

    @discardableResult
    func signOutCurrentGeneration() async throws -> LocalSDKSignOutResult {
        let transition: (identity: UInt64, task: Task<LocalSDKSignOutResult, Error>)
        lock.lock()
        if let existing = signOutTransition,
           existing.identity == activeGeneration.identity {
            transition = existing
        } else {
            let identity = activeGeneration.identity
            let task = Task {
                try await self.performSignOutCurrentGeneration()
            }
            transition = (identity, task)
            signOutTransition = transition
        }
        lock.unlock()

        do {
            let result = try await transition.task.value
            clearSignOutTransition(identity: transition.identity)
            return result
        } catch {
            clearSignOutTransition(identity: transition.identity)
            throw error
        }
    }

    private func clearSignOutTransition(identity: UInt64) {
        lock.lock()
        if signOutTransition?.identity == identity {
            signOutTransition = nil
        }
        lock.unlock()
    }

    private func performSignOutCurrentGeneration() async throws -> LocalSDKSignOutResult {
        let oldGeneration = current

        // Persist the fail-closed fence and reject refresh writes while keeping
        // the exact old session readable for AuthClient.signOut's guard.
        try oldGeneration.sessionPersistence.beginSDKSignOut()

        let race = LocalSDKSignOutRace()
        let registration = await observeSignOutEvent(oldGeneration.client.auth) {
            Task {
                await race.resolve(.signedOutEventObserved)
            }
        }

        let auth = oldGeneration.client.auth
        let signOutTask = Task {
            _ = auth
        }
        let deadline = signOutEventTimeout
        let waitForDeadline = waitForDeadline
        let deadlineTask = Task {
            await waitForDeadline(deadline)
            await race.resolve(.eventMissing)
        }

        let result = await withTaskCancellationHandler {
            await race.waitForResult()
        } onCancel: {
            Task {
                await race.resolve(.eventMissing)
            }
        }

        registration?.remove()
        deadlineTask.cancel()
        try? oldGeneration.sessionPersistence.invalidate()
        rotateIfCurrent(oldGeneration)

        // Nothing below owns application mutation authority. Cancellation may
        // be ignored by a custom transport, so neither task captures app state.
        signOutTask.cancel()
        disposeGeneration(oldGeneration)

        return result
    }

    private func rotateIfCurrent(_ oldGeneration: Generation) {
        lock.lock()
        defer { lock.unlock() }
        guard activeGeneration === oldGeneration else { return }
        let nextIdentity = oldGeneration.identity.addingReportingOverflow(1)
        precondition(!nextIdentity.overflow, "Supabase client generation exhausted")
        guard generationAuthority.advance(
            from: oldGeneration.identity,
            to: nextIdentity.partialValue
        ) else {
            return
        }
        activeGeneration = makeGeneration(identity: nextIdentity.partialValue)
    }

    private func makeGeneration(identity: UInt64) -> Generation {
        let persistence = AuthSessionPersistence(
            sessionStorage: sessionStorage,
            logoutSafetyFenceStorage: logoutSafetyFenceStorage,
            storageKey: storageKey,
            projectKey: projectKey,
            generationAuthority: generationAuthority,
            generationIdentity: identity
        )
        let session = makeSession()
        let options = SupabaseClientOptions(
            auth: .init(storage: persistence, storageKey: storageKey),
            global: .init(session: session)
        )
        let client = SupabaseClient(
            supabaseURL: configuration.url,
            supabaseKey: configuration.publishableKey,
            options: options
        )
        return Generation(
            identity: identity,
            client: client,
            session: session,
            sessionPersistence: persistence
        )
    }

    static func makeDedicatedSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 5
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }

    static func observeGenuineSignOutEvent(
        _ auth: AuthClient,
        _ onSignedOut: @escaping @Sendable () -> Void
    ) async -> (any AuthStateChangeListenerRegistration)? {
        await auth.onAuthStateChange { event, _ in
            guard event == .signedOut else { return }
            onSignedOut()
        }
    }

    static func disposeOldGeneration(_ generation: Generation) {
        generation.session.invalidateAndCancel()
        Task {
            await generation.client.auth.stopAutoRefresh()
            await generation.client.removeAllChannels()
            generation.client.realtimeV2.disconnect()
        }
    }
}

enum SupabaseClientProvider {
    private struct Context {
        let lifecycle: SupabaseClientLifecycle
        let configuration: SupabaseConfig
    }

    private static let context: Context = {
        let configuration: SupabaseConfig
        do {
            configuration = try SupabaseConfig.load()
        } catch {
            #if DEBUG
            print("Supabase configuration unavailable; using the inert local fallback.")
            #endif
            configuration = SupabaseConfig(
                url: URL(string: "https://invalid.supabase.co")!,
                publishableKey: "invalid-publishable-key"
            )
        }

        let projectReference = configuration.url.host?.split(separator: ".").first ?? "invalid"
        let authStorageKey = "sb-\(projectReference)-auth-token"
        let lifecycle = SupabaseClientLifecycle(
            configuration: configuration,
            sessionStorage: AuthClient.Configuration.defaultLocalStorage,
            logoutSafetyFenceStorage: UserDefaultsLogoutSafetyFenceStorage(defaults: .standard),
            storageKey: authStorageKey,
            projectKey: String(projectReference)
        )
        return Context(lifecycle: lifecycle, configuration: configuration)
    }()

    static var shared: SupabaseClient { context.lifecycle.current.client }
    static var generationIdentity: UInt64 { context.lifecycle.current.identity }
    static var configuration: SupabaseConfig { context.configuration }
    static var authSessionPersistence: AuthSessionPersistence {
        context.lifecycle.current.sessionPersistence
    }
    static var lifecycle: SupabaseClientLifecycle { context.lifecycle }
}

struct SupabaseClientResolver: Sendable {
    private let resolve: @Sendable () -> SupabaseClient

    init(resolve: @escaping @Sendable () -> SupabaseClient) {
        self.resolve = resolve
    }

    init(client: SupabaseClient? = nil) {
        if let client {
            resolve = { client }
        } else {
            resolve = { SupabaseClientProvider.shared }
        }
    }

    var client: SupabaseClient { resolve() }
}
