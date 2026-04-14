import Foundation
import Supabase
import Combine

@MainActor
final class AuthViewModel: ObservableObject {
    @Published private(set) var currentUser: User?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let authService: AuthServicing

    init(authService: AuthServicing = AuthService()) {
        self.authService = authService
        Task {
            await restoreSession()
        }
    }

    func signIn(email: String, password: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            currentUser = try await authService.signIn(email: email, password: password)
        } catch {
            currentUser = nil
            errorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            try await authService.signOut()
            currentUser = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func restoreSession() async {
        isLoading = true
        defer { isLoading = false }
        do {
            currentUser = try await authService.restoreSession()
        } catch {
            currentUser = nil
        }
    }
}
