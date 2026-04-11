import SwiftUI

enum TabBarPolicy {
    /// Tab bar should only stay visible on the 5 top-level entry screens.
    static func isRootScreen(_ isDetail: Bool) -> ToolbarVisibility {
        isDetail ? .hidden : .visible
    }
}

extension View {
    func tecmRootTabBar() -> some View {
        toolbar(.visible, for: .tabBar)
    }

    func tecmDetailTabBar() -> some View {
        toolbar(.hidden, for: .tabBar)
    }
}
