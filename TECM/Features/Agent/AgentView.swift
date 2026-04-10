import SwiftUI

struct AgentView: View {
    @State private var selectedFAQ: FAQItem?

    var body: some View {
        ScreenContainer(title: "TECM AGENT") {
            InfoCard {
                Text("智能常見問題助理")
                    .font(.headline)
                Text("現階段提供 FAQ 快速解答。未來將升級為完整對話式 AI 顧問。")
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                SectionHeader(title: "快捷問題", subtitle: nil)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Spacing.sm) {
                        ForEach(MockDataStore.faq) { faq in
                            Button {
                                selectedFAQ = faq
                            } label: {
                                TagChip(title: faq.question, isSelected: selectedFAQ?.id == faq.id)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            if let selectedFAQ {
                FAQItemCard(question: selectedFAQ.question, answer: selectedFAQ.answer)
            } else {
                EmptyStateView(title: "請選擇一條常見問題", message: "點選上方快捷問題，即可查看 TECM AGENT 建議答案。")
            }

            InfoCard {
                Text("未來對話輸入區（示意）")
                    .font(.subheadline.weight(.semibold))
                RoundedRectangle(cornerRadius: Theme.CornerRadius.button, style: .continuous)
                    .fill(Theme.Colors.softBlue)
                    .frame(height: 48)
                    .overlay(alignment: .leading) {
                        Text("未來可在此輸入問題…")
                            .foregroundStyle(Theme.Colors.textSecondary)
                            .padding(.horizontal)
                    }
                HStack(spacing: Theme.Spacing.sm) {
                    NavigationLink(destination: BookingView()) {
                        Text("前往預約試堂")
                            .fontWeight(.semibold)
                    }
                    Spacer()
                    Button("聯絡我們") { }
                }
                .foregroundStyle(Theme.Colors.primaryBlue)
            }
        }
    }
}
