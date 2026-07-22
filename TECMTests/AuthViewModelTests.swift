import Foundation
import Supabase
import XCTest
@testable import TECM

@MainActor
final class AuthViewModelTests: XCTestCase {
    func testSuccessfulDeviceDeactivationPrecedesLogout() async {
        var events: [String] = []
        let authService = MockAuthService()
        authService.onSignOut = { events.append("signOut") }
        let viewModel = await makeSignedInViewModel(authService: authService)
        viewModel.configureSignOutCleanup { events.append("cleanup") }

        await viewModel.signOut()

        XCTAssertEqual(events, ["cleanup", "signOut"])
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testDeviceDeactivationNetworkFailureStillLogsOutAndClearsSensitiveState() async {
        await assertCleanupFailureStillLogsOut(.network)
    }

    func testDeviceDeactivationTimeoutStillLogsOutAndClearsSensitiveState() async {
        await assertCleanupFailureStillLogsOut(.timeout)
    }

    func testSupabaseSignOutFailureStillClearsAuthenticatedState() async {
        let authService = MockAuthService()
        authService.signOutError = MockError.network
        let viewModel = await makeSignedInViewModel(authService: authService)
        var sensitiveStateCleared = false
        viewModel.configureSensitiveStateCleanup { sensitiveStateCleared = true }

        await viewModel.signOut()

        XCTAssertEqual(authService.signOutCallCount, 1)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
        XCTAssertTrue(sensitiveStateCleared)
        XCTAssertEqual(viewModel.errorMessage, AuthViewModel.incompleteRemoteLogoutMessage)
    }

    func testRepeatedLogoutIsIdempotent() async {
        let authService = MockAuthService()
        let viewModel = await makeSignedInViewModel(authService: authService)
        var cleanupCount = 0
        viewModel.configureSignOutCleanup { cleanupCount += 1 }

        await viewModel.signOut()
        await viewModel.signOut()

        XCTAssertEqual(cleanupCount, 1)
        XCTAssertEqual(authService.signOutCallCount, 1)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
    }

    func testSubsequentUserDoesNotInheritPreviousAuthenticatedState() async {
        let firstUser = makeUser()
        let secondUser = makeUser()
        let authService = MockAuthService(user: firstUser)
        let viewModel = AuthViewModel(
            authService: authService,
            userRoleService: MockUserRoleService(),
            automaticallyRestoreSession: false
        )
        var sensitiveStateClearCount = 0
        viewModel.configureSensitiveStateCleanup { sensitiveStateClearCount += 1 }

        await viewModel.signIn(email: "first@example.invalid", password: "unused")
        await viewModel.signOut()
        authService.user = secondUser
        await viewModel.signIn(email: "second@example.invalid", password: "unused")

        XCTAssertEqual(sensitiveStateClearCount, 1)
        XCTAssertEqual(viewModel.currentUser?.id, secondUser.id)
        XCTAssertNotEqual(viewModel.currentUser?.id, firstUser.id)
    }

    private func makeSignedInViewModel(authService: MockAuthService) async -> AuthViewModel {
        let viewModel = AuthViewModel(
            authService: authService,
            userRoleService: MockUserRoleService(),
            automaticallyRestoreSession: false
        )
        await viewModel.signIn(email: "test@example.invalid", password: "unused")
        return viewModel
    }

    private func assertCleanupFailureStillLogsOut(_ error: MockError) async {
        let authService = MockAuthService()
        let viewModel = await makeSignedInViewModel(authService: authService)
        var sensitiveStateCleared = false
        viewModel.configureSignOutCleanup { throw error }
        viewModel.configureSensitiveStateCleanup { sensitiveStateCleared = true }

        await viewModel.signOut()

        XCTAssertEqual(authService.signOutCallCount, 1)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
        XCTAssertTrue(sensitiveStateCleared)
        XCTAssertEqual(viewModel.errorMessage, AuthViewModel.incompleteRemoteLogoutMessage)
        XCTAssertFalse(viewModel.errorMessage?.contains(MockError.sensitiveSentinel) ?? true)
    }
}

private final class MockAuthService: AuthServicing {
    var user: User
    var signOutError: Error?
    var onSignOut: (() -> Void)?
    private(set) var signOutCallCount = 0

    init(user: User = makeUser()) {
        self.user = user
    }

    func signIn(email: String, password: String) async throws -> User { user }

    func signOut() async throws {
        signOutCallCount += 1
        onSignOut?()
        if let signOutError { throw signOutError }
    }

    func restoreSession() async throws -> User? { user }
    func currentUser() async throws -> User? { user }
    func handleAuthCallback(url: URL) async throws -> User { user }
}

private struct MockUserRoleService: UserRoleServicing {
    func resolveCapabilities(userID: UUID) async throws -> UserRoleCapabilities {
        UserRoleCapabilities.resolve(organizationRoleNames: [], hasParentProfile: true)
    }
}

private enum MockError: LocalizedError {
    case network
    case timeout

    static let sensitiveSentinel = "device-token-secret-sentinel"

    var errorDescription: String? {
        Self.sensitiveSentinel
    }
}

private func makeUser(id: UUID = UUID()) -> User {
    User(
        id: id,
        appMetadata: [:],
        userMetadata: [:],
        aud: "authenticated",
        createdAt: Date(),
        updatedAt: Date()
    )
}
