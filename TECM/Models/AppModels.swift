import SwiftUI

struct NewsItem: Identifiable {
    let id = UUID()
    let title: String
    let date: String
}

struct Course: Identifiable {
    let id = UUID()
    let title: String
    let ageGroup: String
    let category: String
    let summary: String
    let schedule: String
    let campus: String
}

struct FAQItem: Identifiable {
    let id = UUID()
    let question: String
    let answer: String
}

struct BookingRecord: Identifiable {
    let id = UUID()
    let parentName: String
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
        case .pending:
            return Theme.Colors.warning
        case .confirmed:
            return Theme.Colors.success
        case .completed:
            return Theme.Colors.primaryBlue
        }
    }
}

struct ParentNotification: Identifiable {
    let id = UUID()
    let title: String
    let time: String
}
