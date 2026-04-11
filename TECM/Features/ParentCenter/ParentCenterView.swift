import SwiftUI

struct ParentCenterView: View {
    @State private var showSupportSuccess = false
    @EnvironmentObject private var tabRouter: TabRouter

    var body: some View {
        ScreenContainer(title: "家長中心") {
            PremiumSectionHeader(eyebrow: "Personal Service Space", title: "你的專屬服務區", subtitle: "聚焦預約與顧問支援，不呈現後台式資訊噪音")

            ElevatedCard {
                Text("歡迎回來，陳太")
                    .font(Theme.Typography.cardTitle)
                Text("孩子：昊昊（6-8歲） ・ 會員編號 P-1024")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Divider()
                Text("近期服務摘要")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.blueGray)
                Text("目前有 2 筆預約紀錄，其中 1 筆待顧問確認。")
                    .font(Theme.Typography.body)
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                PremiumSectionHeader(title: "服務入口", subtitle: "僅保留與前期預約決策相關模組")
                Button {
                    tabRouter.select(.booking)
                } label: {
                    QuickActionTile(title: "預約摘要", subtitle: "查看目前提交與待安排的體驗需求", icon: "calendar")
                }
                .buttonStyle(PressableScaleStyle())

                Button {
                    tabRouter.select(.agent)
                } label: {
                    QuickActionTile(title: "顧問常見問題", subtitle: "先由 TECM AGENT 協助，再接人工顧問", icon: "person.text.rectangle")
                }
                .buttonStyle(PressableScaleStyle())
            }

            if showSupportSuccess {
                SuccessStateView(title: "已收到你的支援需求", message: "服務團隊將在工作時段內與你聯絡。")
            }

            SecondaryCTAButton(title: "聯絡中心") {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showSupportSuccess = true
                }
            }
        }
    }
}

#Preview {
    NavigationStack { ParentCenterView() }
        .environmentObject(TabRouter())
}
