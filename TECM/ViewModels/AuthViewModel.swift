import Foundation
import Supabase
import Combine

@MainActor
final class AuthViewModel: ObservableObject {
    @Published private(set) var currentUser: User?
    @Published private(set) var currentRole: UserAppRole = .guest
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let authService: AuthServicing
    private let userRoleService: UserRoleServicing

    init(
        authService: AuthServicing = AuthService(),
        userRoleService: UserRoleServicing = UserRoleService()
    ) {
        self.authService = authService
        self.userRoleService = userRoleService
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
            await resolveRole()
        } catch {
            currentUser = nil
            currentRole = .guest
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
            currentRole = .guest
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func restoreSession() async {
        isLoading = true
        defer { isLoading = false }
        do {
            currentUser = try await authService.restoreSession()
            await resolveRole()
        } catch {
            currentUser = nil
            currentRole = .guest
        }
    }

    func resolveRole() async {
        guard let userID = currentUser?.id else {
            currentRole = .guest
            return
        }

        do {
            currentRole = try await userRoleService.resolveRole(userID: userID)
        } catch {
            currentRole = .guest
        }
    }
}
