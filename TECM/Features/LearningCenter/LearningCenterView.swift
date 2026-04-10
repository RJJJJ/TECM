import SwiftUI

struct LearningCenterView: View {
    var body: some View {
        ScreenContainer(title: "學習中心") {
            SectionHeader(
                title: "學習中心",
                subtitle: "以小步驟互動練習，建立孩子對知識點的理解與信心"
            )

            VStack(spacing: Theme.Spacing.md) {
                NavigationLink(destination: MultipleChoicePracticeView()) {
                    LearningEntryCard(
                        title: "選擇題練習",
                        description: "以單題互動方式，引導孩子逐步理解重點。",
                        icon: "square.grid.2x2.fill"
                    )
                }
                .buttonStyle(.plain)

                NavigationLink(destination: TrueFalsePracticeView()) {
                    LearningEntryCard(
                        title: "判斷題練習",
                        description: "用清晰的是非判斷，建立基礎概念辨識能力。",
                        icon: "checkmark.seal.fill"
                    )
                }
                .buttonStyle(.plain)
            }

            Text("此區為課堂延伸互動示範，實際內容將按課程進度安排")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
                .padding(.top, Theme.Spacing.xs)
        }
    }
}

private struct LearningEntryCard: View {
    let title: String
    let description: String
    let icon: String

    @State private var isPressed = false

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Theme.Colors.softBlue)
                    .frame(width: 52, height: 52)
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundStyle(Theme.Colors.primaryBlue)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                Text(description)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .multilineTextAlignment(.leading)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.Colors.textSecondary)
        }
        .padding(Theme.Spacing.md)
        .background(Theme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.card, style: .continuous))
        .scaleEffect(isPressed ? 0.98 : 1)
        .shadow(color: Theme.Shadow.card, radius: isPressed ? 4 : 10, y: isPressed ? 1 : 3)
        .animation(.easeOut(duration: 0.15), value: isPressed)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in isPressed = true }
                .onEnded { _ in isPressed = false }
        )
    }
}
