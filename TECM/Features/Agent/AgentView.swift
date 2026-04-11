import SwiftUI

struct AgentView: View {
    @State private var selectedTopic = "全部"
    @State private var keyword = ""
    @State private var selectedQuestion: FAQItem?

    private var topics: [String] {
        ["全部", "幾歲適合開始學？", "零基礎怎樣選課？", "如何預約體驗？", "課程路徑如何安排？"]
    }

    private var mappedFAQ: [FAQItem] {
        let source = MockDataStore.faq
        return source.filter { item in
            let topicMatch = selectedTopic == "全部" || item.question.contains(selectedTopic.replacingOccurrences(of: "？", with: ""))
            let keywordMatch = keyword.isEmpty || item.question.localizedCaseInsensitiveContains(keyword) || item.answer.localizedCaseInsensitiveContains(keyword)
            return topicMatch && keywordMatch
        }
    }

    var body: some View {
        ScreenContainer(title: "TECM AGENT") {
            PremiumSectionHeader(eyebrow: "Advisor", title: "顧問助手", subtitle: "以穩定、可追溯的方式回答家長常見決策問題")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.xs) {
                    ForEach(topics, id: \.self) { topic in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                selectedTopic = topic
                            }
                        } label: {
                            FAQChip(title: topic, selected: selectedTopic == topic)
                        }
                        .buttonStyle(PressableScaleStyle())
                    }
                }
            }

            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Theme.Colors.blueGray)
                TextField("搜尋關鍵字", text: $keyword)
            }
            .padding(Theme.Spacing.sm)
            .background(Theme.Colors.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(Theme.Colors.line.opacity(0.55), lineWidth: 0.8)
            }

            if mappedFAQ.isEmpty {
                EmptyStateView(title: "目前沒有對應內容", message: "請改用其他關鍵字，或直接透過預約流程留下需求。")
            } else {
                ForEach(mappedFAQ) { item in
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { selectedQuestion = item }
                    } label: {
                        AdvisorAnswerCard(question: item.question, answer: selectedQuestion?.id == item.id ? item.answer : "點擊展開顧問建議")
                    }
                    .buttonStyle(PressableScaleStyle())
                }
            }

            OutlineCard {
                Text("對話入口（預留）")
                    .font(Theme.Typography.cardTitle)
                Text("目前維持 FAQ 顧問模式；未來版本可接入完整對話服務。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                TextField("請輸入你的問題（敬請期待）", text: .constant(""))
                    .disabled(true)
                    .textFieldStyle(.roundedBorder)
            }
        }
    }
}

#Preview {
    NavigationStack { AgentView() }
}
