import SwiftUI

struct LearningCenterView: View {
    var body: some View {
        ScreenContainer(title: "學習中心") {
            QuietCard {
                Text("延伸學習")
                    .font(Theme.Typography.cardTitle)
                Text("作為課後補充，協助孩子維持穩定學習節奏。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            ForEach(MockDataStore.learningResources) { resource in
                OutlineCard {
                    Text(resource.title)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                    Text(resource.description)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                    Text("建議時長：\(resource.estimatedTime)")
                        .font(Theme.Typography.caption)
                }
            }

            HStack(spacing: Theme.Spacing.md) {
                NavigationLink(destination: MultipleChoicePracticeView()) {
                    QuickActionTile(title: "選擇題練習", subtitle: "2 題示範", icon: "checkmark.circle")
                }
                NavigationLink(destination: TrueFalsePracticeView()) {
                    QuickActionTile(title: "判斷題練習", subtitle: "2 題示範", icon: "checkmark.shield")
                }
            }
            .buttonStyle(PressableScaleStyle())
        }
    }
}

#Preview {
    NavigationStack { LearningCenterView() }
}
