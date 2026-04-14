import Foundation
import Supabase

protocol AuthServicing {
    func signIn(email: String, password: String) async throws -> User
    func signOut() async throws
    func restoreSession() async throws -> User?
    func currentUser() async throws -> User?
}

struct AuthService: AuthServicing {
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
    }

    func signIn(email: String, password: String) async throws -> User {
        let session = try await client.auth.signIn(email: email, password: password)
        return session.user
    }

    func signOut() async throws {
        try await client.auth.signOut()
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
}
