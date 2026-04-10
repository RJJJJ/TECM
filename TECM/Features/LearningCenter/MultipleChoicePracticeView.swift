import SwiftUI

struct MultipleChoicePracticeView: View {
    @State private var currentIndex = 0
    @State private var selectedOptionID: UUID?
    @State private var isSubmitted = false
    @State private var correctCount = 0

    private let questions = MockDataStore.multipleChoiceQuestions

    private var currentQuestion: MultipleChoiceQuestion { questions[currentIndex] }
    private var progressText: String { "\(currentIndex + 1)/\(questions.count)" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                header

                if currentIndex < questions.count {
                    questionCard
                    optionsSection
                    if isSubmitted { feedbackCard }
                    footerAction
                } else {
                    completionCard
                }
            }
            .padding(Theme.Spacing.md)
        }
        .background(Theme.Colors.background.ignoresSafeArea())
        .navigationTitle("選擇題練習")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        HStack {
            TagChip(title: "選擇題")
            Spacer()
            Text(progressText)
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
                .foregroundStyle(Theme.Colors.textPrimary)

            RoundedRectangle(cornerRadius: Theme.CornerRadius.button, style: .continuous)
                .fill(Theme.Colors.softBlue)
                .frame(height: 86)
                .overlay {
                    Label("示意圖區塊", systemImage: "photo")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
        }
    }

    private var optionsSection: some View {
        VStack(spacing: Theme.Spacing.sm) {
            ForEach(currentQuestion.options) { option in
                Button {
                    guard !isSubmitted else { return }
                    selectedOptionID = option.id
                } label: {
                    HStack(spacing: Theme.Spacing.sm) {
                        Text(option.text)
                            .foregroundStyle(Theme.Colors.textPrimary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if selectedOptionID == option.id {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(Theme.Colors.primaryBlue)
                        }
                    }
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.vertical, Theme.Spacing.md)
                    .background(selectedOptionID == option.id ? Theme.Colors.softBlue : Theme.Colors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.card, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: Theme.CornerRadius.card, style: .continuous)
                            .stroke(selectedOptionID == option.id ? Theme.Colors.primaryBlue.opacity(0.35) : .clear, lineWidth: 1)
                    }
                    .shadow(color: Theme.Shadow.card, radius: 8, y: 2)
                }
                .buttonStyle(.plain)
                .animation(.easeOut(duration: 0.15), value: selectedOptionID)
            }
        }
    }

    private var feedbackCard: some View {
        let isCorrect = selectedOptionID == currentQuestion.correctOptionID
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
        .disabled(!isSubmitted && selectedOptionID == nil)
        .opacity(!isSubmitted && selectedOptionID == nil ? 0.45 : 1)
    }

    private var completionCard: some View {
        InfoCard {
            Text("完成本次練習")
                .font(.title3.weight(.bold))
            Text("你本次答對 \(correctCount) / \(questions.count) 題")
                .foregroundStyle(Theme.Colors.textSecondary)

            VStack(spacing: Theme.Spacing.sm) {
                PrimaryButton(title: "再做一次") {
                    reset()
                }
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
        guard !isSubmitted, let selectedOptionID else { return }
        isSubmitted = true
        if selectedOptionID == currentQuestion.correctOptionID {
            correctCount += 1
        }
    }

    private func goNextQuestion() {
        guard isSubmitted else { return }
        currentIndex += 1
        selectedOptionID = nil
        isSubmitted = false
    }

    private func reset() {
        currentIndex = 0
        selectedOptionID = nil
        isSubmitted = false
        correctCount = 0
    }
}
