import Foundation
import Supabase

protocol UserRoleServicing {
    func resolveCapabilities(userID: UUID) async throws -> UserRoleCapabilities
}

struct UserRoleService: UserRoleServicing {
    private let clientResolver: SupabaseClientResolver
    private var client: SupabaseClient { clientResolver.client }

    init(client: SupabaseClient? = nil) {
        clientResolver = SupabaseClientResolver(client: client)
    }

    func resolveCapabilities(userID: UUID) async throws -> UserRoleCapabilities {
        let memberships: [OrganizationMembershipDTO] = try await client
            .from("organization_members")
            .select("organization_id,role,status")
            .eq("user_id", value: userID)
            .eq("status", value: "active")
            .execute()
            .value

        let parentRows: [ParentProfileDTO] = try await client
            .from("parent_profiles")
            .select("id,user_id,full_name,phone")
            .eq("user_id", value: userID)
            .limit(1)
            .execute()
            .value
        if !parentRows.isEmpty {
            try await client
                .rpc("activate_parent_account")
                .execute()
        }
        return UserRoleCapabilities.resolve(
            organizationRoleNames: memberships.map(\.role),
            hasParentProfile: !parentRows.isEmpty
        )
    }
}
