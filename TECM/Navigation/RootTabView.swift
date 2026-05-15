import SwiftUI
import Combine

struct RootTabView: View {
    @StateObject private var router = TabRouter()
    @EnvironmentObject private var authViewModel: AuthViewModel

    var body: some View {
        TabView(selection: tabSelection) {
            NavigationStack(path: $router.homePath) {
                HomeView()
            }
            .tabItem {
                Label(AppTab.home.title, systemImage: AppTab.home.icon)
            }
            .tag(AppTab.home)

            NavigationStack(path: $router.coursesPath) {
                CoursesView()
            }
            .tabItem {
                Label(AppTab.courses.title, systemImage: AppTab.courses.icon)
            }
            .tag(AppTab.courses)

            NavigationStack(path: $router.bookingPath) {
                BookingView()
            }
            .tabItem {
                Label(AppTab.booking.title, systemImage: AppTab.booking.icon)
            }
            .tag(AppTab.booking)

            NavigationStack(path: $router.agentPath) {
                AgentView()
            }
            .tabItem {
                Label(AppTab.agent.title, systemImage: AppTab.agent.icon)
            }
            .tag(AppTab.agent)

            if authViewModel.currentRole == .teacher || authViewModel.currentRole == .admin {
                NavigationStack(path: $router.teacherPath) {
                    TeacherTodayClassView()
                        .navigationDestination(for: TeacherRoute.self) { route in
                            switch route {
                            case .sessionDetail(let session):
                                TeacherLessonSessionDetailView(session: session)
                            case .attendance(let session):
                                TeacherAttendanceView(session: session)
                            }
                        }
                }
                .tabItem {
                    Label(AppTab.teacher.title, systemImage: AppTab.teacher.icon)
                }
                .tag(AppTab.teacher)
            }

            NavigationStack(path: $router.parentCenterPath) {
                ParentCenterView()
            }
            .tabItem {
                Label(AppTab.parentCenter.title, systemImage: AppTab.parentCenter.icon)
            }
            .tag(AppTab.parentCenter)
        }
        .environmentObject(router)
        .tint(Theme.Colors.primary)
        .toolbarBackground(Theme.Colors.card, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .animation(.easeInOut(duration: 0.2), value: router.selectedTab)
    }

    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { router.selectedTab },
            set: { tappedTab in
                router.select(tappedTab)
            }
        )
    }
}
