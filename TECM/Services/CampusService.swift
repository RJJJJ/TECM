import Foundation
import Supabase

protocol CampusServicing {
    func fetchCampuses() async throws -> [String]
}

struct CampusService: CampusServicing {
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
    }

    func fetchCampuses() async throws -> [String] {
        let rows: [CampusDTO] = try await client
            .from("campuses")
            .select("id,name,address,is_active")
            .eq("is_active", value: true)
            .order("name", ascending: true)
            .execute()
            .value

        return rows.map(\.name)
    }
}
