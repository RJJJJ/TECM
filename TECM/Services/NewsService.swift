import Foundation
import Supabase
import Combine

protocol NewsServicing {
    func fetchActiveNews(limit: Int) async throws -> [NewsItem]
}

struct NewsService: NewsServicing {
    private let clientResolver: SupabaseClientResolver
    private var client: SupabaseClient { clientResolver.client }
    private let formatter: DateFormatter

    init(client: SupabaseClient? = nil) {
        clientResolver = SupabaseClientResolver(client: client)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hant_TW")
        formatter.dateFormat = "yyyy/MM/dd"
        self.formatter = formatter
    }

    func fetchActiveNews(limit: Int = 3) async throws -> [NewsItem] {
        let rows: [NewsItemDTO] = try await client
            .from("news_items")
            .select("id,category,title,summary,is_featured,is_active,published_at")
            .eq("is_active", value: true)
            .order("published_at", ascending: false)
            .limit(limit)
            .execute()
            .value

        return rows.map { $0.toUIModel(formatter: formatter) }
    }
}
