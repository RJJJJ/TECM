import SwiftUI

enum AppTab: Int, CaseIterable {
    case home
    case courses
    case booking
    case agent
    case parentCenter

    var title: String {
        switch self {
        case .home: return "首頁"
        case .courses: return "課程"
        case .booking: return "預約"
        case .agent: return "TECM AGENT"
        case .parentCenter: return "家長中心"
        }
    }

    var icon: String {
        switch self {
        case .home: return "house.fill"
        case .courses: return "book.closed.fill"
        case .booking: return "calendar.badge.plus"
        case .agent: return "bubble.left.and.bubble.right.fill"
        case .parentCenter: return "person.crop.circle.fill"
        }
    }
}

@MainActor
final class TabRouter: ObservableObject {
    @Published var selectedTab: AppTab = .home
    @Published var homePath = NavigationPath()
    @Published var coursesPath = NavigationPath()
    @Published var bookingPath = NavigationPath()
    @Published var agentPath = NavigationPath()
    @Published var parentCenterPath = NavigationPath()

    func select(_ tab: AppTab) {
        selectedTab = tab
        resetPath(for: tab)
    }

    func resetCurrentTabToRoot() {
        resetPath(for: selectedTab)
    }

    private func resetPath(for tab: AppTab) {
        switch tab {
        case .home:
            homePath = NavigationPath()
        case .courses:
            coursesPath = NavigationPath()
        case .booking:
            bookingPath = NavigationPath()
        case .agent:
            agentPath = NavigationPath()
        case .parentCenter:
            parentCenterPath = NavigationPath()
        }
    }
}
