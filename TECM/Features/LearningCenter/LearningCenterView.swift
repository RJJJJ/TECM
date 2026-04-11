import SwiftUI

struct LearningCenterView: View {
    var body: some View {
        ScreenContainer(title: "考前練習", showBackButton: true) {
            PremiumSectionHeader(
                eyebrow: "Practice Studio",
                title: "考前練習中心",
                subtitle: "以短題練習鞏固 Python / Scratch / C++ 核心觀念"
            )

            QuietCard {
                Text("練習流程預覽")
                    .font(Theme.Typography.cardTitle)
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    flowRow(index: 1, text: "先選科目（Python / Scratch / C++）")
                    flowRow(index: 2, text: "再選等級與試卷，控制練習難度")
                    flowRow(index: 3, text: "完成後查看結果，決定下一步")
                }
                Text("每份試卷維持 6 題，小步快跑，保持孩子專注。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            ElevatedCard {
                Text("進入前小提示")
                    .font(Theme.Typography.cardTitle)
                Text("建議先讓孩子完成 1 份示範試卷，再由家長一起看結果摘要，比較容易判斷課程銜接方向。")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .lineSpacing(2)

                HStack(spacing: Theme.Spacing.sm) {
                    NavigationLink(destination: PracticeSubjectSelectionView()) {
                        Text("開始設定練習")
                    }
                    .buttonStyle(RefinedPrimaryButtonStyle())

                    NavigationLink(destination: PracticeSubjectSelectionView(showAsCatalog: true)) {
                        Text("先看科目")
                    }
                    .buttonStyle(RefinedSecondaryButtonStyle())
                }
            }
        }
        .toolbar(.hidden, for: .tabBar)
    }

    private func flowRow(index: Int, text: String) -> some View {
        HStack(spacing: Theme.Spacing.xs) {
            Text("\(index)")
                .font(Theme.Typography.chip)
                .foregroundStyle(Theme.Colors.primary)
                .frame(width: 18, height: 18)
                .background(Theme.Colors.mistBlue, in: Circle())
            Text(text)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }
}

struct PracticeSubjectSelectionView: View {
    private let subjects = MockDataStore.practiceSubjects
    var showAsCatalog = false

    var body: some View {
        ScreenContainer(title: showAsCatalog ? "科目總覽" : "選擇科目", showBackButton: true) {
            SectionHeader(title: "選擇科目", subtitle: "先挑選本次練習科目，再進入等級與試卷。")

            ForEach(subjects) { subject in
                NavigationLink(destination: PracticeLevelSelectionView(subject: subject)) {
                    SubjectCard(subject: subject)
                }
                .buttonStyle(PressableScaleStyle())
            }
        }
        .toolbar(.hidden, for: .tabBar)
    }
}

struct PracticeLevelSelectionView: View {
    let subject: PracticeSubject

    private var levels: [String] {
        Array(Set(subject.papers.map(\.levelLabel))).sorted()
    }

    var body: some View {
        ScreenContainer(title: "選擇等級", showBackButton: true) {
            SectionHeader(title: subject.title, subtitle: "依孩子目前程度挑選合適練習。")

            ForEach(levels, id: \.self) { level in
                NavigationLink(destination: PracticePaperSelectionView(subject: subject, selectedLevel: level)) {
                    ElevatedCard {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(level)
                                    .font(Theme.Typography.cardTitle)
                                Text("\(subject.title) \(level) 試卷")
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(Theme.Colors.textSecondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundStyle(Theme.Colors.blueGray)
                        }
                    }
                }
                .buttonStyle(PressableScaleStyle())
            }
        }
        .toolbar(.hidden, for: .tabBar)
    }
}

struct PracticePaperSelectionView: View {
    let subject: PracticeSubject
    let selectedLevel: String

    private var papers: [PracticePaper] {
        subject.papers.filter { $0.levelLabel == selectedLevel }
    }

    var body: some View {
        ScreenContainer(title: "選擇試卷", showBackButton: true) {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Text("考前練習 / \(subject.title)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                SectionHeader(title: selectedLevel, subtitle: "每份試卷 6 題，混合選擇題與判斷題。")
            }

            if papers.isEmpty {
                EmptyState(title: "目前尚無試卷", message: "稍後可再查看，或請顧問協助安排展示內容。")
            } else {
                ForEach(papers) { paper in
                    NavigationLink(destination: PracticePaperDetailView(subject: subject, paper: paper)) {
                        PaperCard(paper: paper)
                    }
                    .buttonStyle(PressableScaleStyle())
                }
            }
        }
        .toolbar(.hidden, for: .tabBar)
    }
}
