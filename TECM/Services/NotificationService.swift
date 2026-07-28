import Foundation
import Supabase
import Combine

protocol NotificationServicing {
    func fetchMyNotifications(parentID: UUID) async throws -> [ParentNotificationItem]
    func markNotificationRead(notificationID: UUID) async throws
    func markAllNotificationsRead() async throws
    func fetchUnreadNotificationCount() async throws -> Int
    func registerPushDevice(_ registration: PushDeviceRegistration) async throws
    func deactivatePushDevice(installationID: String) async throws
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
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
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

    func deactivatePushDevice(installationID: String) async throws {
        try await client
            .rpc("deactivate_push_device", params: DeactivatePushDeviceParams(installationID: installationID))
            .execute()
    }
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
