import SwiftUI

struct ParentMakeupReminderView: View {
    let summaries: [ParentExamAttendanceSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(
                eyebrow: "ParentMakeupReminderView",
                title: "補課提醒",
                subtitle: "用簡潔方式顯示待安排或已安排補課，不顯示老師內部備註。"
            )

            let reminders = summaries.filter { $0.pendingMakeupCount > 0 || $0.scheduledMakeupCount > 0 }

            if reminders.isEmpty {
                EmptyStateView(title: "暫無待補課", message: "目前沒有需要特別跟進的補課提醒。")
            } else {
                ForEach(reminders) { summary in
                    ElevatedCard {
                        HStack(alignment: .top) {
                            Image(systemName: "bell.badge")
                                .foregroundStyle(Theme.Colors.primary)
                            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                                Text(summary.studentName)
                                    .font(Theme.Typography.body.weight(.semibold))
                                Text(summary.displayText)
                                    .font(Theme.Typography.body)
                                Text("已安排補課 \(summary.scheduledMakeupCount) 節")
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(Theme.Colors.textSecondary)
                            }
                            Spacer()
                        }
                    }
                }
            }
        }
    }
}
