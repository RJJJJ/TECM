import Combine
import Foundation
import Supabase
import UIKit
import UserNotifications

final class PushNotificationCoordinator: NSObject, ObservableObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published private(set) var unreadCount = 0
    @Published private(set) var refreshSequence = 0
    @Published private(set) var pendingRoute: AppDeepLinkRoute?
    @Published private(set) var lastErrorMessage: String?

    private let notificationService: NotificationServicing
    private let client: SupabaseClient
    private var activeUserID: UUID?
    private var deviceToken: String?
    private var realtimeUserID: UUID?
    private var realtimeChannel: RealtimeChannelV2?
    private var realtimeObservation: RealtimeSubscription?

    private static let installationIDKey = "tecm.push.installation-id"

    override convenience init() {
        let client = SupabaseClientProvider.shared
        self.init(notificationService: NotificationService(client: client), client: client)
    }

    init(notificationService: NotificationServicing, client: SupabaseClient) {
        self.notificationService = notificationService
        self.client = client
        super.init()
    }

    deinit {
        realtimeObservation?.cancel()
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        if let payload = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            pendingRoute = AppDeepLinkRoute.fromNotificationPayload(payload)
        }
        Task { await refreshAuthorizationStatus() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken data: Data) {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        Task { await registerCurrentDeviceIfPossible() }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        lastErrorMessage = error.localizedDescription
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        Task {
            await refreshUnreadCount()
            refreshSequence &+= 1
            completionHandler(.newData)
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        await refreshUnreadCount()
        refreshSequence &+= 1
        return [.banner, .list, .sound, .badge]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        pendingRoute = AppDeepLinkRoute.fromNotificationPayload(response.notification.request.content.userInfo)
        await refreshUnreadCount()
        refreshSequence &+= 1
    }

    func updateAuthenticatedUser(_ userID: UUID?, hasParentRole: Bool) async {
        lastErrorMessage = nil

        guard let userID, hasParentRole else {
            activeUserID = nil
            await stopRealtimeSubscription()
            unreadCount = 0
            await setApplicationBadge(0)
            return
        }

        activeUserID = userID
        await startRealtimeSubscription(for: userID)
        await refreshAuthorizationStatus()
        if authorizationStatus == .authorized || authorizationStatus == .provisional || authorizationStatus == .ephemeral {
            UIApplication.shared.registerForRemoteNotifications()
        }
        await registerCurrentDeviceIfPossible()
        await refreshUnreadCount()
    }

    @discardableResult
    func requestAuthorizationAfterUserAction() async -> Bool {
        guard activeUserID != nil else { return false }
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            await refreshAuthorizationStatus()
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
            return granted
        } catch {
            lastErrorMessage = error.localizedDescription
            return false
        }
    }

    func sceneDidBecomeActive() async {
        await refreshAuthorizationStatus()
        guard activeUserID != nil else { return }
        await refreshUnreadCount()
        refreshSequence &+= 1
    }

    func refreshUnreadCount() async {
        guard activeUserID != nil else { return }
        do {
            unreadCount = try await notificationService.fetchUnreadNotificationCount()
            await setApplicationBadge(unreadCount)
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    func deactivateCurrentInstallation() async {
        guard activeUserID != nil else { return }
        do {
            try await notificationService.deactivatePushDevice(installationID: Self.installationID)
        } catch {
            lastErrorMessage = error.localizedDescription
        }
        activeUserID = nil
        await stopRealtimeSubscription()
        unreadCount = 0
        await setApplicationBadge(0)
    }

    func handle(url: URL) {
        pendingRoute = AppDeepLinkRoute.parse(url) ?? .notificationCenter
    }

    func consumePendingRoute() {
        pendingRoute = nil
    }

    private func registerCurrentDeviceIfPossible() async {
        guard activeUserID != nil, let deviceToken else { return }
        let registration = PushDeviceRegistration(
            installationID: Self.installationID,
            deviceToken: deviceToken,
            environment: Self.apnsEnvironment,
            bundleID: Bundle.main.bundleIdentifier ?? "app.TECM",
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
            deviceModel: UIDevice.current.model
        )
        do {
            try await notificationService.registerPushDevice(registration)
            lastErrorMessage = nil
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    private func startRealtimeSubscription(for userID: UUID) async {
        guard realtimeUserID != userID else { return }
        await stopRealtimeSubscription()

        let channel = client.channel("notifications:\(userID.uuidString)")
        let observation = channel.onPostgresChange(
            AnyAction.self,
            schema: "public",
            table: "notifications",
            filter: "recipient_user_id=eq.\(userID.uuidString)"
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.refreshUnreadCount()
                self.refreshSequence &+= 1
            }
        }

        realtimeUserID = userID
        realtimeChannel = channel
        realtimeObservation = observation
        do {
            try await channel.subscribeWithError()
        } catch {
            lastErrorMessage = error.localizedDescription
            await stopRealtimeSubscription()
        }
    }

    private func stopRealtimeSubscription() async {
        realtimeObservation?.cancel()
        realtimeObservation = nil
        realtimeUserID = nil
        if let realtimeChannel {
            await client.removeChannel(realtimeChannel)
            self.realtimeChannel = nil
        }
    }

    private func refreshAuthorizationStatus() async {
        authorizationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    private func setApplicationBadge(_ count: Int) async {
        do {
            try await UNUserNotificationCenter.current().setBadgeCount(max(0, count))
        } catch {
            UIApplication.shared.applicationIconBadgeNumber = max(0, count)
        }
    }

    private static var installationID: String {
        if let existing = UserDefaults.standard.string(forKey: installationIDKey) {
            return existing
        }
        let identifier = UUID().uuidString.lowercased()
        UserDefaults.standard.set(identifier, forKey: installationIDKey)
        return identifier
    }

    private static var apnsEnvironment: String {
#if DEBUG
        return "sandbox"
#else
        return "production"
#endif
    }
}
