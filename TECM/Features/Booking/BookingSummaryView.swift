import SwiftUI

struct BookingSummaryView: View {
    @Environment(\.dismiss) private var dismiss
    let courseType: String
    let childProfile: String
    let campus: String
    let preferredDate: Date
    let selectedTimeSlot: String
    let parentName: String
    let phone: String
    let note: String
    let onConfirm: () -> Void

    var body: some View {
        ScreenContainer(title: "預約摘要", showBackButton: true) {
            PremiumSectionHeader(
                eyebrow: "Booking Summary",
                title: "請再次確認預約資訊",
                subtitle: "我們會根據以下內容安排顧問與時段，確認後即可送出。"
            )

            ElevatedCard {
                HStack {
                    Text("預約狀態")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                    Spacer()
                    StatusChip(title: "待確認", color: Theme.Colors.accent)
                }

                summaryRow(title: "課程 / 服務", value: courseType)
                summaryRow(title: "孩子階段", value: childProfile)
                summaryRow(title: "校區", value: campus)
                summaryRow(title: "日期", value: preferredDate.formatted(date: .complete, time: .omitted))
                summaryRow(title: "時段", value: selectedTimeSlot)
                summaryRow(title: "家長姓名", value: parentName)
                summaryRow(title: "電話", value: phone)

                if !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    summaryRow(title: "備註", value: note)
                }
            }

            OutlineCard {
                Text("送出後說明")
                    .font(Theme.Typography.cardTitle)
                Text("送出後顧問將以電話或訊息與你確認最終安排，通常於營業時段內回覆。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            VStack(spacing: Theme.Spacing.sm) {
                SecondaryCTAButton(title: "返回修改") { dismiss() }
                PrimaryCTAButton(title: "確認提交", action: onConfirm)
            }
        }
    }

    private func summaryRow(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(title)
                .font(Theme.Typography.chip)
                .foregroundStyle(Theme.Colors.blueGray)
            Text(value)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, Theme.Spacing.xxs)
    }
}

#Preview {
    NavigationStack {
        BookingSummaryView(
            courseType: "小學數理思維",
            childProfile: "6-8歲",
            campus: "澳門半島校區",
            preferredDate: .now,
            selectedTimeSlot: "11:00 - 12:00",
            parentName: "陳太",
            phone: "+853 6XXX XXXX",
            note: "孩子第一次體驗，偏好中文說明。",
            onConfirm: {}
        )
    }
}
