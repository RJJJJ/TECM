import Foundation
import Supabase
import XCTest
@testable import TECM

@MainActor
final class AuthViewModelTests: XCTestCase {
    func testSignOutRunsDeviceCleanupBeforeAuthSignOut() async {
        let authService = MockAuthService()
        let viewModel = AuthViewModel(
            authService: authService,
            userRoleService: MockUserRoleService()
        )
        var cleanupCompleted = false
        viewModel.configureSignOutCleanup {
            cleanupCompleted = true
        }

        await viewModel.signOut()

        XCTAssertTrue(cleanupCompleted)
        XCTAssertTrue(authService.signOutCalled)
        XCTAssertNil(viewModel.currentUser)
        XCTAssertEqual(viewModel.currentCapabilities, .guest)
    }

    func testSignOutStopsWhenDeviceDeactivationFails() async {
        let authService = MockAuthService()
        let viewModel = AuthViewModel(
            authService: authService,
            userRoleService: MockUserRoleService()
        )
        viewModel.configureSignOutCleanup {
            throw MockError.deviceDeactivationFailed
        }

        await viewModel.signOut()

        XCTAssertFalse(authService.signOutCalled)
        XCTAssertNotNil(viewModel.errorMessage)
    }
}

private final class MockAuthService: AuthServicing {
    private(set) var signOutCalled = false

    func signIn(email: String, password: String) async throws -> User {
        throw MockError.unexpectedCall
    }

    func signOut() async throws {
        signOutCalled = true
    }

    func restoreSession() async throws -> User? { nil }
    func currentUser() async throws -> User? { nil }

    func handleAuthCallback(url: URL) async throws -> User {
        throw MockError.unexpectedCall
    }
}

private struct MockUserRoleService: UserRoleServicing {
    func resolveCapabilities(userID: UUID) async throws -> UserRoleCapabilities { .guest }
}

private enum MockError: Error {
    case unexpectedCall
    case deviceDeactivationFailed
}
