import SwiftUI

struct SubjectCard: View {
    let subject: PracticeSubject

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .top) {
                Image(systemName: subject.iconName)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.Colors.primary)
                    .padding(10)
                    .background(Theme.Colors.mistBlue.opacity(0.45))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
                Spacer()
                Text("\(subject.papers.count) 份示範試卷")
                    .font(Theme.Typography.chip)
                    .foregroundStyle(Theme.Colors.blueGray)
            }

            Text(subject.title)
                .font(Theme.Typography.cardTitle)
                .foregroundStyle(Theme.Colors.textPrimary)

            Text(subject.subtitle)
                .font(Theme.Typography.caption.weight(.medium))
                .foregroundStyle(Theme.Colors.accent)

            Text(subject.description)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
                .lineSpacing(2)
        }
        .padding(Theme.Spacing.md)
        .background(Theme.Colors.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        .subtleCardShadow()
    }
}

struct PaperCard: View {
    let paper: PracticePaper

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Text(paper.title)
                    .font(Theme.Typography.cardTitle)
                Text("適合程度：\(paper.levelLabel) ・ 建議年齡：\(paper.audience)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            HStack(spacing: Theme.Spacing.xs) {
                StatusChip(title: "選擇題 \(paper.singleChoiceCount) 題", color: Theme.Colors.primary)
                StatusChip(title: "判斷題 \(paper.trueFalseCount) 題", color: Theme.Colors.accent)
            }

            HStack {
                Text("預估時間：約 \(paper.estimatedMinutes) 分鐘")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Spacer()
                Text("開始練習")
                    .font(Theme.Typography.caption.weight(.semibold))
                    .foregroundStyle(Theme.Colors.primary)
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.Colors.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        .subtleCardShadow()
    }
}

struct QuestionTypeChip: View {
    let type: PracticeQuestionType

    var body: some View {
        Text(type.label)
            .font(Theme.Typography.chip)
            .foregroundStyle(Theme.Colors.primary)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.xxs + 2)
            .background(Theme.Colors.mistBlue.opacity(0.55))
            .clipShape(Capsule())
    }
}

struct AnswerOptionCard: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title)
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textPrimary)
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? Theme.Colors.primary : Theme.Colors.line)
            }
            .padding(Theme.Spacing.md)
            .background(isSelected ? Theme.Colors.mistBlue.opacity(0.55) : Theme.Colors.card)
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(isSelected ? Theme.Colors.primary : Theme.Colors.line, lineWidth: isSelected ? 1.4 : 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        }
        .buttonStyle(PressableScaleStyle())
    }
}

struct ProgressHeader: View {
    let subjectTitle: String
    let paperTitle: String
    let current: Int
    let total: Int

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text(subjectTitle)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
            Text(paperTitle)
                .font(Theme.Typography.cardTitle)
                .foregroundStyle(Theme.Colors.textPrimary)
            HStack {
                Text("第 \(current) 題 / 共 \(total) 題")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.blueGray)
                Spacer()
            }

            GeometryReader { proxy in
                let progress = CGFloat(current) / CGFloat(max(total, 1))
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Theme.Colors.line.opacity(0.45))
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Theme.Colors.primary.opacity(0.85))
                        .frame(width: proxy.size.width * progress)
                }
            }
            .frame(height: 6)
        }
        .padding(Theme.Spacing.md)
        .background(Theme.Colors.warmSurface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                .stroke(Theme.Colors.line.opacity(0.5), lineWidth: 1)
        }
    }
}

struct FeedbackPanel: View {
    let isCorrect: Bool
    let explanation: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(isCorrect ? "答對了，節奏很好。" : "再想想，觀念快接近了。")
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(isCorrect ? Theme.Colors.success : Theme.Colors.warning)
            Text(explanation)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
        .padding(Theme.Spacing.md)
        .background((isCorrect ? Theme.Colors.success : Theme.Colors.warning).opacity(0.09))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
    }
}

struct ResultSummaryCard: View {
    let subjectTitle: String
    let paperTitle: String
    let correctCount: Int
    let total: Int

    var body: some View {
        ElevatedCard {
            Text("完成本次練習")
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.Colors.accent)
            Text(paperTitle)
                .font(Theme.Typography.cardTitle)
            Text(subjectTitle)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)

            Divider()

            Text("作答表現")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
            Text("\(correctCount) / \(total) 題答對")
                .font(.system(size: 28, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.Colors.primary)
            Text("已完成基礎鞏固示範，可由顧問安排下一步學習建議。")
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

struct PrimaryCTAButtonStyle: ButtonStyle {
    var isDisabled: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .padding(.vertical, Theme.Spacing.sm)
            .frame(maxWidth: .infinity)
            .background(isDisabled ? Theme.Colors.line : Theme.Colors.primary)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .scaleEffect(configuration.isPressed && !isDisabled ? 0.99 : 1)
            .opacity(configuration.isPressed && !isDisabled ? 0.94 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

struct SecondaryCTAButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(Theme.Colors.primary)
            .padding(.vertical, Theme.Spacing.sm)
            .frame(maxWidth: .infinity)
            .background(Theme.Colors.mistBlue.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
            .opacity(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}
