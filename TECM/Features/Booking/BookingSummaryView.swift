import SwiftUI

struct BookingSummaryView: View {
    @Environment(\.dismiss) private var dismiss
    let courseType: String
    let school: String
    let childAge: String
    let campus: String
    let preferredDate: Date
    let startTimeSlot: String
    let estimatedEndTimeSlot: String
    let parentName: String
    let phone: String
    let note: String
    let onConfirm: () -> Void

    private var trimmedParentName: String { parentName.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedSchool: String { school.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedPhone: String { phone.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedNote: String { note.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var missingFields: [String] {
        var fields: [String] = []
        if trimmedSchool.isEmpty { fields.append("孩子就讀學校") }
        if trimmedParentName.isEmpty { fields.append("家長姓名") }
        if trimmedPhone.isEmpty { fields.append("聯絡電話") }
        return fields
    }

    private var isConfirmDisabled: Bool {
        !missingFields.isEmpty
    }

    var body: some View {
        ScreenContainer(title: "預約摘要", showBackButton: true) {
            PremiumSectionHeader(
                eyebrow: "Booking Summary",
                title: "請確認後提交預約",
                subtitle: "以下為送出前最終資訊，確認無誤後即可提交。"
            )

            ElevatedCard {
                HStack {
                    Text("預約狀態")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                    Spacer()
                    StatusChip(title: "待確認", color: Theme.Colors.accent)
                }

                groupedHeader("預約資訊")
                summaryRow(title: "課程 / 服務", value: courseType)
                summaryRow(title: "孩子就讀學校", value: fallbackValue(trimmedSchool))
                summaryRow(title: "孩子年齡", value: childAge)
                summaryRow(title: "校區 / 地點", value: campus)
                summaryRow(title: "日期", value: preferredDate.formatted(date: .complete, time: .omitted))
                summaryRow(title: "開始時間", value: startTimeSlot)
                summaryRow(title: "預估結束", value: estimatedEndTimeSlot)

                groupedHeader("聯絡資訊")
                summaryRow(title: "家長姓名", value: fallbackValue(trimmedParentName))
                summaryRow(title: "聯絡電話", value: fallbackValue(trimmedPhone))

                groupedHeader("補充備註")
                summaryRow(title: "備註", value: fallbackValue(trimmedNote, fallback: "無"))
            }

            if !missingFields.isEmpty {
                OutlineCard {
                    Text("尚未完成欄位")
                        .font(Theme.Typography.cardTitle)
                    Text("請先補齊：\(missingFields.joined(separator: "、"))，再提交預約。")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Color.red)
                }
            }

            OutlineCard {
                Text("提交前提醒")
                    .font(Theme.Typography.cardTitle)
                Text("我們將根據你提交的資料安排預約，成功提交後會立即顯示確認結果。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            VStack(spacing: Theme.Spacing.sm) {
                SecondaryCTAButton(title: "返回修改") { dismiss() }
                PrimaryCTAButton(title: isConfirmDisabled ? "請先補齊資料" : "確認提交", isDisabled: isConfirmDisabled, action: onConfirm)
            }
        }
    }

    private func groupedHeader(_ title: String) -> some View {
        Text(title)
            .font(Theme.Typography.chip)
            .foregroundStyle(Theme.Colors.blueGray)
            .padding(.top, Theme.Spacing.xxs)
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

    private func fallbackValue(_ value: String, fallback: String = "尚未填寫") -> String {
        value.isEmpty ? fallback : value
    }
}

#Preview {
    NavigationStack {
        BookingSummaryView(
            courseType: "小學數理思維",
            school: "培正中學附屬小學",
            childAge: "6歲",
            campus: "澳門半島校區",
            preferredDate: .now,
            startTimeSlot: "11:00",
            estimatedEndTimeSlot: "12:00",
            parentName: "陳太",
            phone: "+853 6XXX XXXX",
            note: "孩子第一次體驗，偏好中文說明。",
            onConfirm: {}
        )
    }
}
