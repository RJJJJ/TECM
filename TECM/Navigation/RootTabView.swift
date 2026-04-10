import SwiftUI

struct RootTabView: View {
    var body: some View {
        TabView {
            NavigationStack {
                HomeView()
            }
            .tabItem {
                Label("首頁", systemImage: "house.fill")
            }

            NavigationStack {
                CoursesView()
            }
            .tabItem {
                Label("課程", systemImage: "book.closed.fill")
            }

            NavigationStack {
                BookingView()
            }
            .tabItem {
                Label("預約", systemImage: "calendar.badge.plus")
            }

            NavigationStack {
                AgentView()
            }
            .tabItem {
                Label("TECM AGENT", systemImage: "bubble.left.and.bubble.right.fill")
            }

            NavigationStack {
                ParentCenterView()
            }
            .tabItem {
                Label("家長中心", systemImage: "person.crop.circle.fill")
            }
        }
        .tint(Theme.Colors.primaryBlue)
    }
}
