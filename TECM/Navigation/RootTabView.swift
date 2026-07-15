import Auth
import SwiftUI
import Combine

struct RootTabView: View {
    @StateObject private var router = TabRouter()
    @EnvironmentObject private var authViewModel: AuthViewModel
    @EnvironmentObject private var pushCoordinator: PushNotificationCoordinator

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

            if authViewModel.canAccessTeacherTools {
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

            if authViewModel.hasParentRole {
                NavigationStack(path: $router.parentCenterPath) {
                    ParentCenterView()
                        .navigationDestination(for: ParentRoute.self) { route in
                            switch route {
                            case .notificationCenter(let focusID):
                                NotificationCenterView(focusNotificationID: focusID)
                            case .bookingDetail(let bookingID, let parentID):
                                ParentBookingDetailView(bookingID: bookingID, parentID: parentID)
                            case .operations:
                                ParentOperationsView()
                            }
                        }
                }
                .tabItem {
                    Label(AppTab.parentCenter.title, systemImage: AppTab.parentCenter.icon)
                }
                .badge(pushCoordinator.unreadCount)
                .tag(AppTab.parentCenter)
            }
        }
        .environmentObject(router)
        .tint(Theme.Colors.primary)
        .toolbarBackground(Theme.Colors.card, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .animation(.easeInOut(duration: 0.2), value: router.selectedTab)
        .onReceive(pushCoordinator.$pendingRoute.compactMap { $0 }) { route in
            Task { await navigate(to: route) }
        }
        .onChange(of: authViewModel.currentCapabilities) { capabilities in
            if router.selectedTab == .parentCenter, !capabilities.hasParentRole {
                router.select(.home)
            } else if router.selectedTab == .teacher, !capabilities.canAccessTeacherTools {
                router.select(.home)
            }
        }
    }

    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { router.selectedTab },
            set: { tappedTab in
                router.select(tappedTab)
            }
        )
    }

    private func navigate(to route: AppDeepLinkRoute) async {
        defer { pushCoordinator.consumePendingRoute() }
        guard route != .authCallback, authViewModel.hasParentRole,
              let userID = authViewModel.currentUser?.id else { return }

        router.select(.parentCenter)
        switch route {
        case .booking(let bookingID):
            do {
                let profile = try await ParentProfileService().fetchCurrentParentProfile(userID: userID)
                router.parentCenterPath.append(
                    ParentRoute.bookingDetail(bookingID: bookingID, parentID: profile.id)
                )
            } catch {
                router.parentCenterPath.append(ParentRoute.notificationCenter(focusID: nil))
            }
        case .notification(let notificationID):
            router.parentCenterPath.append(ParentRoute.notificationCenter(focusID: notificationID))
        case .notificationCenter:
            router.parentCenterPath.append(ParentRoute.notificationCenter(focusID: nil))
        case .leaveRequest, .makeup, .payment, .classSession, .parentOperations:
            router.parentCenterPath.append(ParentRoute.operations)
        case .authCallback:
            break
        }
    }
}
