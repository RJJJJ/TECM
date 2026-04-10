import Foundation

struct MultipleChoiceQuestion: Identifiable {
    let id = UUID()
    let prompt: String
    let options: [String]
    let correctIndex: Int
    let explanation: String
}

struct TrueFalseQuestion: Identifiable {
    let id = UUID()
    let prompt: String
    let answer: Bool
    let explanation: String
}
