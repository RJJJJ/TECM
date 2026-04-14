import Foundation
import Supabase

protocol FAQServicing {
    func fetchFAQ() async throws -> [FAQItem]
}

struct FAQService: FAQServicing {
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
    }

    func fetchFAQ() async throws -> [FAQItem] {
        async let topicsTask: [FAQTopicDTO] = client
            .from("faq_topics")
            .select("id,name,sort_order")
            .order("sort_order", ascending: true)
            .execute()
            .value

        async let itemsTask: [FAQItemDTO] = client
            .from("faq_items")
            .select("id,topic_id,question,answer,is_popular,is_active,sort_order")
            .eq("is_active", value: true)
            .order("sort_order", ascending: true)
            .execute()
            .value

        let (topics, items) = try await (topicsTask, itemsTask)
        let topicLookup = Dictionary(uniqueKeysWithValues: topics.map { ($0.id, $0.name) })

        return items.map { dto in
            dto.toUIModel(topicName: topicLookup[dto.topicID] ?? "其他")
        }
    }
}
