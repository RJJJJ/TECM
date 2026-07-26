import Auth
import SwiftUI
import Combine

@MainActor
func resolveParentBookingRoute(
    bookingID: UUID,
    loadParentID: () async throws -> UUID,
    isSessionCurrent: () -> Bool
) async -> ParentRoute? {
    do {
        let parentID = try await loadParentID()
        guard isSessionCurrent() else { return nil }
        return .bookingDetail(bookingID: bookingID, parentID: parentID)
    } catch {
        guard isSessionCurrent() else { return nil }
        return .notificationCenter(focusID: nil)
    }
}

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

            if visibleTabs.contains(.teacher) {
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

            if visibleTabs.contains(.parentCenter) {
                NavigationStack(path: $router.parentCenterPath) {
                    ParentCenterView()
                        .navigationDestination(for: ParentRoute.self) { route in
                            switch route {
                            case .reservationSummary:
                                ParentReservationSummaryView()
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
            router.reconcileCapabilities(capabilities)
            if capabilities.hasParentRole, let route = pushCoordinator.pendingRoute {
                Task { await navigate(to: route) }
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

    private var visibleTabs: [AppTab] {
        AppTab.visibleTabs(for: authViewModel.currentCapabilities)
    }

    private func navigate(to route: AppDeepLinkRoute) async {
        guard route.isReadyForParentNavigation(
            hasParentRole: authViewModel.hasParentRole,
            userID: authViewModel.currentUser?.id
        ), let userID = authViewModel.currentUser?.id else { return }
        defer { pushCoordinator.consumePendingRoute() }

        router.select(.parentCenter)
        switch route {
        case .booking(let bookingID):
            if let destination = await resolveParentBookingRoute(
                bookingID: bookingID,
                loadParentID: {
                    try await ParentProfileService().fetchCurrentParentProfile(userID: userID).id
                },
                isSessionCurrent: {
                    authViewModel.currentUser?.id == userID && authViewModel.hasParentRole
                }
            ) {
                router.parentCenterPath.append(destination)
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
