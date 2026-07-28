import Foundation
import Supabase

struct RemoteAuthSignOutOperation: Sendable {
    private let operation: @Sendable () async throws -> Void

    init(operation: @escaping @Sendable () async throws -> Void) {
        self.operation = operation
    }

    func run() async throws {
        try await operation()
    }
}

struct SignOutCleanupContext: Sendable, Equatable {
    let accessToken: String
    let userID: UUID?
    let sessionID: String?
}

struct AuthSignOutPreparation: Sendable {
    let cleanupContext: SignOutCleanupContext?
    let remoteOperation: RemoteAuthSignOutOperation?

    init(
        cleanupContext: SignOutCleanupContext?,
        remoteOperation: RemoteAuthSignOutOperation?
    ) {
        self.cleanupContext = cleanupContext
        self.remoteOperation = remoteOperation
    }

    init(
        accessToken: String?,
        remoteOperation: RemoteAuthSignOutOperation?
    ) {
        cleanupContext = accessToken.map {
            SignOutCleanupContext(
                accessToken: $0,
                userID: nil,
                sessionID: nil
            )
        }
        self.remoteOperation = remoteOperation
    }
}

protocol AuthServicing {
    func signIn(email: String, password: String) async throws -> User
    func prepareSignOut() throws -> AuthSignOutPreparation
    func invalidateLocalSession() throws
    func restoreSession() async throws -> User?
    func currentUser() async throws -> User?
    func handleAuthCallback(url: URL) async throws -> User
}

enum LogoutSafetyFenceState: Equatable, Sendable {
    case allowsRestore
    case loggedOut
}

protocol LogoutSafetyFenceStorage: Sendable {
    func read(projectKey: String) throws -> LogoutSafetyFenceState
    func markLoggedOut(projectKey: String) throws
    func clearAfterValidatedActivation(projectKey: String) throws
}

final class UserDefaultsLogoutSafetyFenceStorage: LogoutSafetyFenceStorage, @unchecked Sendable {
    private struct Record: Codable, Equatable {
        let schemaVersion: Int
        let loggedOut: Bool
    }

    private static let currentRecord = Record(schemaVersion: 1, loggedOut: true)
    private let defaults: UserDefaults
    private let keyPrefix: String

    init(
        defaults: UserDefaults,
        keyPrefix: String = "tecm.auth.logout-safety-fence"
    ) {
        self.defaults = defaults
        self.keyPrefix = keyPrefix
    }

    func read(projectKey: String) throws -> LogoutSafetyFenceState {
        let key = storageKey(projectKey: projectKey)
        guard let storedValue = defaults.object(forKey: key) else {
            return .allowsRestore
        }
        guard let data = storedValue as? Data,
              let record = try? JSONDecoder().decode(Record.self, from: data),
              record == Self.currentRecord else {
            throw LogoutSafetyFenceStorageError.corruptRecord
        }
        return .loggedOut
    }

    func markLoggedOut(projectKey: String) throws {
        let data = try JSONEncoder().encode(Self.currentRecord)
        defaults.set(data, forKey: storageKey(projectKey: projectKey))
        guard defaults.synchronize() else {
            throw LogoutSafetyFenceStorageError.persistenceFailed
        }
    }

    func clearAfterValidatedActivation(projectKey: String) throws {
        defaults.removeObject(forKey: storageKey(projectKey: projectKey))
        guard defaults.synchronize() else {
            throw LogoutSafetyFenceStorageError.persistenceFailed
        }
    }

    private func storageKey(projectKey: String) -> String {
        "\(keyPrefix).v1.\(projectKey)"
    }
}

private enum LogoutSafetyFenceStorageError: Error {
    case corruptRecord
    case persistenceFailed
}

final class AuthSessionPersistence: AuthLocalStorage, @unchecked Sendable {
    private struct SessionLineage: Equatable {
        let userID: UUID
        let sessionID: String
    }

    private enum WritePolicy {
        case acceptingAnySession
        case invalidated
        case acceptingSession(SessionLineage)
    }

    private let sessionStorage: any AuthLocalStorage
    private let logoutSafetyFenceStorage: any LogoutSafetyFenceStorage
    private let storageKey: String
    private let projectKey: String
    private let isProjectKeyValid: Bool
    private let legacyLogoutFenceKey: String
    private let lock = NSLock()
    private var writePolicy: WritePolicy

    init(
        sessionStorage: any AuthLocalStorage,
        logoutSafetyFenceStorage: any LogoutSafetyFenceStorage,
        storageKey: String,
        projectKey: String
    ) {
        self.sessionStorage = sessionStorage
        self.logoutSafetyFenceStorage = logoutSafetyFenceStorage
        self.storageKey = storageKey
        self.projectKey = projectKey
        isProjectKeyValid = Self.isValidProjectKey(projectKey)
        legacyLogoutFenceKey = "\(storageKey).logout-fence-v1"
        writePolicy = .invalidated

        guard isProjectKeyValid else {
            return
        }

        do {
            let safetyState = try logoutSafetyFenceStorage.read(projectKey: projectKey)
            if safetyState == .loggedOut {
                writePolicy = .invalidated
                try? sessionStorage.remove(key: storageKey)
                return
            }

            if try sessionStorage.retrieve(key: legacyLogoutFenceKey) != nil {
                try logoutSafetyFenceStorage.markLoggedOut(projectKey: projectKey)
                writePolicy = .invalidated
                try? sessionStorage.remove(key: storageKey)
                return
            }

            writePolicy = .acceptingAnySession
        } catch {
            writePolicy = .invalidated
            try? logoutSafetyFenceStorage.markLoggedOut(projectKey: projectKey)
            try? sessionStorage.remove(key: storageKey)
        }
    }

    func accessToken() throws -> String? {
        guard let data = try retrieve(key: storageKey) else {
            return nil
        }
        return try AuthClient.Configuration.jsonDecoder
            .decode(Session.self, from: data)
            .accessToken
    }

    func signOutCleanupContext() throws -> SignOutCleanupContext? {
        guard let data = try retrieve(key: storageKey) else {
            return nil
        }
        let session = try AuthClient.Configuration.jsonDecoder.decode(Session.self, from: data)
        let lineage = try Self.lineage(from: session)
        return SignOutCleanupContext(
            accessToken: session.accessToken,
            userID: lineage.userID,
            sessionID: lineage.sessionID
        )
    }

    func invalidate() throws {
        lock.lock()
        defer { lock.unlock() }

        writePolicy = .invalidated

        guard isProjectKeyValid else {
            throw AuthSessionPersistenceError.invalidProjectKey
        }

        var fenceStored = false
        var sessionRemoved = false
        var lastError: Error?

        do {
            try logoutSafetyFenceStorage.markLoggedOut(projectKey: projectKey)
            fenceStored = true
        } catch {
            lastError = error
        }

        do {
            try sessionStorage.store(
                key: legacyLogoutFenceKey,
                value: Data([1])
            )
        } catch {
            lastError = error
        }

        do {
            try sessionStorage.remove(key: storageKey)
            sessionRemoved = true
        } catch {
            lastError = error
        }

        guard fenceStored || sessionRemoved else {
            throw lastError ?? AuthSessionPersistenceError.invalidationFailed
        }
    }

    func activate(_ session: Session) throws {
        let lineage = try Self.lineage(from: session)
        let data = try AuthClient.Configuration.jsonEncoder.encode(session)

        lock.lock()
        defer { lock.unlock() }

        guard isProjectKeyValid else {
            throw AuthSessionPersistenceError.invalidProjectKey
        }

        do {
            try sessionStorage.store(key: storageKey, value: data)
            try sessionStorage.remove(key: legacyLogoutFenceKey)
            try logoutSafetyFenceStorage.clearAfterValidatedActivation(
                projectKey: projectKey
            )
            writePolicy = .acceptingSession(lineage)
        } catch {
            writePolicy = .invalidated
            try? logoutSafetyFenceStorage.markLoggedOut(projectKey: projectKey)
            try? sessionStorage.remove(key: storageKey)
            throw AuthSessionPersistenceError.activationFailed
        }
    }

    func store(key: String, value: Data) throws {
        guard key == storageKey else {
            try sessionStorage.store(key: key, value: value)
            return
        }

        let session = try? AuthClient.Configuration.jsonDecoder
            .decode(Session.self, from: value)
        let lineage = session.flatMap { try? Self.lineage(from: $0) }

        lock.lock()
        defer { lock.unlock() }
        switch writePolicy {
        case .acceptingAnySession:
            guard let lineage else { return }
            try sessionStorage.store(key: key, value: value)
            writePolicy = .acceptingSession(lineage)
        case .invalidated:
            return
        case let .acceptingSession(acceptedLineage):
            guard lineage == acceptedLineage else { return }
            try sessionStorage.store(key: key, value: value)
        }
    }

    func retrieve(key: String) throws -> Data? {
        guard key == storageKey else {
            return try sessionStorage.retrieve(key: key)
        }

        lock.lock()
        defer { lock.unlock() }

        if case .invalidated = writePolicy {
            try? sessionStorage.remove(key: storageKey)
            return nil
        }

        guard let data = try sessionStorage.retrieve(key: key) else {
            return nil
        }
        guard let session = try? AuthClient.Configuration.jsonDecoder
            .decode(Session.self, from: data),
              let lineage = try? Self.lineage(from: session) else {
            return nil
        }

        switch writePolicy {
        case .acceptingAnySession:
            writePolicy = .acceptingSession(lineage)
            return data
        case let .acceptingSession(acceptedLineage):
            return lineage == acceptedLineage ? data : nil
        case .invalidated:
            return nil
        }
    }

    func remove(key: String) throws {
        if key == storageKey {
            try invalidate()
        } else {
            try sessionStorage.remove(key: key)
        }
    }

    private static func lineage(from session: Session) throws -> SessionLineage {
        let segments = session.accessToken.split(separator: ".")
        guard segments.count == 3 else {
            throw AuthSessionPersistenceError.invalidSessionLineage
        }
        var payload = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padding = payload.count % 4
        if padding != 0 {
            payload.append(String(repeating: "=", count: 4 - padding))
        }
        guard let data = Data(base64Encoded: payload),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let subject = object["sub"] as? String,
              let subjectID = UUID(uuidString: subject),
              subjectID == session.user.id,
              let sessionID = object["session_id"] as? String,
              !sessionID.isEmpty else {
            throw AuthSessionPersistenceError.invalidSessionLineage
        }
        return SessionLineage(userID: subjectID, sessionID: sessionID)
    }

    private static func isValidProjectKey(_ projectKey: String) -> Bool {
        guard !projectKey.isEmpty, projectKey.count <= 128 else {
            return false
        }
        return projectKey.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || $0 == "-"
        }
    }
}

private enum AuthSessionPersistenceError: Error {
    case invalidSessionLineage
    case invalidationFailed
    case activationFailed
    case invalidProjectKey
}

enum RemoteAuthSignOutError: LocalizedError {
    case failed

    var errorDescription: String? {
        "Remote authentication cleanup could not be completed."
    }
}

struct SupabaseRemoteAuthRevoker: Sendable {
    private let supabaseURL: URL
    private let publishableKey: String
    private let session: URLSession

    init(
        supabaseURL: URL,
        publishableKey: String,
        session: URLSession? = nil
    ) {
        self.supabaseURL = supabaseURL
        self.publishableKey = publishableKey
        self.session = session ?? Self.makeSession()
    }

    func revoke(accessToken: String) async throws {
        var components = URLComponents(
            url: supabaseURL
                .appendingPathComponent("auth")
                .appendingPathComponent("v1")
                .appendingPathComponent("logout"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "scope", value: "global")]
        guard let url = components?.url else {
            throw RemoteAuthSignOutError.failed
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        request.setValue(
            AuthClient.Configuration.defaultHeaders["X-Client-Info"],
            forHTTPHeaderField: "X-Client-Info"
        )
        request.setValue("2024-01-01", forHTTPHeaderField: "X-Supabase-Api-Version")

        let (_, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw RemoteAuthSignOutError.failed
        }
        guard (200..<300).contains(response.statusCode)
                || [401, 403, 404].contains(response.statusCode) else {
            throw RemoteAuthSignOutError.failed
        }
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 10
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }
}

struct AuthService: AuthServicing {
    private let client: SupabaseClient
    private let sessionPersistence: AuthSessionPersistence
    private let remoteRevoker: SupabaseRemoteAuthRevoker

    init(
        client: SupabaseClient = SupabaseClientProvider.shared,
        sessionPersistence: AuthSessionPersistence = SupabaseClientProvider.authSessionPersistence,
        remoteRevoker: SupabaseRemoteAuthRevoker = SupabaseRemoteAuthRevoker(
            supabaseURL: SupabaseClientProvider.configuration.url,
            publishableKey: SupabaseClientProvider.configuration.publishableKey
        )
    ) {
        self.client = client
        self.sessionPersistence = sessionPersistence
        self.remoteRevoker = remoteRevoker
    }

    func signIn(email: String, password: String) async throws -> User {
        let session = try await client.auth.signIn(email: email, password: password)
        try sessionPersistence.activate(session)
        return session.user
    }

    func prepareSignOut() throws -> AuthSignOutPreparation {
        guard let cleanupContext = try sessionPersistence.signOutCleanupContext() else {
            return AuthSignOutPreparation(cleanupContext: nil, remoteOperation: nil)
        }
        let remoteRevoker = remoteRevoker
        return AuthSignOutPreparation(
            cleanupContext: cleanupContext,
            remoteOperation: RemoteAuthSignOutOperation {
                try await remoteRevoker.revoke(accessToken: cleanupContext.accessToken)
            }
        )
    }

    func invalidateLocalSession() throws {
        try sessionPersistence.invalidate()
        let auth = client.auth
        Task {
            await auth.stopAutoRefresh()
        }
    }

    func restoreSession() async throws -> User? {
        try await currentUser()
    }

    func currentUser() async throws -> User? {
        do {
            let session = try await client.auth.session
            return session.user
        } catch {
            return nil
        }
    }

    func handleAuthCallback(url: URL) async throws -> User {
        let session = try await client.auth.session(from: url)
        try sessionPersistence.activate(session)
        return session.user
    }
}
