import Foundation
import Supabase

protocol ParentProfileServicing {
    func fetchCurrentParentProfile(userID: UUID) async throws -> ParentProfile
}

struct ParentProfileService: ParentProfileServicing {
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
    }

    func fetchCurrentParentProfile(userID: UUID) async throws -> ParentProfile {
        let profile: ParentProfileDTO = try await client
            .from("parent_profiles")
            .select("id,user_id,full_name,phone")
            .eq("user_id", value: userID)
            .single()
            .execute()
            .value

        let children: [ChildProfileDTO] = try await client
            .from("children")
            .select("id,parent_id,child_name,age,school_name,notes,created_at")
            .eq("parent_id", value: profile.id)
            .order("created_at", ascending: true)
            .execute()
            .value

        return ParentProfile(
            id: profile.id,
            userID: profile.userID,
            fullName: profile.fullName,
            phone: profile.phone,
            children: children.map { $0.toModel() }
        )
    }
}
