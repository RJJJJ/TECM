import Auth
import Foundation
import Supabase
#if DEBUG
import Network
#endif

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

#if DEBUG
final class NetworkDiagnosticsDelegate: NSObject, URLSessionTaskDelegate {
    private final class TaskRecord {
        let taskIdentifier: Int
        let path: String
        let method: String
        let startedAt: Date
        var metrics: URLSessionTaskMetrics?
        var stateObservation: NSKeyValueObservation?
        var didFinish = false

        init(task: URLSessionTask, startedAt: Date) {
            taskIdentifier = task.taskIdentifier
            path = task.originalRequest?.url?.path ?? task.currentRequest?.url?.path ?? ""
            method = task.originalRequest?.httpMethod ?? task.currentRequest?.httpMethod ?? "UNKNOWN"
            self.startedAt = startedAt
        }
    }

    let sessionID = UUID()
    private let lock = NSLock()
    private var tasks: [Int: TaskRecord] = [:]
    private static let fileQueue = DispatchQueue(label: "TECM.network-diagnostics.file")
    private let logFileURL: URL?
    private var didReportFileFailure = false

    override init() {
        logFileURL = Self.documentsLogFileURL
        super.init()
    }

    init(logFileURL: URL?) {
        self.logFileURL = logFileURL
        super.init()
    }

    private static var documentsLogFileURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent("tecm-network-diagnostics.jsonl")
    }

    static func drainFileQueueForTesting() {
        fileQueue.sync {}
    }

    static func appendAttendanceEvent(_ record: [String: Any]) {
        guard ProcessInfo.processInfo.environment["TECM_NETWORK_DIAGNOSTICS"] == "1" else { return }
        fileQueue.async {
            guard writeJSONLine(record, to: documentsLogFileURL) else {
                print("TECM network diagnostics could not write Documents/tecm-network-diagnostics.jsonl.")
                return
            }
        }
    }

    func urlSession(_ session: URLSession, didCreateTask task: URLSessionTask) {
        let record = TaskRecord(task: task, startedAt: Date())
        let stateObservation = task.observe(\URLSessionTask.state, options: [.new]) { [weak self, weak task, weak record] _, _ in
            guard let self, let task, let record, task.state == .completed else { return }
            self.finish(task, matching: record)
        }

        lock.lock()
        tasks[task.taskIdentifier] = record
        record.stateObservation = stateObservation
        lock.unlock()

        append(baseRecord(event: "task_started", taskIdentifier: task.taskIdentifier, path: record.path, method: record.method, at: record.startedAt))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        lock.lock()
        let record = tasks[task.taskIdentifier]
        record?.metrics = metrics
        let isCompleted = task.state == .completed
        lock.unlock()

        var metricsOutput = baseRecord(
            event: "task_metrics",
            taskIdentifier: task.taskIdentifier,
            path: record?.path ?? task.originalRequest?.url?.path ?? task.currentRequest?.url?.path ?? "",
            method: record?.method ?? task.originalRequest?.httpMethod ?? task.currentRequest?.httpMethod ?? "UNKNOWN",
            at: Date()
        )
        metricsOutput["count_of_bytes_received"] = task.countOfBytesReceived
        metricsOutput["count_of_bytes_sent"] = task.countOfBytesSent
        metricsOutput["metrics"] = Self.metricsRecord(metrics)
        append(metricsOutput)

        if isCompleted, let record {
            finish(task, matching: record)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let record = tasks[task.taskIdentifier]
        lock.unlock()

        if let record {
            finish(task, matching: record)
        }
    }

    private func finish(_ task: URLSessionTask, matching expectedRecord: TaskRecord) {
        let stateObservation: NSKeyValueObservation?
        let metrics: URLSessionTaskMetrics?

        lock.lock()
        guard let record = tasks[task.taskIdentifier],
              record === expectedRecord,
              !record.didFinish,
              task.state == .completed else {
            lock.unlock()
            return
        }
        record.didFinish = true
        stateObservation = record.stateObservation
        record.stateObservation = nil
        metrics = record.metrics
        tasks.removeValue(forKey: task.taskIdentifier)
        lock.unlock()

        stateObservation?.invalidate()

        let error = task.error
        let response = task.response as? HTTPURLResponse
        let completedAt = Date()
        var output = baseRecord(
            event: "task_completed",
            taskIdentifier: record.taskIdentifier,
            path: record.path,
            method: record.method,
            at: completedAt
        )
        output["transport_outcome"] = error == nil ? "success" : "failure"
        output["observed_task_interval_seconds"] = Self.duration(from: record.startedAt, to: completedAt)
        if let response {
            output["response_status_code"] = response.statusCode
        } else {
            output["response_status_code"] = NSNull()
        }
        output["count_of_bytes_received"] = task.countOfBytesReceived
        output["count_of_bytes_sent"] = task.countOfBytesSent
        output["full_transport_response"] = task.state == .completed && error == nil && response != nil
        output["errors"] = Self.errorChain(error)
        output["metrics"] = Self.metricsRecord(metrics)
        append(output)
    }

    private func baseRecord(
        event: String,
        taskIdentifier: Int,
        path: String,
        method: String,
        at date: Date
    ) -> [String: Any] {
        [
            "timestamp": Self.timestamp(date),
            "session_id": sessionID.uuidString,
            "task_identifier": taskIdentifier,
            "event": event,
            "path": path,
            "method": method
        ]
    }

    private static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func append(_ record: [String: Any]) {
        Self.fileQueue.async { [self] in
            write(record)
        }
    }

    private func write(_ record: [String: Any]) {
        guard Self.writeJSONLine(record, to: logFileURL) else {
            reportFileFailureOnce()
            return
        }
    }

    private static func writeJSONLine(_ record: [String: Any], to logFileURL: URL?) -> Bool {
        guard let logFileURL else { return false }

        do {
            let data = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) + Data([0x0A])
            if !FileManager.default.fileExists(atPath: logFileURL.path),
               !FileManager.default.createFile(atPath: logFileURL.path, contents: nil) {
                return false
            }

            let handle = try FileHandle(forWritingTo: logFileURL)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            return true
        } catch {
            return false
        }
    }

    private func reportFileFailureOnce() {
        guard !didReportFileFailure else { return }
        didReportFileFailure = true
        print("TECM network diagnostics could not write Documents/tecm-network-diagnostics.jsonl.")
    }

    private static func metricsRecord(_ metrics: URLSessionTaskMetrics?) -> [String: Any] {
        guard let metrics else {
            return ["available": false]
        }

        let transactions: [[String: Any]] = metrics.transactionMetrics.map { transaction in
            let responseStatus: Any
            if let response = transaction.response as? HTTPURLResponse {
                responseStatus = NSNumber(value: response.statusCode)
            } else {
                responseStatus = NSNull()
            }

            let protocolName: Any
            if let name = transaction.networkProtocolName {
                protocolName = name
            } else {
                protocolName = NSNull()
            }

            return [
                "protocol": protocolName,
                "reused_connection": transaction.isReusedConnection,
                "proxy_connection": transaction.isProxyConnection,
                "metrics_http_status_code": responseStatus,
                "dns_seconds": duration(from: transaction.domainLookupStartDate, to: transaction.domainLookupEndDate),
                "connect_seconds": duration(from: transaction.connectStartDate, to: transaction.connectEndDate),
                "tls_seconds": duration(from: transaction.secureConnectionStartDate, to: transaction.secureConnectionEndDate),
                "request_seconds": duration(from: transaction.requestStartDate, to: transaction.requestEndDate),
                "response_seconds": duration(from: transaction.responseStartDate, to: transaction.responseEndDate)
            ]
        }

        return [
            "available": true,
            "redirect_count": metrics.redirectCount,
            "task_interval_seconds": metrics.taskInterval.duration,
            "transactions": transactions
        ]
    }

    private static func duration(from start: Date?, to end: Date?) -> Any {
        guard let start, let end else { return NSNull() }
        let seconds = end.timeIntervalSince(start)
        guard seconds.isFinite, seconds >= 0 else { return NSNull() }
        return seconds
    }

    private static func duration(from start: Date, to end: Date) -> Any {
        duration(from: Optional(start), to: Optional(end))
    }

    private static func errorChain(_ error: Error?) -> [[String: Any]] {
        var current = error.map { $0 as NSError }
        var chain: [[String: Any]] = []

        // Include the top-level error and at most three underlying errors.
        for _ in 0..<4 {
            guard let nsError = current else { break }
            chain.append([
                "domain": nsError.domain,
                "code": nsError.code,
                "cf_stream_error_domain": numericValue(nsError.userInfo["_kCFStreamErrorDomainKey"]),
                "cf_stream_error_code": numericValue(nsError.userInfo["_kCFStreamErrorCodeKey"])
            ])
            current = nsError.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        return chain
    }

    private static func numericValue(_ value: Any?) -> Any {
        guard let number = value as? NSNumber else { return NSNull() }
        return number
    }
}
#endif

final class SupabaseClientLifecycle: @unchecked Sendable {
    enum LifecycleError: LocalizedError, Equatable {
        case staleGeneration
        case generationRetiring

        var errorDescription: String? {
            "Authentication changed. Please try again."
        }
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

    func generationForAuthentication() throws -> Generation {
        lock.lock()
        defer { lock.unlock() }
        let generation = activeGeneration!
        guard signOutTransition?.identity != generation.identity else {
            throw LifecycleError.generationRetiring
        }
        return generation
    }

    func activate(_ session: Session, in generation: Generation) throws {
        lock.lock()
        defer { lock.unlock() }
        guard activeGeneration === generation else {
            throw LifecycleError.staleGeneration
        }
        guard signOutTransition?.identity != generation.identity else {
            throw LifecycleError.generationRetiring
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
            try? await auth.signOut(scope: .local)
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
#if DEBUG
        // Owned staging-only acceptance tunnel. Never falls back to direct
        // transport if the explicitly selected proxy is unavailable.
        if ProcessInfo.processInfo.environment["TECM_NETWORK_STAGING_SOCKS"] == "1" {
            guard #available(iOS 17.0, macOS 14.0, *) else {
                fatalError("TECM staging SOCKS requires iOS 17 or macOS 14; direct transport is disabled for this opt-in.")
            }
            var proxy = ProxyConfiguration(socksv5Proxy: .hostPort(host: "127.0.0.1", port: 19046))
            proxy.matchDomains = ["kolwfvsstutqjnlffebx.supabase.co"]
            proxy.allowFailover = false
            configuration.proxyConfigurations = [proxy]
        }
        // Single-variable diagnostic comparison using Apple's public API.
        // No change to the release loader, timeout, retries or Auth generation.
        if #available(iOS 18.4, macOS 15.4, *),
           ProcessInfo.processInfo.environment["TECM_NETWORK_MODERN_LOADER"] == "1" {
            configuration.usesClassicLoadingMode = false
        }
#endif
#if DEBUG
        if ProcessInfo.processInfo.environment["TECM_NETWORK_DIAGNOSTICS"] == "1" {
            return URLSession(
                configuration: configuration,
                delegate: NetworkDiagnosticsDelegate(),
                delegateQueue: nil
            )
        }
#endif
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
            sessionStorage: AuthKeychainLocalStorage(),
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
