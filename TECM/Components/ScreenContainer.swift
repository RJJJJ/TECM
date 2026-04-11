import SwiftUI

struct ScreenContainer<Content: View>: View {
    let title: String?
    let showBackButton: Bool
    let usesScrollView: Bool
    let content: Content
    @Environment(\.dismiss) private var dismiss

    init(
        title: String? = nil,
        showBackButton: Bool = false,
        usesScrollView: Bool = true,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.showBackButton = showBackButton
        self.usesScrollView = usesScrollView
        self.content = content()
    }

    var body: some View {
        Group {
            if usesScrollView {
                ScrollView(showsIndicators: false) {
                    containerContent
                }
            } else {
                containerContent
            }
        }
        .background(
            LinearGradient(
                colors: [Theme.Colors.backgroundTop, Theme.Colors.backgroundBottom],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        )
        .toolbar(.hidden, for: .navigationBar)
    }

    private var containerContent: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
            if let title {
                header(title: title)
            }
            content
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.top, Theme.Spacing.sm)
        .padding(.bottom, Theme.Spacing.xxl)
    }

    @ViewBuilder
    private func header(title: String) -> some View {
        HStack(spacing: Theme.Spacing.sm) {
            if showBackButton {
                Button(action: { dismiss() }) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.Colors.textPrimary)
                        .frame(width: 34, height: 34)
                        .background(Theme.Colors.card, in: RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous)
                                .stroke(Theme.Colors.line.opacity(0.8), lineWidth: 0.8)
                        }
                }
                .buttonStyle(PressableScaleStyle())
            }
            Text(title)
                .font(Theme.Typography.pageTitle)
                .foregroundStyle(Theme.Colors.textPrimary)
            Spacer()
        }
    }
}
