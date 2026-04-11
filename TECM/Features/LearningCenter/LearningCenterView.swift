import SwiftUI

struct LearningCenterView: View {
    var body: some View {
        ScreenContainer(title: "考前練習") {
            PremiumSectionHeader(
                eyebrow: "Practice Studio",
                title: "考前練習中心",
                subtitle: "以短題練習鞏固 Python / Scratch / C++ 核心觀念"
            )

            QuietCard {
                Text("練習流程")
                    .font(Theme.Typography.cardTitle)
                Text("選擇科目、等級與試卷後即可開始。每份試卷混合選擇題與判斷題，維持專注而不過量。")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .lineSpacing(2)
                NavigationLink(destination: PracticeSubjectSelectionView()) {
                    HStack {
                        Text("開始設定練習")
                        Spacer()
                        Image(systemName: "arrow.right")
                    }
                    .padding(.vertical, Theme.Spacing.sm)
                    .padding(.horizontal, Theme.Spacing.md)
                    .foregroundStyle(.white)
                    .background(Theme.Colors.primary)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                }
                .buttonStyle(PressableScaleStyle())
            }
        }
    }
}

struct PracticeSubjectSelectionView: View {
    private let subjects = MockDataStore.practiceSubjects

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                SectionHeader(title: "選擇科目", subtitle: "先挑選本次練習科目，再進入等級與試卷。")

                ForEach(subjects) { subject in
                    NavigationLink(destination: PracticeLevelSelectionView(subject: subject)) {
                        SubjectCard(subject: subject)
                    }
                    .buttonStyle(PressableScaleStyle())
                }
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.top, Theme.Spacing.md)
            .padding(.bottom, Theme.Spacing.xxl)
        }
        .background(Theme.Colors.background.ignoresSafeArea())
        .navigationTitle("考前練習")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct PracticeLevelSelectionView: View {
    let subject: PracticeSubject

    private var levels: [String] {
        Array(Set(subject.papers.map(\.levelLabel))).sorted()
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                SectionHeader(title: "選擇等級", subtitle: "依孩子目前程度挑選合適練習。")

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
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.top, Theme.Spacing.md)
            .padding(.bottom, Theme.Spacing.xxl)
        }
        .background(Theme.Colors.background.ignoresSafeArea())
        .navigationTitle(subject.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct PracticePaperSelectionView: View {
    let subject: PracticeSubject
    let selectedLevel: String

    private var papers: [PracticePaper] {
        subject.papers.filter { $0.levelLabel == selectedLevel }
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("考前練習 / \(subject.title)")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                    SectionHeader(title: "選擇試卷", subtitle: "\(selectedLevel)・每份試卷 6 題，混合選擇題與判斷題。")
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
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.top, Theme.Spacing.md)
            .padding(.bottom, Theme.Spacing.xxl)
        }
        .background(Theme.Colors.background.ignoresSafeArea())
        .navigationTitle("\(subject.title) \(selectedLevel)")
        .navigationBarTitleDisplayMode(.inline)
    }
}
