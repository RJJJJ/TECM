import SwiftUI

struct MultipleChoicePracticeView: View {
    @State private var selectedAnswers: [UUID: Int] = [:]

    var body: some View {
        ScreenContainer(title: "選擇題練習") {
            QuietCard {
                Text("示範題庫")
                    .font(Theme.Typography.cardTitle)
                Text("此區僅作學習延伸展示，不作刷題導向。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            ForEach(MockDataStore.mcqQuestions) { question in
                ElevatedCard {
                    Text(question.question)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                    ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                        Button {
                            selectedAnswers[question.id] = index
                        } label: {
                            HStack {
                                Text(option)
                                Spacer()
                                if selectedAnswers[question.id] == index {
                                    Image(systemName: "checkmark.circle.fill")
                                }
                            }
                            .foregroundStyle(Theme.Colors.textPrimary)
                            .padding(Theme.Spacing.sm)
                            .background(Theme.Colors.warmSurface)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
                        }
                        .buttonStyle(PressableScaleStyle())
                    }
                }
            }
        }
    }
}

#Preview {
    NavigationStack { MultipleChoicePracticeView() }
}
