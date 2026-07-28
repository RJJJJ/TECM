import Foundation
import Supabase

protocol CampusServicing {
    func fetchCampuses() async throws -> [String]
}

struct CampusService: CampusServicing {
    private let clientResolver: SupabaseClientResolver
    private var client: SupabaseClient { clientResolver.client }

    init(client: SupabaseClient? = nil) {
        clientResolver = SupabaseClientResolver(client: client)
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
