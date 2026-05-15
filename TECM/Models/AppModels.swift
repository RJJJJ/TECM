import SwiftUI

struct Course: Identifiable {
    let id = UUID()
    let title: String
    let category: String
    let level: String
    let ageGroup: String
    let focusTags: [String]
    let summary: String
    let schedule: String
    let campus: String
    let recommended: Bool
}

struct BookingRecord: Identifiable {
    let id: UUID
    var parentName: String
    var childName: String
    var childAgeGroup: String
    var courseName: String
    var campus: String
    var bookingDate: Date
    var note: String
    var status: BookingStatus

    init(id: UUID = UUID(),
         parentName: String,
         childName: String,
         childAgeGroup: String,
         courseName: String,
         campus: String,
         bookingDate: Date,
         note: String,
         status: BookingStatus) {
        self.id = id
        self.parentName = parentName
        self.childName = childName
        self.childAgeGroup = childAgeGroup
        self.courseName = courseName
        self.campus = campus
        self.bookingDate = bookingDate
        self.note = note
        self.status = status
    }

    var dateText: String {
        bookingDate.formatted(date: .abbreviated, time: .omitted)
    }

    var timeText: String {
        "\(bookingDate.formatted(date: .omitted, time: .shortened)) - \(bookingEndDate.formatted(date: .omitted, time: .shortened))"
    }

    private var bookingEndDate: Date {
        bookingDate.addingTimeInterval(60 * 60)
    }
}

enum BookingStatus: String, CaseIterable, Identifiable {
    case pending = "待確認"
    case confirmed = "已確認"
    case completed = "已完成"
    case cancelled = "已取消"

    init(apiValue: String) {
        switch apiValue.lowercased() {
        case "confirmed": self = .confirmed
        case "completed": self = .completed
        case "cancelled": self = .cancelled
        default: self = .pending
        }
    }

    var apiValue: String {
        switch self {
        case .pending: return "pending"
        case .confirmed: return "confirmed"
        case .completed: return "completed"
        case .cancelled: return "cancelled"
        }
    }

    var id: String { rawValue }

    var color: Color {
        switch self {
        case .pending: return Theme.Colors.warning
        case .confirmed: return Theme.Colors.success
        case .completed: return Theme.Colors.primary
        case .cancelled: return Theme.Colors.blueGray
        }
    }

    var icon: String {
        switch self {
        case .pending: return "clock"
        case .confirmed: return "checkmark.circle"
        case .completed: return "checkmark.seal"
        case .cancelled: return "xmark.circle"
        }
    }
}

struct ParentNotification: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let time: String
}

struct FAQItem: Identifiable {
    let id: String
    let topic: String
    let question: String
    let answer: String
    let popular: Bool
}

enum ReservationSummaryFilter: String, CaseIterable, Identifiable {
    case all = "全部"
    case pending = "待確認"
    case confirmed = "已確認"
    case completed = "已完成"
    case cancelled = "已取消"

    var id: String { rawValue }

    var title: String { rawValue }

    var status: BookingStatus? {
        switch self {
        case .all: return nil
        case .pending: return .pending
        case .confirmed: return .confirmed
        case .completed: return .completed
        case .cancelled: return .cancelled
        }
    }
}

struct ParentReservationSummaryItem: Identifiable {
    let id: UUID
    let parentName: String
    let childName: String
    let courseDirection: String
    let campus: String
    let reservationDate: Date
    let status: BookingStatus
    let note: String

    init(
        id: UUID = UUID(),
        parentName: String,
        childName: String,
        courseDirection: String,
        campus: String,
        reservationDate: Date,
        status: BookingStatus,
        note: String
    ) {
        self.id = id
        self.parentName = parentName
        self.childName = childName
        self.courseDirection = courseDirection
        self.campus = campus
        self.reservationDate = reservationDate
        self.status = status
        self.note = note
    }

    var dateText: String {
        reservationDate.formatted(date: .abbreviated, time: .omitted)
    }

    var timeText: String {
        "\(reservationDate.formatted(date: .omitted, time: .shortened)) - \(reservationEndDate.formatted(date: .omitted, time: .shortened))"
    }

    private var reservationEndDate: Date {
        reservationDate.addingTimeInterval(60 * 60)
    }
}

enum UserAppRole: String {
    case guest
    case parent
    case teacher
    case admin
}

enum ExamAttendanceStatus: String, CaseIterable, Identifiable, Codable {
    case present
    case excused
    case absent
    case makeupCompleted = "makeup_completed"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .present: return "出席"
        case .excused: return "請假"
        case .absent: return "缺席"
        case .makeupCompleted: return "已補課"
        }
    }

    var systemImage: String {
        switch self {
        case .present: return "checkmark.circle.fill"
        case .excused: return "calendar.badge.clock"
        case .absent: return "xmark.circle.fill"
        case .makeupCompleted: return "checkmark.seal.fill"
        }
    }
}

struct TeacherTodaySession: Identifiable, Hashable {
    let id: UUID
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

    var timeRangeText: String {
        "\(startsAt.formatted(date: .omitted, time: .shortened)) - \(endsAt.formatted(date: .omitted, time: .shortened))"
    }
}

struct TeacherSessionStudent: Identifiable {
    let id: UUID
    let displayName: String
    let schoolName: String?
    var status: ExamAttendanceStatus
}

struct ParentExamAttendanceSummary: Identifiable {
    let id = UUID()
    let studentID: UUID
    let studentName: String
    let cohortID: UUID
    let cohortName: String
    let completedLessons: Int
    let recordedLessons: Int
    let pendingMakeupCount: Int
    let scheduledMakeupCount: Int
    let displayText: String

    var attendanceRateText: String {
        guard recordedLessons > 0 else { return "未有紀錄" }
        let value = Double(completedLessons) / Double(recordedLessons)
        return value.formatted(.percent.precision(.fractionLength(0)))
    }
}

struct LearningResource: Identifiable {
    let id = UUID()
    let title: String
    let description: String
    let estimatedTime: String
}

struct NewsItem: Identifiable {
    let id = UUID()
    let category: String
    let title: String
    let summary: String
    let date: String
    let isFeatured: Bool
}

enum PracticeQuestionType: String, Codable {
    case singleChoice
    case trueFalse

    var label: String {
        switch self {
        case .singleChoice: return "選擇題"
        case .trueFalse: return "判斷題"
        }
    }
}

struct PracticeQuestion: Identifiable {
    let id = UUID()
    let type: PracticeQuestionType
    let prompt: String
    let options: [String]
    let correctAnswer: Int
    let explanation: String
    let note: String?

    init(type: PracticeQuestionType,
         prompt: String,
         options: [String] = [],
         correctAnswer: Int,
         explanation: String,
         note: String? = nil) {
        self.type = type
        self.prompt = prompt
        self.options = options
        self.correctAnswer = correctAnswer
        self.explanation = explanation
        self.note = note
    }

    var normalizedOptions: [String] {
        switch type {
        case .singleChoice: return options
        case .trueFalse: return ["正確", "錯誤"]
        }
    }
}

struct PracticePaper: Identifiable {
    let id = UUID()
    let subjectId: String
    let title: String
    let levelLabel: String
    let audience: String
    let estimatedMinutes: Int
    let questions: [PracticeQuestion]

    var questionCount: Int { questions.count }

    var singleChoiceCount: Int {
        questions.filter { $0.type == .singleChoice }.count
    }

    var trueFalseCount: Int {
        questions.filter { $0.type == .trueFalse }.count
    }
}

struct PracticeSubject: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let iconName: String
    let description: String
    let papers: [PracticePaper]
}
