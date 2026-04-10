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


struct MCOption: Identifiable {
    let id = UUID()
    let text: String
}

struct MultipleChoiceQuestion: Identifiable {
    let id = UUID()
    let prompt: String
    let options: [MCOption]
    let correctOptionID: UUID
    let explanation: String

    init(prompt: String, optionTexts: [String], correctIndex: Int, explanation: String) {
        self.prompt = prompt
        self.options = optionTexts.map { MCOption(text: $0) }
        self.correctOptionID = self.options[correctIndex].id
        self.explanation = explanation
    }
}

struct TrueFalseQuestion: Identifiable {
    let id = UUID()
    let prompt: String
    let answer: Bool
    let explanation: String
}
