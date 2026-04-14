import SwiftUI
import Supabase
import Auth

struct ParentCenterView: View {
    @StateObject private var viewModel = ParentCenterViewModel()
    @EnvironmentObject private var tabRouter: TabRouter
    @EnvironmentObject private var authViewModel: AuthViewModel

    @State private var showSupportSuccess = false
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        ScreenContainer(title: "家長中心") {
            PremiumSectionHeader(eyebrow: "Personal Service Space", title: "你的專屬服務區", subtitle: "聚焦預約與顧問支援，不呈現後台式資訊噪音")

            if authViewModel.currentUser == nil {
                loginCard
            } else if viewModel.isLoading {
                VStack(spacing: Theme.Spacing.md) {
                    SkeletonCard()
                    SkeletonCard()
                }
            } else if let errorMessage = viewModel.errorMessage {
                EmptyStateView(title: "資料載入失敗", message: errorMessage)
                SecondaryCTAButton(title: "重新載入") {
                    Task { await viewModel.load(userID: authViewModel.currentUser?.id) }
                }
            } else if let profile = viewModel.profile {
                profileCard(profile)
                serviceEntry
                notificationsSection
            } else {
                EmptyStateView(title: "尚未綁定家長資料", message: "請使用已綁定 parent profile 的帳號登入。")
            }

            if showSupportSuccess {
                SuccessStateView(title: "已收到你的支援需求", message: "服務團隊將在工作時段內與你聯絡。")
            }

            actionButtons
        }
        .task {
            await viewModel.load(userID: authViewModel.currentUser?.id)
        }
        .refreshable {
            await viewModel.load(userID: authViewModel.currentUser?.id)
        }
        .onChange(of: authViewModel.currentUser?.id) { userID in
            Task {
                await viewModel.load(userID: userID)
            }
        }
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
            NavigationLink(destination: ParentReservationSummaryView()) {
                QuickActionTile(title: "預約摘要", subtitle: "查看目前提交與待安排的體驗需求", icon: "calendar")
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
                        viewModel.clear()
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
}
