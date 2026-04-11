import SwiftUI

struct AgentView: View {
    @State private var selectedTopic = "全部"
    @State private var keyword = ""
    @State private var selectedQuestionId: String?
    @State private var pendingScrollTargetId: String?

    private var topics: [String] {
        ["全部"] + Array(Set(MockDataStore.faq.map(\.topic))).sorted()
    }

    private var mappedFAQ: [FAQItem] {
        MockDataStore.faq.filter { item in
            let topicMatch = selectedTopic == "全部" || item.topic == selectedTopic
            let keywordMatch = keyword.isEmpty || item.question.localizedCaseInsensitiveContains(keyword) || item.answer.localizedCaseInsensitiveContains(keyword)
            return topicMatch && keywordMatch
        }
    }

    private var effectiveSelectedQuestionId: String? {
        if let selectedQuestionId,
           mappedFAQ.contains(where: { $0.id == selectedQuestionId }) {
            return selectedQuestionId
        }
        return mappedFAQ.first?.id
    }

    var body: some View {
        ScrollViewReader { proxy in
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

                if !mappedFAQ.isEmpty {
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        Text("常見問題")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.blueGray)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Theme.Spacing.xs) {
                                ForEach(mappedFAQ) { item in
                                    Button {
                                        withAnimation(.easeInOut(duration: 0.2)) {
                                            selectedQuestionId = item.id
                                            pendingScrollTargetId = item.id
                                        }
                                    } label: {
                                        FAQChip(title: item.question, selected: effectiveSelectedQuestionId == item.id)
                                    }
                                    .buttonStyle(PressableScaleStyle())
                                }
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        Text("全部可用回答")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.blueGray)
                        ForEach(mappedFAQ) { item in
                            let isSelected = effectiveSelectedQuestionId == item.id
                            Button {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    selectedQuestionId = item.id
                                    pendingScrollTargetId = item.id
                                }
                            } label: {
                                AdvisorAnswerCard(question: item.question, answer: item.answer)
                                    .overlay {
                                        RoundedRectangle(cornerRadius: Theme.Radius.lg, style: .continuous)
                                            .stroke(isSelected ? Theme.Colors.accent.opacity(0.8) : Theme.Colors.line.opacity(0.5), lineWidth: isSelected ? 1.6 : 0.8)
                                    }
                                    .shadow(color: isSelected ? Theme.Colors.accent.opacity(0.18) : .clear, radius: 10, y: 2)
                            }
                            .id(item.id)
                            .buttonStyle(PressableScaleStyle())
                        }
                    }
                } else {
                    EmptyStateView(title: "目前沒有符合的 FAQ", message: "請調整關鍵字，或改選其他主題。")
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
            .onAppear {
                selectedQuestionId = mappedFAQ.first?.id
                pendingScrollTargetId = mappedFAQ.first?.id
            }
            .onChange(of: selectedTopic) { _ in
                selectedQuestionId = mappedFAQ.first?.id
                pendingScrollTargetId = mappedFAQ.first?.id
            }
            .onChange(of: keyword) { _ in
                if let selectedQuestionId,
                   mappedFAQ.contains(where: { $0.id == selectedQuestionId }) {
                    return
                }
                self.selectedQuestionId = mappedFAQ.first?.id
                pendingScrollTargetId = mappedFAQ.first?.id
            }
            .onChange(of: pendingScrollTargetId) { targetId in
                guard let targetId else { return }
                DispatchQueue.main.async {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        proxy.scrollTo(targetId, anchor: .top)
                    }
                    pendingScrollTargetId = nil
                }
            }
        }
    }
}

#Preview {
    NavigationStack { AgentView() }
}
