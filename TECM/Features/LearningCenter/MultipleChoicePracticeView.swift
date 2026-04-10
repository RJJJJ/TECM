import SwiftUI

struct MultipleChoicePracticeView: View {
    @State private var selectedIndex: Int?
    @State private var submitted = false

    private let question = MockDataStore.multipleChoiceQuestions[0]

    var body: some View {
        ScreenContainer(title: "選擇題練習") {
            InfoCard {
                Text(question.prompt)
                    .font(.headline)

                VStack(spacing: Theme.Spacing.xs) {
                    ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                        Button {
                            selectedIndex = index
                        } label: {
                            HStack {
                                Text(option)
                                Spacer()
                                if selectedIndex == index {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Theme.Colors.primaryBlue)
                                }
                            }
                            .padding(.vertical, 10)
                            .padding(.horizontal, Theme.Spacing.sm)
                            .background(Theme.Colors.softBlue.opacity(selectedIndex == index ? 0.9 : 0.5))
                            .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.button, style: .continuous))
                        }
                        .buttonStyle(PressableScaleStyle())
                    }
                }

                PrimaryButton(title: "提交答案") {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        submitted = true
                    }
                }
            }

            if submitted {
                let isCorrect = selectedIndex == question.correctIndex
                InfoCard {
                    HStack {
                        Image(systemName: isCorrect ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(isCorrect ? Theme.Colors.success : Theme.Colors.warning)
                        Text(isCorrect ? "答對了，做得很好" : "已提交，建議再看一次重點")
                            .font(.headline)
                    }
                    Text(question.explanation)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                .transition(.opacity)
            }
        }
    }
}
