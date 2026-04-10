import SwiftUI

struct TrueFalsePracticeView: View {
    @State private var currentIndex = 0
    @State private var selectedAnswer: Bool?
    @State private var isSubmitted = false
    @State private var correctCount = 0

    private let questions = MockDataStore.trueFalseQuestions

    private var currentQuestion: TrueFalseQuestion { questions[currentIndex] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                header

                if currentIndex < questions.count {
                    questionCard
                    answerButtons
                    if isSubmitted { feedbackCard }
                    footerAction
                } else {
                    completionCard
                }
            }
            .padding(Theme.Spacing.md)
        }
        .background(Theme.Colors.background.ignoresSafeArea())
        .navigationTitle("判斷題練習")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        HStack {
            TagChip(title: "判斷題")
            Spacer()
            Text("\(currentIndex + 1)/\(questions.count)")
                .font(Theme.Typography.caption.weight(.semibold))
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    private var questionCard: some View {
        InfoCard {
            Text("題目")
                .font(Theme.Typography.caption.weight(.semibold))
                .foregroundStyle(Theme.Colors.textSecondary)
            Text(currentQuestion.prompt)
                .font(.headline)
        }
    }

    private var answerButtons: some View {
        HStack(spacing: Theme.Spacing.sm) {
            answerButton(title: "正確", value: true)
            answerButton(title: "錯誤", value: false)
        }
    }

    private func answerButton(title: String, value: Bool) -> some View {
        Button {
            guard !isSubmitted else { return }
            selectedAnswer = value
        } label: {
            Text(title)
                .font(.headline)
                .foregroundStyle(Theme.Colors.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Theme.Spacing.lg)
                .background(selectedAnswer == value ? Theme.Colors.softBlue : Theme.Colors.surface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.card, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.CornerRadius.card, style: .continuous)
                        .stroke(selectedAnswer == value ? Theme.Colors.primaryBlue.opacity(0.35) : .clear, lineWidth: 1)
                }
                .shadow(color: Theme.Shadow.card, radius: 8, y: 2)
        }
        .buttonStyle(.plain)
        .animation(.easeOut(duration: 0.15), value: selectedAnswer)
    }

    private var feedbackCard: some View {
        let isCorrect = selectedAnswer == currentQuestion.answer
        return InfoCard {
            Text(isCorrect ? "回答正確" : "可再想想")
                .font(.headline)
                .foregroundStyle(isCorrect ? Theme.Colors.success : Theme.Colors.warning)
            Text(currentQuestion.explanation)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    private var footerAction: some View {
        PrimaryButton(title: isSubmitted ? "下一題" : "提交答案") {
            if isSubmitted {
                goNextQuestion()
            } else {
                submitAnswer()
            }
        }
        .disabled(!isSubmitted && selectedAnswer == nil)
        .opacity(!isSubmitted && selectedAnswer == nil ? 0.45 : 1)
    }

    private var completionCard: some View {
        InfoCard {
            Text("完成本次練習")
                .font(.title3.weight(.bold))
            Text("你本次答對 \(correctCount) / \(questions.count) 題")
                .foregroundStyle(Theme.Colors.textSecondary)
            VStack(spacing: Theme.Spacing.sm) {
                PrimaryButton(title: "再做一次") { reset() }
                NavigationLink(destination: LearningCenterView()) {
                    Text("返回學習中心")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Theme.Spacing.sm)
                        .background(Theme.Colors.softBlue)
                        .foregroundStyle(Theme.Colors.primaryBlue)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.button, style: .continuous))
                }
            }
        }
    }

    private func submitAnswer() {
        guard !isSubmitted, let selectedAnswer else { return }
        isSubmitted = true
        if selectedAnswer == currentQuestion.answer {
            correctCount += 1
        }
    }

    private func goNextQuestion() {
        guard isSubmitted else { return }
        currentIndex += 1
        selectedAnswer = nil
        isSubmitted = false
    }

    private func reset() {
        currentIndex = 0
        selectedAnswer = nil
        isSubmitted = false
        correctCount = 0
    }
}
