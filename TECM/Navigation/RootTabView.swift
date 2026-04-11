import SwiftUI

struct RootTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                HomeView()
            }
            .tabItem {
                Label("首頁", systemImage: "house.fill")
            }
            .tag(0)

            NavigationStack {
                CoursesView()
            }
            .tabItem {
                Label("課程", systemImage: "book.closed.fill")
            }
            .tag(1)

            NavigationStack {
                BookingView()
            }
            .tabItem {
                Label("預約", systemImage: "calendar.badge.plus")
            }
            .tag(2)

            NavigationStack {
                AgentView()
            }
            .tabItem {
                Label("TECM AGENT", systemImage: "bubble.left.and.bubble.right.fill")
            }
            .tag(3)

            NavigationStack {
                ParentCenterView()
            }
            .tabItem {
                Label("家長中心", systemImage: "person.crop.circle.fill")
            }
            .tag(4)
        }
        .tint(Theme.Colors.primary)
        .animation(.easeInOut(duration: 0.2), value: selectedTab)
    }
}
