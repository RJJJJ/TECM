import Auth
import Foundation
import Supabase
import Combine

private enum RemoteAuthSignOutResult: Sendable {
    case succeeded
    case failed
    case timedOut
}

private actor RemoteAuthSignOutRace {
    private var result: RemoteAuthSignOutResult?
    private var continuation: CheckedContinuation<RemoteAuthSignOutResult, Never>?

    func waitForResult() async -> RemoteAuthSignOutResult {
        if let result {
            return result
        }
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func resolve(_ result: RemoteAuthSignOutResult) {
        guard self.result == nil else { return }
        self.result = result
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(returning: result)
    }
}

struct AppSignOutCleanupPreparation: Sendable {
    let remoteOperation: RemoteAuthSignOutOperation?
}

@MainActor
final class AuthViewModel: ObservableObject {
    @Published private(set) var currentUser: User?
    @Published private(set) var currentCapabilities: UserRoleCapabilities = .guest
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let authService: AuthServicing
    private let userRoleService: UserRoleServicing
    private var signOutCleanup: ((SignOutCleanupContext?) async -> AppSignOutCleanupPreparation)?
    private var sensitiveStateCleanup: (() -> Void)?
    private var isSigningOut = false
    private var authenticationGeneration: UInt64 = 0
    private let remoteAuthSignOutTimeout: Duration
    private let waitForRemoteAuthSignOutDeadline: @MainActor @Sendable (Duration) async -> Void

    static let incompleteRemoteLogoutMessage =
        "You are signed out on this device. Some remote cleanup could not be completed."

    var currentRole: UserAppRole { currentCapabilities.primaryRole }
    var hasParentRole: Bool { currentCapabilities.hasParentRole }
    var canAccessTeacherTools: Bool { currentCapabilities.canAccessTeacherTools }

    init(
        authService: AuthServicing = AuthService(),
        userRoleService: UserRoleServicing = UserRoleService(),
        automaticallyRestoreSession: Bool = true,
        remoteAuthSignOutTimeout: Duration = .seconds(5),
        waitForRemoteAuthSignOutDeadline: @escaping @MainActor @Sendable (Duration) async -> Void = { duration in
            try? await ContinuousClock().sleep(for: duration)
        }
    ) {
        self.authService = authService
        self.userRoleService = userRoleService
        self.remoteAuthSignOutTimeout = remoteAuthSignOutTimeout
        self.waitForRemoteAuthSignOutDeadline = waitForRemoteAuthSignOutDeadline
        if automaticallyRestoreSession {
            Task {
                await restoreSession()
            }
        }
    }

    func signIn(email: String, password: String) async {
        let generation = beginAuthenticationOperation()
        isLoading = true
        errorMessage = nil

        do {
            let user = try await authService.signIn(email: email, password: password)
            guard isCurrent(generation) else { return }
            currentUser = user
            currentCapabilities = .guest
            await resolveRole(for: user, generation: generation)
        } catch {
            guard isCurrent(generation) else { return }
            currentUser = nil
            currentCapabilities = .guest
            errorMessage = error.localizedDescription
        }
        if isCurrent(generation) {
            isLoading = false
        }
    }

    func signOut() async {
        guard !isSigningOut else { return }
        isSigningOut = true
        let generation = beginAuthenticationOperation()
        let hadAuthenticatedState = currentUser != nil || currentCapabilities != .guest
        errorMessage = nil
        isLoading = false

        var remoteCleanupIncomplete = false
        let signOutPreparation: AuthSignOutPreparation
        do {
            signOutPreparation = try authService.prepareSignOut()
        } catch {
            signOutPreparation = AuthSignOutPreparation(
                accessToken: nil,
                remoteOperation: nil
            )
            remoteCleanupIncomplete = true
        }

        currentUser = nil
        currentCapabilities = .guest
        sensitiveStateCleanup?()

        var localSessionInvalidated = false
        do {
            try authService.invalidateLocalSession()
            localSessionInvalidated = true
        } catch {
            remoteCleanupIncomplete = true
        }

        let shouldRunAppCleanup =
            hadAuthenticatedState || signOutPreparation.remoteOperation != nil
        let appCleanupContext =
            localSessionInvalidated ? signOutPreparation.cleanupContext : nil
        let appCleanupPreparation: AppSignOutCleanupPreparation?
        if shouldRunAppCleanup, let signOutCleanup {
            appCleanupPreparation = await signOutCleanup(appCleanupContext)
        } else {
            appCleanupPreparation = nil
        }

        if localSessionInvalidated, let remoteAuthOperation = signOutPreparation.remoteOperation {
            let result = await runBoundedRemoteAuthSignOut(remoteAuthOperation)
            if case .succeeded = result {
                // The local privacy boundary is already complete.
            } else {
                remoteCleanupIncomplete = true
            }
        }
        if let remoteAppCleanup = appCleanupPreparation?.remoteOperation {
            let result = await runBoundedRemoteAuthSignOut(remoteAppCleanup)
            if case .succeeded = result {
                // The operation owns no local mutation authority.
            } else {
                remoteCleanupIncomplete = true
            }
        }

        isSigningOut = false
        if isCurrent(generation), currentUser == nil, remoteCleanupIncomplete {
            errorMessage = Self.incompleteRemoteLogoutMessage
        }
    }

    func handleAuthCallback(url: URL) async {
        guard AppDeepLinkRoute.parse(url) == .authCallback else { return }
        let generation = beginAuthenticationOperation()
        isLoading = true
        errorMessage = nil

        do {
            let user = try await authService.handleAuthCallback(url: url)
            guard isCurrent(generation) else { return }
            currentUser = user
            currentCapabilities = .guest
            await resolveRole(for: user, generation: generation)
        } catch {
            guard isCurrent(generation) else { return }
            currentUser = nil
            currentCapabilities = .guest
            errorMessage = error.localizedDescription
        }
        if isCurrent(generation) {
            isLoading = false
        }
    }

    func configureSignOutCleanup(
        _ cleanup: @escaping (SignOutCleanupContext?) async -> AppSignOutCleanupPreparation
    ) {
        signOutCleanup = cleanup
    }

    func configureSensitiveStateCleanup(_ cleanup: @escaping () -> Void) {
        sensitiveStateCleanup = cleanup
    }

    func restoreSession() async {
        let generation = beginAuthenticationOperation()
        isLoading = true
        do {
            let user = try await authService.restoreSession()
            guard isCurrent(generation) else { return }
            currentUser = user
            currentCapabilities = .guest
            if let user {
                await resolveRole(for: user, generation: generation)
            }
        } catch {
            guard isCurrent(generation) else { return }
            currentUser = nil
            currentCapabilities = .guest
        }
        if isCurrent(generation) {
            isLoading = false
        }
    }

    private func resolveRole(for user: User, generation: UInt64) async {
        do {
            let capabilities = try await userRoleService.resolveCapabilities(userID: user.id)
            guard isCurrent(generation), currentUser?.id == user.id else { return }
            currentCapabilities = capabilities
        } catch {
            guard isCurrent(generation), currentUser?.id == user.id else { return }
            currentCapabilities = .guest
        }
    }

    private func beginAuthenticationOperation() -> UInt64 {
        authenticationGeneration &+= 1
        return authenticationGeneration
    }

    private func isCurrent(_ generation: UInt64) -> Bool {
        authenticationGeneration == generation
    }

    private func runBoundedRemoteAuthSignOut(
        _ operation: RemoteAuthSignOutOperation
    ) async -> RemoteAuthSignOutResult {
        guard !Task.isCancelled else { return .failed }

        let timeout = remoteAuthSignOutTimeout
        let waitForDeadline = waitForRemoteAuthSignOutDeadline
        let race = RemoteAuthSignOutRace()

        let remoteTask = Task { [weak race] in
            guard !Task.isCancelled else { return }
            do {
                try await operation.run()
                await race?.resolve(.succeeded)
            } catch {
                await race?.resolve(.failed)
            }
        }
        let deadlineTask = Task { @MainActor [weak race] in
            await waitForDeadline(timeout)
            await race?.resolve(.timedOut)
        }

        let result = await withTaskCancellationHandler {
            await race.waitForResult()
        } onCancel: {
            Task {
                // MUTATION M9: make cancellation wait behind non-cooperative cleanup.
                try? await ContinuousClock().sleep(for: .seconds(2))
                await race.resolve(.failed)
            }
        }
        remoteTask.cancel()
        deadlineTask.cancel()
        return result
    }
}
