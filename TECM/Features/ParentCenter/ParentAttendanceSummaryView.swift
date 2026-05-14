import SwiftUI

struct ParentAttendanceSummaryView: View {
    let summaries: [ParentExamAttendanceSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(
                eyebrow: "ParentAttendanceSummaryView",
                title: "考試班出席摘要",
                subtitle: "查看孩子在考試預備班的出席情況和需要補課的數量。"
            )

            if summaries.isEmpty {
                EmptyStateView(title: "暫無出席紀錄", message: "目前未有考試班出席資料。")
            } else {
                ForEach(summaries) { summary in
                    ElevatedCard {
                        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                            HStack {
                                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                                    Text(summary.studentName)
                                        .font(Theme.Typography.cardTitle)
                                    Text(summary.cohortName)
                                        .font(Theme.Typography.caption)
                                        .foregroundStyle(Theme.Colors.textSecondary)
                                }
                                Spacer()
                                Text(summary.displayText)
                                    .font(Theme.Typography.body.weight(.semibold))
                                    .foregroundStyle(Theme.Colors.primary)
                            }

                            Divider()

                            HStack {
                                SummaryPill(title: "出席率", value: summary.attendanceRateText)
                                SummaryPill(title: "已完成", value: "\(summary.completedLessons) 堂")
                                SummaryPill(title: "已安排補課", value: "\(summary.scheduledMakeupCount) 堂")
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct SummaryPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(title)
                .font(Theme.Typography.chip)
                .foregroundStyle(Theme.Colors.textSecondary)
            Text(value)
                .font(Theme.Typography.caption.weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Spacing.sm)
        .background(Theme.Colors.mistBlue, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
    }
}
