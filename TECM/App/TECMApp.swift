import SwiftUI

@main
struct TECMApp: App {
    @StateObject private var accessState = DemoAccessState()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(accessState)
        }
    }
}
