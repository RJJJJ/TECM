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
    let id = UUID()
    let parentName: String
    let childName: String
    let childAgeGroup: String
    let courseName: String
    let campus: String
    let timeSlot: String
    let status: BookingStatus
}

enum BookingStatus: String {
    case pending = "待確認"
    case confirmed = "已確認"
    case completed = "已完成"

    var color: Color {
        switch self {
        case .pending: return Theme.Colors.warning
        case .confirmed: return Theme.Colors.success
        case .completed: return Theme.Colors.primary
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
    let id = UUID()
    let topic: String
    let question: String
    let answer: String
    let popular: Bool
}

struct LearningResource: Identifiable {
    let id = UUID()
    let title: String
    let description: String
    let estimatedTime: String
}

struct MCQQuestion: Identifiable {
    let id = UUID()
    let question: String
    let options: [String]
    let answerIndex: Int
}

struct TFQuestion: Identifiable {
    let id = UUID()
    let statement: String
    let isTrue: Bool
}
