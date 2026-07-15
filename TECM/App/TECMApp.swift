import Auth
import SwiftUI

@main
struct TECMApp: App {
    @UIApplicationDelegateAdaptor(PushNotificationCoordinator.self) private var pushCoordinator
    @StateObject private var authViewModel = AuthViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(authViewModel)
                .environmentObject(pushCoordinator)
                .task {
                    authViewModel.configureSignOutCleanup { [weak pushCoordinator] in
                        await pushCoordinator?.deactivateCurrentInstallation()
                    }
                    await pushCoordinator.updateAuthenticatedUser(
                        authViewModel.currentUser?.id,
                        hasParentRole: authViewModel.hasParentRole
                    )
                }
                .onChange(of: authViewModel.currentUser?.id) { userID in
                    Task {
                        await pushCoordinator.updateAuthenticatedUser(
                            userID,
                            hasParentRole: authViewModel.hasParentRole
                        )
                    }
                }
                .onChange(of: authViewModel.currentCapabilities) { capabilities in
                    Task {
                        await pushCoordinator.updateAuthenticatedUser(
                            authViewModel.currentUser?.id,
                            hasParentRole: capabilities.hasParentRole
                        )
                    }
                }
                .onChange(of: scenePhase) { phase in
                    guard phase == .active else { return }
                    Task { await pushCoordinator.sceneDidBecomeActive() }
                }
                .onOpenURL { url in
                    if AppDeepLinkRoute.parse(url) == .authCallback {
                        Task { await authViewModel.handleAuthCallback(url: url) }
                    } else {
                        pushCoordinator.handle(url: url)
                    }
                }
        }
    }
}
