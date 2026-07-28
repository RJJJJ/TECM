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

struct AuthSignOutPreparation: Sendable {
    let accessToken: String?
    let remoteOperation: RemoteAuthSignOutOperation?
}

protocol AuthServicing {
    func signIn(email: String, password: String) async throws -> User
    func prepareSignOut() throws -> AuthSignOutPreparation
    func invalidateLocalSession() throws
    func restoreSession() async throws -> User?
    func currentUser() async throws -> User?
    func handleAuthCallback(url: URL) async throws -> User
}

final class AuthSessionPersistence: AuthLocalStorage, @unchecked Sendable {
    private enum WritePolicy {
        case acceptingAnySession
        case invalidated
        case acceptingSession(userID: UUID, sessionID: String?)
    }

    private let underlyingStorage: any AuthLocalStorage
    private let storageKey: String
    private let lock = NSLock()
    private var writePolicy: WritePolicy = .acceptingAnySession
    private var persistenceRemovalCompleted = false

    init(underlyingStorage: any AuthLocalStorage, storageKey: String) {
        self.underlyingStorage = underlyingStorage
        self.storageKey = storageKey
    }

    func accessToken() throws -> String? {
        guard let data = try retrieve(key: storageKey) else {
            return nil
        }
        return try AuthClient.Configuration.jsonDecoder
            .decode(Session.self, from: data)
            .accessToken
    }

    func invalidate() throws {
        lock.lock()
        writePolicy = .invalidated
        if persistenceRemovalCompleted {
            lock.unlock()
            return
        }
        lock.unlock()

        try underlyingStorage.remove(key: storageKey)
        lock.lock()
        persistenceRemovalCompleted = true
        lock.unlock()
    }

    func activate(_ session: Session) throws {
        let data = try AuthClient.Configuration.jsonEncoder.encode(session)
        lock.lock()
        writePolicy = .acceptingSession(
            userID: session.user.id,
            sessionID: Self.sessionID(from: session.accessToken)
        )
        persistenceRemovalCompleted = false
        lock.unlock()
        try underlyingStorage.store(key: storageKey, value: data)
    }

    func store(key: String, value: Data) throws {
        guard key == storageKey else {
            try underlyingStorage.store(key: key, value: value)
            return
        }

        lock.lock()
        let writePolicy = writePolicy
        lock.unlock()

        switch writePolicy {
        case .acceptingAnySession:
            try underlyingStorage.store(key: key, value: value)
        case .invalidated:
            return
        case let .acceptingSession(userID, sessionID):
            guard let session = try? AuthClient.Configuration.jsonDecoder
                .decode(Session.self, from: value),
                  session.user.id == userID,
                  sessionID == nil || Self.sessionID(from: session.accessToken) == sessionID else {
                return
            }
            try underlyingStorage.store(key: key, value: value)
        }
    }

    func retrieve(key: String) throws -> Data? {
        if key == storageKey {
            lock.lock()
            let isInvalidated: Bool
            if case .invalidated = writePolicy {
                isInvalidated = true
            } else {
                isInvalidated = false
            }
            lock.unlock()
            if isInvalidated {
                return nil
            }
        }
        return try underlyingStorage.retrieve(key: key)
    }

    func remove(key: String) throws {
        if key == storageKey {
            try invalidate()
        } else {
            try underlyingStorage.remove(key: key)
        }
    }

    private static func sessionID(from accessToken: String) -> String? {
        let segments = accessToken.split(separator: ".")
        guard segments.count > 1 else { return nil }
        var payload = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padding = payload.count % 4
        if padding != 0 {
            payload.append(String(repeating: "=", count: 4 - padding))
        }
        guard let data = Data(base64Encoded: payload),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return object["session_id"] as? String
    }
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
        guard let accessToken = try sessionPersistence.accessToken() else {
            return AuthSignOutPreparation(accessToken: nil, remoteOperation: nil)
        }
        let remoteRevoker = remoteRevoker
        return AuthSignOutPreparation(
            accessToken: accessToken,
            remoteOperation: RemoteAuthSignOutOperation {
                try await remoteRevoker.revoke(accessToken: accessToken)
            }
        )
    }

    func invalidateLocalSession() throws {
        client.auth.stopAutoRefresh()
        try sessionPersistence.invalidate()
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
