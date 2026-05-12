import SwiftUI

struct ParentAttendanceSummaryView: View {
    let summaries: [ParentExamAttendanceSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(
                eyebrow: "ParentAttendanceSummaryView",
                title: "考級班出席摘要",
                subtitle: "只顯示重點摘要，詳細後台記錄由老師與管理員處理。"
            )

            if summaries.isEmpty {
                EmptyStateView(title: "暫無考級班出席資料", message: "當孩子加入考級班後，這裡會顯示出席與補課摘要。")
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
                                SummaryPill(title: "已完成", value: "\(summary.completedLessons) 節")
                                SummaryPill(title: "已安排", value: "\(summary.scheduledMakeupCount) 節")
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
