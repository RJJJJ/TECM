import SwiftUI

@main
struct TECMApp: App {
    @StateObject private var authViewModel = AuthViewModel()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(authViewModel)
        }
    }
}
