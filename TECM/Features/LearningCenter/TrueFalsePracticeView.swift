import SwiftUI

struct TrueFalsePracticeView: View {
    @State private var selectedAnswer: Bool?
    @State private var submitted = false

    private let question = MockDataStore.trueFalseQuestions[0]

    var body: some View {
        ScreenContainer(title: "判斷題練習") {
            InfoCard {
                Text(question.prompt)
                    .font(.headline)

                HStack(spacing: Theme.Spacing.sm) {
                    answerButton(title: "正確", value: true)
                    answerButton(title: "錯誤", value: false)
                }

                PrimaryButton(title: "提交答案") {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        submitted = true
                    }
                }
            }

            if submitted {
                let isCorrect = selectedAnswer == question.answer
                InfoCard {
                    HStack {
                        StatusBadge(title: isCorrect ? "已掌握" : "可再練習", color: isCorrect ? Theme.Colors.success : Theme.Colors.warning)
                        Text(isCorrect ? "回答正確" : "回答完成")
                            .font(.headline)
                    }
                    Text(question.explanation)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                .transition(.opacity)
            }
        }
    }

    private func answerButton(title: String, value: Bool) -> some View {
        Button {
            selectedAnswer = value
        } label: {
            Text(title)
                .fontWeight(.semibold)
                .foregroundStyle(selectedAnswer == value ? .white : Theme.Colors.primaryBlue)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Theme.Spacing.sm)
                .background(selectedAnswer == value ? Theme.Colors.primaryBlue : Theme.Colors.softBlue)
                .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.button, style: .continuous))
        }
        .buttonStyle(PressableScaleStyle())
    }
}
