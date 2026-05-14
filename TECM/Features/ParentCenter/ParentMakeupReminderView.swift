import SwiftUI

struct ParentMakeupReminderView: View {
    let summaries: [ParentExamAttendanceSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(
                eyebrow: "ParentMakeupReminderView",
                title: "補課提醒",
                subtitle: "如孩子缺席考試班課堂，中心會整理補課建議，由 staff 與家長確認安排。"
            )

            let reminders = summaries.filter { $0.pendingMakeupCount > 0 || $0.scheduledMakeupCount > 0 }

            if reminders.isEmpty {
                EmptyStateView(title: "暫無補課提醒", message: "目前沒有待處理的考試班補課。")
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
                                Text("已安排補課：\(summary.scheduledMakeupCount) 堂")
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
