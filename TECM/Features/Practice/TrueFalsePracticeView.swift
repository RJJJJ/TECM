import SwiftUI

struct TrueFalsePracticeView: View {
    @State private var answers: [UUID: Bool] = [:]

    var body: some View {
        ScreenContainer(title: "判斷題練習") {
            QuietCard {
                Text("思考型判斷題")
                    .font(Theme.Typography.cardTitle)
                Text("引導孩子理解概念，而非追求題量。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            ForEach(MockDataStore.tfQuestions) { question in
                ElevatedCard {
                    Text(question.statement)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                    HStack(spacing: Theme.Spacing.md) {
                        optionButton(title: "正確", selected: answers[question.id] == true) {
                            answers[question.id] = true
                        }
                        optionButton(title: "錯誤", selected: answers[question.id] == false) {
                            answers[question.id] = false
                        }
                    }
                }
            }
        }
    }

    private func optionButton(title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(selected ? .white : Theme.Colors.primary)
                .padding(.vertical, Theme.Spacing.xs)
                .frame(maxWidth: .infinity)
                .background(selected ? Theme.Colors.primary : Theme.Colors.mistBlue.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
        }
        .buttonStyle(PressableScaleStyle())
    }
}

#Preview {
    NavigationStack { TrueFalsePracticeView() }
}
