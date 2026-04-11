import SwiftUI

struct PracticePaperDetailView: View {
    let subject: PracticeSubject
    let paper: PracticePaper

    @Environment(\.dismiss) private var dismiss
    @State private var currentIndex = 0
    @State private var selectedAnswerIndex: Int?
    @State private var isSubmitted = false
    @State private var correctCount = 0
    @State private var isCompleted = false

    private var currentQuestion: PracticeQuestion { paper.questions[currentIndex] }
    private var isLastQuestion: Bool { currentIndex == paper.questions.count - 1 }

    var body: some View {
        ScreenContainer(title: "試卷練習", showBackButton: true) {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                if isCompleted {
                    ResultSummaryView(
                        subject: subject,
                        paper: paper,
                        correctCount: correctCount,
                        retryAction: restart,
                        backAction: { dismiss() }
                    )
                } else {
                    ProgressHeader(
                        subjectTitle: subject.title,
                        paperTitle: paper.title,
                        current: currentIndex + 1,
                        total: paper.questionCount
                    )

                    questionCard
                    answerArea
                    actionArea
                }
            }
            .animation(.easeInOut(duration: 0.2), value: currentIndex)
            .animation(.easeInOut(duration: 0.2), value: isSubmitted)
            .animation(.easeInOut(duration: 0.2), value: isCompleted)
        }
        .toolbar(.hidden, for: .tabBar)
    }

    private var questionCard: some View {
        ElevatedCard {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                QuestionTypeChip(type: currentQuestion.type)
                Text("第 \(currentIndex + 1) 題")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.blueGray)
                Text(currentQuestion.prompt)
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .foregroundStyle(Theme.Colors.textPrimary)
                    .lineSpacing(4)
                if let note = currentQuestion.note {
                    Text(note)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
        }
    }

    private var answerArea: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            ForEach(Array(currentQuestion.normalizedOptions.enumerated()), id: \.offset) { index, option in
                AnswerOptionCard(title: option, isSelected: selectedAnswerIndex == index) {
                    guard !isSubmitted else { return }
                    selectedAnswerIndex = index
                }
                .disabled(isSubmitted)
            }
        }
    }

    private var actionArea: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            if isSubmitted, let selectedAnswerIndex {
                FeedbackPanel(
                    isCorrect: selectedAnswerIndex == currentQuestion.correctAnswer,
                    explanation: currentQuestion.explanation
                )
            }

            if isSubmitted {
                Button(isLastQuestion ? "查看結果" : "下一題") {
                    proceedToNextStep()
                }
                .buttonStyle(PrimaryCTAButtonStyle())
            } else {
                Button("提交答案") {
                    submitCurrentAnswer()
                }
                .disabled(selectedAnswerIndex == nil)
                .buttonStyle(PrimaryCTAButtonStyle(isDisabled: selectedAnswerIndex == nil))
            }
        }
    }

    private func submitCurrentAnswer() {
        guard let selectedAnswerIndex else { return }
        if selectedAnswerIndex == currentQuestion.correctAnswer {
            correctCount += 1
        }
        isSubmitted = true
    }

    private func proceedToNextStep() {
        if isLastQuestion {
            isCompleted = true
            return
        }

        currentIndex += 1
        selectedAnswerIndex = nil
        isSubmitted = false
    }

    private func restart() {
        currentIndex = 0
        selectedAnswerIndex = nil
        isSubmitted = false
        correctCount = 0
        isCompleted = false
    }
}

struct ResultSummaryView: View {
    let subject: PracticeSubject
    let paper: PracticePaper
    let correctCount: Int
    let retryAction: () -> Void
    let backAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            ResultSummaryCard(
                subjectTitle: subject.title,
                paperTitle: paper.title,
                correctCount: correctCount,
                total: paper.questionCount
            )

            Button("再做一次") {
                retryAction()
            }
            .buttonStyle(PrimaryCTAButtonStyle())

            Button("返回試卷列表") {
                backAction()
            }
            .buttonStyle(SecondaryCTAButtonStyle())
        }
    }
}

#Preview {
    NavigationStack {
        PracticePaperDetailView(
            subject: MockDataStore.practiceSubjects[0],
            paper: MockDataStore.practiceSubjects[0].papers[0]
        )
    }
}
