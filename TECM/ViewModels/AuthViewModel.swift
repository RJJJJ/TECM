import Auth
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
    private var signOutCleanup: (() async throws -> Void)?
    private var sensitiveStateCleanup: (() -> Void)?
    private var isSigningOut = false

    static let incompleteRemoteLogoutMessage =
        "You are signed out on this device. Some remote cleanup could not be completed."

    var currentRole: UserAppRole { currentCapabilities.primaryRole }
    var hasParentRole: Bool { currentCapabilities.hasParentRole }
    var canAccessTeacherTools: Bool { currentCapabilities.canAccessTeacherTools }

    init(
        authService: AuthServicing = AuthService(),
        userRoleService: UserRoleServicing = UserRoleService(),
        automaticallyRestoreSession: Bool = true
    ) {
        self.authService = authService
        self.userRoleService = userRoleService
        if automaticallyRestoreSession {
            Task {
                await restoreSession()
            }
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
        guard !isSigningOut else { return }
        guard currentUser != nil || currentCapabilities != .guest else {
            sensitiveStateCleanup?()
            return
        }
        isSigningOut = true
        isLoading = true
        errorMessage = nil
        defer {
            isLoading = false
            isSigningOut = false
        }

        var remoteCleanupIncomplete = false
        if let signOutCleanup {
            do {
                try await signOutCleanup()
            } catch {
                remoteCleanupIncomplete = true
            }
        }

        do {
            try await authService.signOut()
        } catch {
            remoteCleanupIncomplete = true
        }

        currentUser = nil
        currentCapabilities = .guest
        sensitiveStateCleanup?()
        if remoteCleanupIncomplete {
            errorMessage = Self.incompleteRemoteLogoutMessage
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

    func configureSignOutCleanup(_ cleanup: @escaping () async throws -> Void) {
        signOutCleanup = cleanup
    }

    func configureSensitiveStateCleanup(_ cleanup: @escaping () -> Void) {
        sensitiveStateCleanup = cleanup
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
