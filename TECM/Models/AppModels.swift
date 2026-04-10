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
