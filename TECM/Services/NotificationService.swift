import Foundation
import Supabase

protocol NotificationServicing {
    func fetchMyNotifications(parentID: UUID) async throws -> [ParentNotificationItem]
}

struct NotificationService: NotificationServicing {
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
    }

    func fetchMyNotifications(parentID: UUID) async throws -> [ParentNotificationItem] {
        let rows: [NotificationDTO] = try await client
            .from("notifications")
            .select("id,title,detail,is_read,created_at")
            .eq("parent_id", value: parentID)
            .order("created_at", ascending: false)
            .execute()
            .value

        return rows.map { $0.toModel() }
    }
}
