import Foundation
import Supabase

protocol UserRoleServicing {
    func resolveRole(userID: UUID) async throws -> UserAppRole
}

struct UserRoleService: UserRoleServicing {
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
    }

    func resolveRole(userID: UUID) async throws -> UserAppRole {
        async let staffTask: [StaffRoleLookupDTO] = client
            .from("staff_roles")
            .select("role,is_active")
            .eq("user_id", value: userID)
            .eq("is_active", value: true)
            .limit(1)
            .execute()
            .value

        async let teacherTask: [TeacherProfileLookupDTO] = client
            .from("teacher_profiles")
            .select("id,user_id,display_name,is_active")
            .eq("user_id", value: userID)
            .eq("is_active", value: true)
            .limit(1)
            .execute()
            .value

        async let parentTask: [ParentProfileDTO] = client
            .from("parent_profiles")
            .select("id,user_id,full_name,phone")
            .eq("user_id", value: userID)
            .limit(1)
            .execute()
            .value

        let (staffRows, teacherRows, parentRows) = try await (staffTask, teacherTask, parentTask)

        if let staff = staffRows.first, staff.isActive {
            return staff.role == "admin" ? .admin : .admin
        }

        if teacherRows.first?.isActive == true {
            return .teacher
        }

        if !parentRows.isEmpty {
            return .parent
        }

        return .guest
    }
}
