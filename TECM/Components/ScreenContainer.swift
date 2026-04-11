import SwiftUI

enum ScreenContainerBottomSpacing {
    case standard
    case rootTab
    case none

    var paddingValue: CGFloat {
        switch self {
        case .standard:
            return Theme.Spacing.xxl
        case .rootTab:
            return Theme.Spacing.md
        case .none:
            return 0
        }
    }
}

struct ScreenContainer<Content: View>: View {
    let title: String?
    let showBackButton: Bool
    let usesScrollView: Bool
    let bottomSpacing: ScreenContainerBottomSpacing
    let content: Content
    init(
        title: String? = nil,
        showBackButton: Bool = false,
        usesScrollView: Bool = true,
        bottomSpacing: ScreenContainerBottomSpacing = .standard,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.showBackButton = showBackButton
        self.usesScrollView = usesScrollView
        self.bottomSpacing = bottomSpacing
        self.content = content()
    }

    var body: some View {
        Group {
            if usesScrollView {
                ScrollView(showsIndicators: false) {
                    containerContent
                }
                .scrollDismissesKeyboard(.interactively)
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
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(systemNavigationVisibility, for: .navigationBar)
    }

    private var containerContent: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
            if shouldUseCustomHeader, let title {
                header(title: title)
            }
            content
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.top, Theme.Spacing.sm)
        .padding(.bottom, bottomSpacing.paddingValue)
    }

    @ViewBuilder
    private func header(title: String) -> some View {
        HStack(spacing: Theme.Spacing.sm) {
            Text(title)
                .font(Theme.Typography.pageTitle)
                .foregroundStyle(Theme.Colors.textPrimary)
            Spacer()
        }
    }

    private var shouldUseCustomHeader: Bool {
        title != nil && !showBackButton
    }

    private var navigationTitle: String {
        showBackButton ? (title ?? "") : ""
    }

    private var systemNavigationVisibility: Visibility {
        showBackButton ? .visible : .hidden
    }
}
