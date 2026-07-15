import Foundation
import Supabase
import Combine

@MainActor
final class AuthViewModel: ObservableObject {
    @Published private(set) var currentUser: User?
    @Published private(set) var currentCapabilities: UserRoleCapabilities = .guest
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let authService: AuthServicing
    private let userRoleService: UserRoleServicing
    private var signOutCleanup: (() async -> Void)?

    var currentRole: UserAppRole { currentCapabilities.primaryRole }
    var hasParentRole: Bool { currentCapabilities.hasParentRole }
    var canAccessTeacherTools: Bool { currentCapabilities.canAccessTeacherTools }

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
            currentCapabilities = .guest
            errorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            if let signOutCleanup {
                await signOutCleanup()
            }
            try await authService.signOut()
            currentUser = nil
            currentCapabilities = .guest
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func handleAuthCallback(url: URL) async {
        guard AppDeepLinkRoute.parse(url) == .authCallback else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            currentUser = try await authService.handleAuthCallback(url: url)
            await resolveRole()
        } catch {
            currentUser = nil
            currentCapabilities = .guest
            errorMessage = error.localizedDescription
        }
    }

    func configureSignOutCleanup(_ cleanup: @escaping () async -> Void) {
        signOutCleanup = cleanup
    }

    func restoreSession() async {
        isLoading = true
        defer { isLoading = false }
        do {
            currentUser = try await authService.restoreSession()
            await resolveRole()
        } catch {
            currentUser = nil
            currentCapabilities = .guest
        }
    }

    func resolveRole() async {
        guard let userID = currentUser?.id else {
            currentCapabilities = .guest
            return
        }

        do {
            currentCapabilities = try await userRoleService.resolveCapabilities(userID: userID)
        } catch {
            currentCapabilities = .guest
        }
    }
}
