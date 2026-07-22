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

struct ParentProfileDTO: Decodable {
    let id: UUID
    let userID: UUID
    let fullName: String
    let phone: String?

    enum CodingKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case fullName = "full_name"
        case phone
    }
}

struct ChildProfileDTO: Decodable {
    let id: UUID
    let parentID: UUID
    let childName: String
    let age: Int?
    let schoolName: String?
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case id
        case parentID = "parent_id"
        case childName = "child_name"
        case age
        case schoolName = "school_name"
        case notes
    }

    func toModel() -> ChildProfile {
        ChildProfile(
            id: id,
            parentID: parentID,
            name: childName,
            age: age,
            schoolName: schoolName,
            notes: notes
        )
    }
}

struct BookingDTO: Decodable {
    let id: UUID
    let parentName: String
    let phone: String?
    let childName: String
    let childAge: Int?
    let schoolName: String?
    let courseTitleSnapshot: String?
    let bookingDate: String
    let startTime: String
    let endTime: String
    let note: String?
    let status: String
    let createdAt: Date
    let campus: CampusMiniDTO?

    enum CodingKeys: String, CodingKey {
        case id
        case parentName = "parent_name"
        case phone
        case childName = "child_name"
        case childAge = "child_age"
        case schoolName = "school_name"
        case courseTitleSnapshot = "course_title_snapshot"
        case bookingDate = "booking_date"
        case startTime = "start_time"
        case endTime = "end_time"
        case note
        case status
        case createdAt = "created_at"
        case campus
    }

    func toSummaryItem() -> ParentReservationSummaryItem {
        ParentReservationSummaryItem(
            id: id,
            parentName: parentName,
            childName: childName,
            courseDirection: courseTitleSnapshot ?? "課程待確認",
            campus: campus?.name ?? "待確認",
            reservationDate: Self.reservationDate(bookingDate: bookingDate, startTime: startTime) ?? createdAt,
            status: BookingStatus(apiValue: status),
            note: note ?? ""
        )
    }

    func toBookingRecord() -> BookingRecord {
        BookingRecord(
            id: id,
            parentName: parentName,
            childName: childName,
            childAgeGroup: childAge.map { "\($0)歲" } ?? "未提供",
            courseName: courseTitleSnapshot ?? "課程待確認",
            campus: campus?.name ?? "待確認",
            bookingDate: Self.reservationDate(bookingDate: bookingDate, startTime: startTime) ?? createdAt,
            note: note ?? "",
            status: BookingStatus(apiValue: status)
        )
    }

    func toParentBookingDetail() -> ParentBookingDetail {
        ParentBookingDetail(
            id: id,
            parentName: parentName,
            phone: phone ?? "未提供",
            childName: childName,
            courseTitle: courseTitleSnapshot ?? "課程待確認",
            campusName: campus?.name ?? "待確認",
            bookingDate: bookingDate,
            startTime: startTime,
            endTime: endTime,
            status: BookingStatus(apiValue: status),
            note: (note?.isEmpty == false ? note : nil) ?? "無"
        )
    }

    private static func reservationDate(bookingDate: String, startTime: String) -> Date? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        if let parsed = formatter.date(from: "\(bookingDate) \(startTime)") {
            return parsed
        }

        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.date(from: "\(bookingDate) \(startTime.prefix(5))")
    }
}

struct CampusMiniDTO: Decodable {
    let name: String
}

struct NotificationDTO: Decodable {
    let id: UUID
    let title: String
    let detail: String?
    let isRead: Bool
    let category: String?
    let deepLink: String?
    let entityType: String?
    let entityID: UUID?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case detail
        case isRead = "is_read"
        case category
        case deepLink = "deep_link"
        case entityType = "entity_type"
        case entityID = "entity_id"
        case createdAt = "created_at"
    }

    func toModel() -> ParentNotificationItem {
        ParentNotificationItem(
            id: id,
            title: title,
            detail: detail ?? "",
            isRead: isRead,
            category: category,
            deepLink: deepLink,
            entityType: entityType,
            entityID: entityID,
            createdAt: createdAt
        )
    }
}

struct OrganizationMembershipDTO: Decodable {
    let organizationID: UUID
    let role: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case organizationID = "organization_id"
        case role
        case status
    }
}

struct BookingInsertPayload: Encodable {
    let parentID: UUID
    let childID: UUID?
    let parentName: String
    let phone: String
    let childName: String
    let childAge: Int?
    let schoolName: String
    let courseID: UUID?
    let courseTitleSnapshot: String
    let campusID: UUID?
    let bookingDate: String
    let startTime: String
    let endTime: String
    let note: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case parentID = "parent_id"
        case childID = "child_id"
        case parentName = "parent_name"
        case phone
        case childName = "child_name"
        case childAge = "child_age"
        case schoolName = "school_name"
        case courseID = "course_id"
        case courseTitleSnapshot = "course_title_snapshot"
        case campusID = "campus_id"
        case bookingDate = "booking_date"
        case startTime = "start_time"
        case endTime = "end_time"
        case note
        case status
    }
}

struct StaffRoleLookupDTO: Decodable {
    let role: String
    let isActive: Bool

    enum CodingKeys: String, CodingKey {
        case role
        case isActive = "is_active"
    }
}

struct TeacherProfileLookupDTO: Decodable {
    let id: UUID
    let userID: UUID
    let displayName: String
    let isActive: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case userID = "user_id"
        case displayName = "display_name"
        case isActive = "is_active"
    }
}

struct TeacherTodaySessionDTO: Decodable {
    let sessionID: UUID
    let cohortID: UUID
    let cohortName: String
    let subject: String
    let level: String
    let lessonPlanID: UUID
    let sequenceNo: Int
    let lessonTitle: String
    let teachingContent: String?
    let startsAt: Date
    let endsAt: Date
    let attendanceCount: Int
    let studentCount: Int

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case cohortID = "cohort_id"
        case cohortName = "cohort_name"
        case subject
        case level
        case lessonPlanID = "lesson_plan_id"
        case sequenceNo = "sequence_no"
        case lessonTitle = "lesson_title"
        case teachingContent = "teaching_content"
        case startsAt = "starts_at"
        case endsAt = "ends_at"
        case attendanceCount = "attendance_count"
        case studentCount = "student_count"
    }

    func toModel() -> TeacherTodaySession {
        TeacherTodaySession(
            id: sessionID,
            cohortID: cohortID,
            cohortName: cohortName,
            subject: subject,
            level: level,
            lessonPlanID: lessonPlanID,
            sequenceNo: sequenceNo,
            lessonTitle: lessonTitle,
            teachingContent: teachingContent,
            startsAt: startsAt,
            endsAt: endsAt,
            attendanceCount: attendanceCount,
            studentCount: studentCount
        )
    }
}

struct TeacherSessionStudentDTO: Decodable {
    let studentID: UUID
    let displayName: String
    let schoolName: String?
    let attendanceStatus: String?

    enum CodingKeys: String, CodingKey {
        case studentID = "student_id"
        case displayName = "display_name"
        case schoolName = "school_name"
        case attendanceStatus = "attendance_status"
    }

    func toModel() -> TeacherSessionStudent {
        TeacherSessionStudent(
            id: studentID,
            displayName: displayName,
            schoolName: schoolName,
            status: ExamAttendanceStatus(rawValue: attendanceStatus ?? "") ?? .present
        )
    }
}

struct AttendanceSubmitPayload: Encodable {
    let studentID: UUID
    let status: String
    let internalNote: String?

    enum CodingKeys: String, CodingKey {
        case studentID = "student_id"
        case status
        case internalNote = "internal_note"
    }
}

struct ParentExamAttendanceSummaryDTO: Decodable {
    let studentID: UUID
    let studentName: String
    let cohortID: UUID
    let cohortName: String
    let completedLessons: Int
    let recordedLessons: Int
    let pendingMakeupCount: Int
    let scheduledMakeupCount: Int
    let displayText: String

    enum CodingKeys: String, CodingKey {
        case studentID = "student_id"
        case studentName = "student_name"
        case cohortID = "cohort_id"
        case cohortName = "cohort_name"
        case completedLessons = "completed_lessons"
        case recordedLessons = "recorded_lessons"
        case pendingMakeupCount = "pending_makeup_count"
        case scheduledMakeupCount = "scheduled_makeup_count"
        case displayText = "display_text"
    }

    func toModel() -> ParentExamAttendanceSummary {
        ParentExamAttendanceSummary(
            studentID: studentID,
            studentName: studentName,
            cohortID: cohortID,
            cohortName: cohortName,
            completedLessons: completedLessons,
            recordedLessons: recordedLessons,
            pendingMakeupCount: pendingMakeupCount,
            scheduledMakeupCount: scheduledMakeupCount,
            displayText: displayText
        )
    }
}
