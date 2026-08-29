import SwiftUI
import Supabase
import Auth

private struct ParentCenterLoadIdentity: Hashable {
    let userID: UUID?
    let hasParentRole: Bool
}

struct ParentCenterView: View {
    @StateObject private var viewModel = ParentCenterViewModel()
    @EnvironmentObject private var tabRouter: TabRouter
    @EnvironmentObject private var authViewModel: AuthViewModel
    @EnvironmentObject private var pushCoordinator: PushNotificationCoordinator

    @State private var showSupportSuccess = false
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        ScreenContainer(title: "家長中心") {
            PremiumSectionHeader(eyebrow: "Personal Service Space", title: "你的專屬服務區", subtitle: "聚焦預約與顧問支援，不呈現後台式資訊噪音")

            switch presentation {
            case .signedOut:
                loginCard
            case .resolving, .loading:
                VStack(spacing: Theme.Spacing.md) {
                    SkeletonCard()
                    SkeletonCard()
                }
            case .unlinkedParent:
                EmptyStateView(
                    title: "此帳戶未連結家長資料",
                    message: "你目前登入的帳戶沒有家長權限。如需連結家長檔案，請聯絡中心職員。"
                )
            case .failure(let errorMessage):
                EmptyStateView(title: "資料載入失敗", message: errorMessage)
                SecondaryCTAButton(title: "重新載入") {
                    Task { await loadParentCenter() }
                }
            case .content:
                if let profile = viewModel.profile {
                    profileCard(profile)
                    ParentAttendanceSummaryView(summaries: viewModel.examSummaries)
                    ParentMakeupReminderView(summaries: viewModel.examSummaries)
                    serviceEntry
                    notificationsSection
                }
            }

            if showSupportSuccess {
                SuccessStateView(title: "已收到你的支援需求", message: "服務團隊將在工作時段內與你聯絡。")
            }

            actionButtons
        }
        .task(id: loadIdentity) {
            authViewModel.configureSensitiveStateCleanup { [weak viewModel] in
                viewModel?.clear()
            }
            await loadParentCenter()
        }
        .refreshable {
            await loadParentCenter()
        }
        .onChange(of: pushCoordinator.refreshSequence) { _ in
            Task { await loadParentCenter() }
        }
    }

    private var loadIdentity: ParentCenterLoadIdentity {
        ParentCenterLoadIdentity(
            userID: authViewModel.currentUser?.id,
            hasParentRole: authViewModel.hasParentRole
        )
    }

    private var presentation: ParentCenterPresentation {
        resolveParentCenterPresentation(
            userID: authViewModel.currentUser?.id,
            hasParentRole: authViewModel.hasParentRole,
            isAuthLoading: authViewModel.isLoading,
            isDataLoading: viewModel.isLoading,
            hasProfile: viewModel.profile != nil,
            errorMessage: viewModel.errorMessage
        )
    }

    private func loadParentCenter() async {
        await viewModel.load(
            userID: authViewModel.currentUser?.id,
            hasParentRole: authViewModel.hasParentRole
        )
    }

    private var loginCard: some View {
        ElevatedCard {
            Text("登入家長帳號")
                .font(Theme.Typography.cardTitle)

            TextField("Email", text: $email)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                .textFieldStyle(.roundedBorder)

            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)

            if let errorMessage = authViewModel.errorMessage {
                Text(errorMessage)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.warning)
            }

            PrimaryCTAButton(title: authViewModel.isLoading ? "登入中…" : "登入", isDisabled: authViewModel.isLoading || email.isEmpty || password.isEmpty) {
                Task {
                    await authViewModel.signIn(email: email, password: password)
                }
            }
            .frame(height: 46)
        }
    }

    private func profileCard(_ profile: ParentProfile) -> some View {
        ElevatedCard {
            Text("歡迎回來，\(profile.fullName)")
                .font(Theme.Typography.cardTitle)
            Text("孩子：\(profile.children.first?.name ?? "未建立") ・ 會員編號 \(profile.id.uuidString.prefix(8).uppercased())")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
            Divider()
            Text("近期服務摘要")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.blueGray)
            Text("目前有 \(viewModel.reservations.count) 筆預約紀錄，其中 \(viewModel.reservations.filter { $0.status == .pending }.count) 筆待顧問確認。")
                .font(Theme.Typography.body)
        }
    }

    private var serviceEntry: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(title: "服務入口", subtitle: "僅保留與前期預約決策相關模組")
            NavigationLink(value: ParentRoute.reservationSummary) {
                QuickActionTile(title: "預約摘要", subtitle: "查看目前提交與待安排的體驗需求", icon: "calendar")
            }
            .buttonStyle(PressableScaleStyle())

            NavigationLink(value: ParentRoute.operations) {
                QuickActionTile(
                    title: "Parent operations",
                    subtitle: "Classes, leave, makeups, credits, charges, and receipts",
                    icon: "list.bullet.rectangle"
                )
            }
            .buttonStyle(PressableScaleStyle())

            Button {
                tabRouter.select(.agent)
            } label: {
                QuickActionTile(title: "顧問常見問題", subtitle: "先由 TECM AGENT 協助，再接人工顧問", icon: "person.text.rectangle")
            }
            .buttonStyle(PressableScaleStyle())
        }
    }

    private var notificationsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            PremiumSectionHeader(title: "通知", subtitle: "僅顯示你的私人通知")

            NavigationLink(value: ParentRoute.notificationCenter(focusID: nil)) {
                QuickActionTile(
                    title: "通知中心",
                    subtitle: pushCoordinator.unreadCount > 0 ? "\(pushCoordinator.unreadCount) 則未讀通知" : "查看所有通知",
                    icon: "bell.fill"
                )
            }
            .buttonStyle(PressableScaleStyle())

            if viewModel.notifications.isEmpty {
                EmptyStateView(title: "目前沒有通知", message: "新預約或顧問更新時會出現在這裡。")
            } else {
                ForEach(viewModel.notifications.prefix(3)) { item in
                    ElevatedCard {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                                Text(item.title)
                                    .font(Theme.Typography.body.weight(.semibold))
                                Text(item.detail)
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(Theme.Colors.textSecondary)
                            }
                            Spacer()
                            Text(item.relativeTimeText)
                                .font(Theme.Typography.chip)
                                .foregroundStyle(Theme.Colors.blueGray)
                        }
                    }
                }
            }
        }
    }

    private var actionButtons: some View {
        Group {
            if authViewModel.currentUser != nil {
                SecondaryCTAButton(title: "登出") {
                    Task {
                        await authViewModel.signOut()
                    }
                }
            } else {
                SecondaryCTAButton(title: "聯絡中心") {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showSupportSuccess = true
                    }
                }
            }
        }
    }
}

#Preview {
    NavigationStack { ParentCenterView() }
        .environmentObject(TabRouter())
        .environmentObject(AuthViewModel())
        .environmentObject(PushNotificationCoordinator())
}
