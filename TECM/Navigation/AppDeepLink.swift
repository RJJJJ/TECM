import Foundation

enum AppDeepLinkRoute: Equatable {
    case authCallback
    case notification(UUID?)
    case booking(UUID)
    case leaveRequest(UUID)
    case makeup(UUID)
    case payment(UUID)
    case classSession(UUID)
    case parentOperations
    case notificationCenter

    static func parse(_ url: URL) -> AppDeepLinkRoute? {
        guard url.scheme?.lowercased() == "tecm" else { return nil }

        let host = url.host?.lowercased()
        let components = url.pathComponents.filter { $0 != "/" }
        if host == "auth", components.first?.lowercased() == "callback" {
            return .authCallback
        }

        let identifier = components.first.flatMap(UUID.init(uuidString:))
        switch host {
        case "notifications": return .notification(identifier)
        case "bookings": return identifier.map(AppDeepLinkRoute.booking) ?? .notificationCenter
        case "leave", "leave-requests": return identifier.map(AppDeepLinkRoute.leaveRequest) ?? .parentOperations
        case "makeup", "makeups": return identifier.map(AppDeepLinkRoute.makeup) ?? .parentOperations
        case "payment", "payments": return identifier.map(AppDeepLinkRoute.payment) ?? .parentOperations
        case "class", "classes", "schedule": return identifier.map(AppDeepLinkRoute.classSession) ?? .parentOperations
        default: return .notificationCenter
        }
    }

    static func fromNotificationPayload(_ userInfo: [AnyHashable: Any]) -> AppDeepLinkRoute {
        if let deepLink = userInfo["deep_link"] as? String,
           let url = URL(string: deepLink),
           let route = parse(url),
           route != .authCallback {
            return route
        }

        if let rawID = userInfo["notification_id"] as? String,
           let notificationID = UUID(uuidString: rawID) {
            return .notification(notificationID)
        }
        return .notificationCenter
    }

    var notificationFocusID: UUID? {
        if case .notification(let identifier) = self { return identifier }
        return nil
    }
}

enum ParentRoute: Hashable {
    case notificationCenter(focusID: UUID?)
    case bookingDetail(bookingID: UUID, parentID: UUID)
    case operations
}
