import SwiftUI

struct ParentCenterView: View {
    var body: some View {
        ScreenContainer(title: "家長中心") {
            ElevatedCard {
                Text("歡迎回來，陳太")
                    .font(Theme.Typography.cardTitle)
                Text("孩子：昊昊（6-8歲） ・ 會員編號 P-1024")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            HStack(spacing: Theme.Spacing.md) {
                ParentDashboardTile(title: "近期預約", value: "2 筆", note: "1 筆待確認")
                ParentDashboardTile(title: "本月課程", value: "4 堂", note: "下次課程：4/13")
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                SectionHeader(title: "最近動態", subtitle: "預約、通知與課程摘要")
                ForEach(MockDataStore.notifications) { notification in
                    QuietCard {
                        Text(notification.title)
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                        Text(notification.detail)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                        Text(notification.time)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.blueGray)
                    }
                }
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                SectionHeader(title: "服務入口", subtitle: nil)
                NavigationLink(destination: LearningCenterView()) {
                    QuickActionTile(title: "學習中心", subtitle: "查看延伸學習資源", icon: "sparkles")
                }
                .buttonStyle(PressableScaleStyle())

                SecondaryButton(title: "聯絡中心") { }
            }
        }
    }
}

#Preview {
    NavigationStack { ParentCenterView() }
}
