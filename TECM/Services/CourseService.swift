import Foundation
import Supabase

protocol CourseServicing {
    func fetchCourses() async throws -> [Course]
}

struct CourseService: CourseServicing {
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
    }

    func fetchCourses() async throws -> [Course] {
        async let campusesTask: [CampusDTO] = client
            .from("campuses")
            .select("id,name,is_active")
            .eq("is_active", value: true)
            .execute()
            .value

        async let coursesTask: [CourseDTO] = client
            .from("courses")
            .select("id,title,category,level,age_group,summary,schedule_text,campus_id,recommended,is_active,sort_order")
            .eq("is_active", value: true)
            .order("sort_order", ascending: true)
            .execute()
            .value

        async let tagsTask: [CourseTagDTO] = client
            .from("course_tags")
            .select("course_id,tag")
            .execute()
            .value

        let (campuses, courses, tags) = try await (campusesTask, coursesTask, tagsTask)

        let campusLookup = Dictionary(uniqueKeysWithValues: campuses.map { ($0.id, $0.name) })
        let tagLookup = Dictionary(grouping: tags, by: \.courseID)
            .mapValues { $0.map(\.tag) }

        return courses.map { dto in
            let campusName = dto.campusID.flatMap { campusLookup[$0] } ?? "待確認"
            let focusTags = tagLookup[dto.id] ?? []
            return dto.toUIModel(campusName: campusName, tags: focusTags)
        }
    }
}
