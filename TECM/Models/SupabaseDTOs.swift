import Foundation

struct CampusDTO: Decodable {
    let id: UUID
    let name: String
    let address: String?
    let isActive: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case address
        case isActive = "is_active"
    }
}

struct CourseDTO: Decodable {
    let id: UUID
    let title: String
    let category: String?
    let level: String?
    let ageGroup: String?
    let summary: String?
    let scheduleText: String?
    let campusID: UUID?
    let recommended: Bool
    let isActive: Bool
    let sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case category
        case level
        case ageGroup = "age_group"
        case summary
        case scheduleText = "schedule_text"
        case campusID = "campus_id"
        case recommended
        case isActive = "is_active"
        case sortOrder = "sort_order"
    }

    func toUIModel(campusName: String, tags: [String]) -> Course {
        Course(
            title: title,
            category: category ?? "未分類",
            level: level ?? "Foundation",
            ageGroup: ageGroup ?? "未標註",
            focusTags: tags.isEmpty ? ["待更新"] : tags,
            summary: summary ?? "",
            schedule: scheduleText ?? "",
            campus: campusName,
            recommended: recommended
        )
    }
}

struct CourseTagDTO: Decodable {
    let courseID: UUID
    let tag: String

    enum CodingKeys: String, CodingKey {
        case courseID = "course_id"
        case tag
    }
}

struct NewsItemDTO: Decodable {
    let id: UUID
    let category: String?
    let title: String
    let summary: String?
    let isFeatured: Bool
    let isActive: Bool
    let publishedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case category
        case title
        case summary
        case isFeatured = "is_featured"
        case isActive = "is_active"
        case publishedAt = "published_at"
    }

    func toUIModel(formatter: DateFormatter) -> NewsItem {
        NewsItem(
            category: category ?? "最新消息",
            title: title,
            summary: summary ?? "",
            date: formatter.string(from: publishedAt),
            isFeatured: isFeatured
        )
    }
}

struct FAQTopicDTO: Decodable {
    let id: UUID
    let name: String
    let sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case sortOrder = "sort_order"
    }
}

struct FAQItemDTO: Decodable {
    let id: UUID
    let topicID: UUID
    let question: String
    let answer: String
    let isPopular: Bool
    let isActive: Bool
    let sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case topicID = "topic_id"
        case question
        case answer
        case isPopular = "is_popular"
        case isActive = "is_active"
        case sortOrder = "sort_order"
    }

    func toUIModel(topicName: String) -> FAQItem {
        FAQItem(
            id: id.uuidString,
            topic: topicName,
            question: question,
            answer: answer,
            popular: isPopular
        )
    }
}
