import SwiftUI

struct LearningCenterView: View {
    var body: some View {
        ScreenContainer(title: "學習中心") {
            SectionHeader(title: "互動練習示範", subtitle: "此區為中心教學流程展示，呈現課後可進行的基礎鞏固方式。")

            QuietCard {
                Text("學習中心僅作延伸展示")
                    .font(Theme.Typography.cardTitle)
                Text("此功能用於協助家長理解課後練習形式，不以題量或闖關機制為核心。")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .lineSpacing(2)
                NavigationLink(destination: PracticeSubjectSelectionView()) {
                    HStack {
                        Text("進入互動練習示範")
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
                SectionHeader(title: "選擇科目", subtitle: "先挑選本次示範科目，再進入對應試卷。")

                ForEach(subjects) { subject in
                    NavigationLink(destination: PracticePaperSelectionView(subject: subject)) {
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
        .navigationTitle("學習中心")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct PracticePaperSelectionView: View {
    let subject: PracticeSubject

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("學習中心 / \(subject.title)")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                    SectionHeader(title: "選擇示範試卷", subtitle: "每份試卷為 6 題，混合選擇題與判斷題。")
                }

                if subject.papers.isEmpty {
                    EmptyState(title: "目前尚無試卷", message: "稍後可再查看，或請顧問協助安排展示內容。")
                } else {
                    ForEach(subject.papers) { paper in
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
        .navigationTitle(subject.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
