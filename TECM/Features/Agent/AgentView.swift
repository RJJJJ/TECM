import SwiftUI

struct AgentView: View {
    @State private var keyword = ""
    @State private var selectedTopic = "全部"
    @State private var expandedID: UUID?

    private var topics: [String] {
        ["全部"] + Array(Set(MockDataStore.faq.map(\.topic))).sorted()
    }

    private var filteredFAQ: [FAQItem] {
        MockDataStore.faq.filter { item in
            let topicMatch = selectedTopic == "全部" || item.topic == selectedTopic
            let keywordMatch = keyword.isEmpty || item.question.localizedCaseInsensitiveContains(keyword)
            return topicMatch && keywordMatch
        }
    }

    var body: some View {
        ScreenContainer(title: "TECM AGENT") {
            QuietCard {
                Text("FAQ 助理")
                    .font(Theme.Typography.cardTitle)
                Text("現階段提供穩定且可追溯的常見問題解答，未來將升級為對話式 AI Agent。")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Theme.Colors.blueGray)
                TextField("搜尋問題", text: $keyword)
            }
            .padding(Theme.Spacing.sm)
            .background(Theme.Colors.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .subtleCardShadow()

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.xs) {
                    ForEach(topics, id: \.self) { topic in
                        Button(topic) { selectedTopic = topic }
                            .font(Theme.Typography.chip)
                            .foregroundStyle(selectedTopic == topic ? .white : Theme.Colors.primary)
                            .padding(.horizontal, Theme.Spacing.sm)
                            .padding(.vertical, Theme.Spacing.xs)
                            .background(selectedTopic == topic ? Theme.Colors.primary : Theme.Colors.mistBlue.opacity(0.5))
                            .clipShape(Capsule())
                            .buttonStyle(PressableScaleStyle())
                    }
                }
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                SectionHeader(title: "熱門提問", subtitle: nil)
                let popularItems = MockDataStore.faq.filter(\.popular)
                ForEach(popularItems) { item in
                    Text("• \(item.question)")
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.textPrimary)
                }
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                SectionHeader(title: "FAQ", subtitle: "點擊展開答案")
                if filteredFAQ.isEmpty {
                    EmptyState(title: "找不到相關問題", message: "可嘗試其他關鍵字，或直接聯絡中心顧問。")
                } else {
                    ForEach(filteredFAQ) { item in
                        FAQRow(item: item, expandedID: $expandedID)
                    }
                }
            }

            OutlineCard {
                Text("AI 升級預留區")
                    .font(Theme.Typography.cardTitle)
                Text("未來可接入對話紀錄、上下文理解與轉人工服務。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }
}

#Preview {
    NavigationStack { AgentView() }
}
