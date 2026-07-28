import Auth
import Combine
import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class NotificationCenterViewModel: ObservableObject {
    @Published private(set) var notifications: [ParentNotificationItem] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let parentProfileService: ParentProfileServicing
    private let notificationService: NotificationServicing
    private var parentID: UUID?

    init(
        parentProfileService: ParentProfileServicing = ParentProfileService(),
        notificationService: NotificationServicing = NotificationService()
    ) {
        self.parentProfileService = parentProfileService
        self.notificationService = notificationService
    }

    func load(userID: UUID?) async {
        guard let userID else {
            notifications = []
            parentID = nil
            return
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let profile = try await parentProfileService.fetchCurrentParentProfile(userID: userID)
            parentID = profile.id
            notifications = try await notificationService.fetchMyNotifications(parentID: profile.id)
        } catch {
            notifications = []
            errorMessage = error.localizedDescription
        }
    }

    func markRead(_ notification: ParentNotificationItem) async {
        guard !notification.isRead else { return }
        do {
            try await notificationService.markNotificationRead(notificationID: notification.id)
            await reloadNotifications()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func markAllRead() async {
        do {
            try await notificationService.markAllNotificationsRead()
            await reloadNotifications()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func reloadNotifications() async {
        guard let parentID else { return }
        do {
            notifications = try await notificationService.fetchMyNotifications(parentID: parentID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct NotificationCenterView: View {
    let focusNotificationID: UUID?

    @StateObject private var viewModel = NotificationCenterViewModel()
    @EnvironmentObject private var authViewModel: AuthViewModel
    @EnvironmentObject private var pushCoordinator: PushNotificationCoordinator

    init(focusNotificationID: UUID? = nil) {
        self.focusNotificationID = focusNotificationID
    }

    var body: some View {
        ScreenContainer(title: "通知中心", showBackButton: true) {
            PremiumSectionHeader(
                eyebrow: "Notifications",
                title: "通知中心",
                subtitle: "查看預約、出席、補課及付款相關通知。"
            )

            notificationPermissionCard

            if viewModel.notifications.contains(where: { !$0.isRead }) {
                SecondaryCTAButton(title: "全部標為已讀") {
                    Task {
                        await viewModel.markAllRead()
                        await pushCoordinator.refreshUnreadCount()
                    }
                }
            }

            if viewModel.isLoading {
                SkeletonCard()
                SkeletonCard()
            } else if let errorMessage = viewModel.errorMessage {
                EmptyStateView(title: "通知載入失敗", message: errorMessage)
                SecondaryCTAButton(title: "重新載入") {
                    Task { await load() }
                }
            } else if viewModel.notifications.isEmpty {
                EmptyStateView(title: "暫時沒有通知", message: "新通知會顯示在這裡。")
            } else {
                ForEach(viewModel.notifications) { notification in
                    notificationRow(notification)
                }
            }
        }
        .tecmDetailTabBar()
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: authViewModel.currentUser?.id) { _ in
            Task { await load() }
        }
        .onChange(of: pushCoordinator.refreshSequence) { _ in
            Task { await load() }
        }
    }

    @ViewBuilder
    private var notificationPermissionCard: some View {
        switch pushCoordinator.authorizationStatus {
        case .notDetermined:
            ElevatedCard {
                Text("開啟推播通知")
                    .font(Theme.Typography.cardTitle)
                Text("登入後由你決定是否接收重要提醒。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                PrimaryCTAButton(title: "允許通知") {
                    Task { _ = await pushCoordinator.requestAuthorizationAfterUserAction() }
                }
            }
        case .denied:
            ElevatedCard {
                Text("推播通知已關閉")
                    .font(Theme.Typography.cardTitle)
                Text("你仍可在本頁查看通知，或前往系統設定重新開啟推播。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                SecondaryCTAButton(title: "開啟系統設定") {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    UIApplication.shared.open(url)
                }
            }
        default:
            EmptyView()
        }
    }

    private func notificationRow(_ notification: ParentNotificationItem) -> some View {
        Button {
            Task {
                await viewModel.markRead(notification)
                await pushCoordinator.refreshUnreadCount()
                if let deepLink = notification.deepLink,
                   let url = URL(string: deepLink),
                   AppDeepLinkRoute.parse(url) != nil {
                    pushCoordinator.handle(url: url)
                }
            }
        } label: {
            ElevatedCard {
                HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                    Circle()
                        .fill(notification.isRead ? Theme.Colors.line : Theme.Colors.primary)
                        .frame(width: 9, height: 9)
                        .padding(.top, 6)

                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        HStack {
                            Text(notification.title)
                                .font(Theme.Typography.body.weight(.semibold))
                                .foregroundStyle(Theme.Colors.textPrimary)
                            Spacer()
                            Text(notification.relativeTimeText)
                                .font(Theme.Typography.chip)
                                .foregroundStyle(Theme.Colors.blueGray)
                        }
                        Text(notification.detail)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                        if let category = notification.category, !category.isEmpty {
                            Text(category.replacingOccurrences(of: "_", with: " ").uppercased())
                                .font(Theme.Typography.chip)
                                .foregroundStyle(Theme.Colors.primary)
                        }
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if notification.id == focusNotificationID {
                        Image(systemName: "scope")
                            .foregroundStyle(Theme.Colors.primary)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityHint(notification.isRead ? "已讀通知" : "點兩下標為已讀")
    }

    private func load() async {
        await viewModel.load(userID: authViewModel.currentUser?.id)
        await pushCoordinator.refreshUnreadCount()
    }
}
