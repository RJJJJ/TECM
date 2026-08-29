import Foundation
import Supabase
import Combine

protocol NotificationServicing: Sendable {
    func fetchMyNotifications(parentID: UUID) async throws -> [ParentNotificationItem]
    func markNotificationRead(notificationID: UUID) async throws
    func markAllNotificationsRead() async throws
    func fetchUnreadNotificationCount() async throws -> Int
    func registerPushDevice(_ registration: PushDeviceRegistration) async throws
    func deactivatePushDevice(installationID: String, accessToken: String?) async throws
}

struct PushDeviceRegistration {
    let installationID: String
    let deviceToken: String
    let environment: String
    let bundleID: String
    let appVersion: String?
    let deviceModel: String?
}

struct NotificationService: NotificationServicing {
    private let clientResolver: SupabaseClientResolver
    private var client: SupabaseClient { clientResolver.client }
    private let supabaseURL: URL
    private let publishableKey: String
    private let session: URLSession

    init(
        client: SupabaseClient? = nil,
        configuration: SupabaseConfig = SupabaseClientProvider.configuration,
        session: URLSession? = nil
    ) {
        clientResolver = SupabaseClientResolver(client: client)
        supabaseURL = configuration.url
        publishableKey = configuration.publishableKey
        self.session = session ?? Self.makeSignOutSession()
    }

    func fetchMyNotifications(parentID: UUID) async throws -> [ParentNotificationItem] {
        let rows: [NotificationDTO] = try await client
            .from("notifications")
            .select("id,title,detail,is_read,category,deep_link,entity_type,entity_id,created_at")
            .eq("parent_id", value: parentID)
            .order("created_at", ascending: false)
            .execute()
            .value

        return rows.map { $0.toModel() }
    }

    func markNotificationRead(notificationID: UUID) async throws {
        try await client
            .rpc("mark_notification_read", params: MarkNotificationReadParams(notificationID: notificationID))
            .execute()
    }

    func markAllNotificationsRead() async throws {
        try await client
            .rpc("mark_all_notifications_read")
            .execute()
    }

    func fetchUnreadNotificationCount() async throws -> Int {
        let count: Int = try await client
            .rpc("get_unread_notification_count")
            .execute()
            .value
        return count
    }

    func registerPushDevice(_ registration: PushDeviceRegistration) async throws {
        try await client
            .rpc(
                "register_push_device",
                params: RegisterPushDeviceParams(
                    installationID: registration.installationID,
                    deviceToken: registration.deviceToken,
                    environment: registration.environment,
                    bundleID: registration.bundleID,
                    appVersion: registration.appVersion,
                    deviceModel: registration.deviceModel
                )
            )
            .execute()
    }

    func deactivatePushDevice(installationID: String, accessToken: String?) async throws {
        guard let accessToken else {
            throw NotificationSignOutCleanupError.failed
        }
        let url = supabaseURL
            .appendingPathComponent("rest")
            .appendingPathComponent("v1")
            .appendingPathComponent("rpc")
            .appendingPathComponent("deactivate_push_device")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = try JSONEncoder().encode(
            DeactivatePushDeviceParams(installationID: installationID)
        )
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("public", forHTTPHeaderField: "Content-Profile")
        request.setValue(
            PostgrestClient.Configuration.defaultHeaders["X-Client-Info"],
            forHTTPHeaderField: "X-Client-Info"
        )

        let (_, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse,
              (200..<300).contains(response.statusCode) else {
            throw NotificationSignOutCleanupError.failed
        }
    }

    private static func makeSignOutSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 10
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }
}

private enum NotificationSignOutCleanupError: Error {
    case failed
}

private struct MarkNotificationReadParams: Encodable {
    let notificationID: UUID

    enum CodingKeys: String, CodingKey {
        case notificationID = "p_notification_id"
    }
}

private struct RegisterPushDeviceParams: Encodable {
    let installationID: String
    let deviceToken: String
    let environment: String
    let bundleID: String
    let appVersion: String?
    let deviceModel: String?

    enum CodingKeys: String, CodingKey {
        case installationID = "p_installation_id"
        case deviceToken = "p_device_token"
        case environment = "p_environment"
        case bundleID = "p_bundle_id"
        case appVersion = "p_app_version"
        case deviceModel = "p_device_model"
    }
}

private struct DeactivatePushDeviceParams: Encodable {
    let installationID: String

    enum CodingKeys: String, CodingKey {
        case installationID = "p_installation_id"
    }
}
