import SwiftUI

struct LearningCenterView: View {
    var body: some View {
        ScreenContainer(title: "學習中心") {
            InfoCard {
                Text("學習支援模組")
                    .font(.headline)
                Text("此區為輔助練習功能，幫助家長了解孩子課後學習方向。")
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                SectionHeader(title: "題型示範", subtitle: "以輕量互動展示未來可擴展方向")
                NavigationLink(destination: MultipleChoicePracticeView()) {
                    learningCard(title: "選擇題練習頁", subtitle: "簡單題目、即時回饋、無壓力")
                }
                .buttonStyle(PressableScaleStyle())

                NavigationLink(destination: TrueFalsePracticeView()) {
                    learningCard(title: "判斷題練習頁", subtitle: "對錯練習與重點解析")
                }
                .buttonStyle(PressableScaleStyle())
            }
        }
        .transition(.opacity.combined(with: .move(edge: .trailing)))
    }

    private func learningCard(title: String, subtitle: String) -> some View {
        InfoCard {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                    Text(subtitle)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }
}
