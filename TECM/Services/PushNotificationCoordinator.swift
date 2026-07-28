import Combine
import Foundation
import Supabase
import UIKit
import UserNotifications

enum PushNotificationCleanupError: LocalizedError, Equatable {
    case remoteDeactivationFailed

    var errorDescription: String? {
        "Push notification cleanup could not be completed."
    }
}

private enum RemoteDeactivationResult: Sendable {
    case succeeded
    case failed
    case timedOut
}

private actor RemoteDeactivationRace {
    private var result: RemoteDeactivationResult?
    private var continuation: CheckedContinuation<RemoteDeactivationResult, Never>?

    func waitForResult() async -> RemoteDeactivationResult {
        if let result {
            return result
        }

        return await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func resolve(_ result: RemoteDeactivationResult) {
        guard self.result == nil else { return }
        self.result = result
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(returning: result)
    }
}

@MainActor
final class PushNotificationCoordinator: NSObject, ObservableObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published private(set) var unreadCount = 0
    @Published private(set) var refreshSequence = 0
    @Published private(set) var pendingRoute: AppDeepLinkRoute?
    @Published private(set) var lastErrorMessage: String?

    private let notificationService: NotificationServicing
    private let client: SupabaseClient
    private let remoteDeactivationTimeout: Duration
    private let waitForRemoteDeactivationDeadline: @MainActor @Sendable (Duration) async -> Void
    private let realtimeCleanupObserver: (() -> Void)?
    private var activeUserID: UUID?
    private var deviceToken: String?
    private var realtimeUserID: UUID?
    private var realtimeChannel: RealtimeChannelV2?
    private var realtimeObservation: RealtimeSubscription?
    private var stateGeneration: UInt64 = 0

    private static let installationIDKey = "tecm.push.installation-id"

    override convenience init() {
        let client = SupabaseClientProvider.shared
        self.init(notificationService: NotificationService(client: client), client: client)
    }

    init(
        notificationService: NotificationServicing,
        client: SupabaseClient,
        remoteDeactivationTimeout: Duration = .seconds(5),
        waitForRemoteDeactivationDeadline: @escaping @MainActor @Sendable (Duration) async -> Void = { duration in
            try? await ContinuousClock().sleep(for: duration)
        },
        realtimeCleanupObserver: (() -> Void)? = nil
    ) {
        self.notificationService = notificationService
        self.client = client
        self.remoteDeactivationTimeout = remoteDeactivationTimeout
        self.waitForRemoteDeactivationDeadline = waitForRemoteDeactivationDeadline
        self.realtimeCleanupObserver = realtimeCleanupObserver
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
        let generation = beginStateOperation()
        lastErrorMessage = nil

        guard let userID, hasParentRole else {
            activeUserID = nil
            await stopRealtimeSubscription()
            guard isCurrent(generation) else { return }
            unreadCount = 0
            await setApplicationBadge(0)
            return
        }

        activeUserID = userID
        await startRealtimeSubscription(for: userID, generation: generation)
        guard isCurrent(generation), activeUserID == userID else { return }
        await refreshAuthorizationStatus()
        guard isCurrent(generation), activeUserID == userID else { return }
        if authorizationStatus == .authorized || authorizationStatus == .provisional || authorizationStatus == .ephemeral {
            UIApplication.shared.registerForRemoteNotifications()
        }
        await registerCurrentDeviceIfPossible()
        guard isCurrent(generation), activeUserID == userID else { return }
        await refreshUnreadCount()
    }

    @discardableResult
    func requestAuthorizationAfterUserAction() async -> Bool {
        guard let userID = activeUserID else { return false }
        let generation = stateGeneration
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            guard isCurrent(generation), activeUserID == userID else { return false }
            await refreshAuthorizationStatus()
            guard isCurrent(generation), activeUserID == userID else { return false }
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
        let generation = stateGeneration
        let userID = activeUserID
        await refreshAuthorizationStatus()
        guard isCurrent(generation), activeUserID == userID, userID != nil else { return }
        await refreshUnreadCount()
        guard isCurrent(generation), activeUserID == userID else { return }
        refreshSequence &+= 1
    }

    func refreshUnreadCount() async {
        guard let userID = activeUserID else { return }
        let generation = stateGeneration
        do {
            let count = try await notificationService.fetchUnreadNotificationCount()
            guard isCurrent(generation), activeUserID == userID else { return }
            unreadCount = count
            await setApplicationBadge(count)
            if !isCurrent(generation), activeUserID != nil {
                await setApplicationBadge(unreadCount)
            }
        } catch {
            guard isCurrent(generation), activeUserID == userID else { return }
            lastErrorMessage = error.localizedDescription
        }
    }

    func deactivateCurrentInstallation(accessToken: String? = nil) async throws {
        let generation = stateGeneration &+ 1
        let context = accessToken.map {
            SignOutCleanupContext(accessToken: $0, userID: nil, sessionID: nil)
        }
        let preparation = await prepareSignOutCleanup(
            context: context,
            allowMissingContextForDirectCall: true
        )
        guard let operation = preparation.remoteOperation else {
            if isCurrent(generation) {
                lastErrorMessage = PushNotificationCleanupError.remoteDeactivationFailed.localizedDescription
            }
            throw PushNotificationCleanupError.remoteDeactivationFailed
        }

        do {
            try await operation.run()
            if isCurrent(generation) {
                lastErrorMessage = nil
            }
        } catch {
            if isCurrent(generation) {
                lastErrorMessage = PushNotificationCleanupError.remoteDeactivationFailed.localizedDescription
            }
            throw PushNotificationCleanupError.remoteDeactivationFailed
        }
    }

    func prepareSignOutCleanup(
        context: SignOutCleanupContext?
    ) async -> AppSignOutCleanupPreparation {
        await prepareSignOutCleanup(
            context: context,
            allowMissingContextForDirectCall: false
        )
    }

    private func prepareSignOutCleanup(
        context: SignOutCleanupContext?,
        allowMissingContextForDirectCall: Bool
    ) async -> AppSignOutCleanupPreparation {
        let generation = beginStateOperation()
        let installationID = Self.installationID
        let notificationService = notificationService
        let timeout = remoteDeactivationTimeout
        let waitForDeadline = waitForRemoteDeactivationDeadline

        await clearLocalNotificationState(generation: generation)

        guard context != nil || allowMissingContextForDirectCall else {
            return AppSignOutCleanupPreparation(remoteOperation: nil)
        }
        let capturedContext = context
        let remoteDeactivation = RemoteAuthSignOutOperation { [weak self] in
            try await notificationService.deactivatePushDevice(
                installationID: installationID,
                accessToken: capturedContext?.accessToken
            )
            // MUTATION M9: let old remote work regain global coordinator authority.
            guard let self else { return }
            let lateGeneration = await self.beginStateOperation()
            await self.clearLocalNotificationState(generation: lateGeneration)
        }
        return AppSignOutCleanupPreparation(
            remoteOperation: RemoteAuthSignOutOperation {
                try await Self.runRemoteDeactivationWithTimeout(
                    remoteDeactivation,
                    timeout: timeout,
                    waitForDeadline: waitForDeadline
                )
            }
        )
    }

    private func clearLocalNotificationState(generation: UInt64) async {
        UIApplication.shared.unregisterForRemoteNotifications()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        activeUserID = nil
        deviceToken = nil
        pendingRoute = nil
        stopRealtimeSubscriptionForLogout()
        unreadCount = 0
        await setApplicationBadge(0)
        if !isCurrent(generation), activeUserID != nil {
            await setApplicationBadge(unreadCount)
        }
    }

    private func stopRealtimeSubscriptionForLogout() {
        realtimeObservation?.cancel()
        realtimeObservation = nil
        realtimeUserID = nil
        let channel = realtimeChannel
        realtimeChannel = nil

        if let channel {
            let client = client
            Task {
                await client.removeChannel(channel)
            }
        }
        realtimeCleanupObserver?()
    }

    private static func runRemoteDeactivationWithTimeout(
        _ operation: RemoteAuthSignOutOperation,
        timeout: Duration,
        waitForDeadline: @escaping @MainActor @Sendable (Duration) async -> Void
    ) async throws {
        guard !Task.isCancelled else {
            throw PushNotificationCleanupError.remoteDeactivationFailed
        }

        let race = RemoteDeactivationRace()

        let remoteTask = Task { @MainActor [weak race] in
            guard !Task.isCancelled else { return }
            do {
                try await operation.run()
                await race?.resolve(.succeeded)
            } catch {
                await race?.resolve(.failed)
            }
        }
        let deadlineTask = Task { @MainActor [weak race] in
            await waitForDeadline(timeout)
            await race?.resolve(.timedOut)
        }

        let result = await withTaskCancellationHandler {
            await race.waitForResult()
        } onCancel: {
            Task {
                await race.resolve(.failed)
            }
        }
        remoteTask.cancel()
        deadlineTask.cancel()

        guard case .succeeded = result else {
            throw PushNotificationCleanupError.remoteDeactivationFailed
        }
    }

    func handle(url: URL) {
        pendingRoute = AppDeepLinkRoute.parse(url) ?? .notificationCenter
    }

    func consumePendingRoute() {
        pendingRoute = nil
    }

    private func registerCurrentDeviceIfPossible() async {
        guard let userID = activeUserID, let deviceToken else { return }
        let generation = stateGeneration
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
            guard isCurrent(generation), activeUserID == userID else { return }
            lastErrorMessage = nil
        } catch {
            guard isCurrent(generation), activeUserID == userID else { return }
            lastErrorMessage = error.localizedDescription
        }
    }

    private func startRealtimeSubscription(for userID: UUID, generation: UInt64) async {
        guard realtimeUserID != userID else { return }
        await stopRealtimeSubscription()
        guard isCurrent(generation), activeUserID == userID else { return }

        let channel = client.channel("notifications:\(userID.uuidString)")
        let observation = channel.onPostgresChange(
            AnyAction.self,
            schema: "public",
            table: "notifications",
            filter: "recipient_user_id=eq.\(userID.uuidString)"
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self,
                      self.isCurrent(generation),
                      self.activeUserID == userID else { return }
                await self.refreshUnreadCount()
                guard self.isCurrent(generation), self.activeUserID == userID else { return }
                self.refreshSequence &+= 1
            }
        }

        realtimeUserID = userID
        realtimeChannel = channel
        realtimeObservation = observation
        do {
            try await channel.subscribeWithError()
            guard isCurrent(generation), activeUserID == userID else {
                observation.cancel()
                await client.removeChannel(channel)
                return
            }
        } catch {
            guard isCurrent(generation), activeUserID == userID else { return }
            lastErrorMessage = error.localizedDescription
            await stopRealtimeSubscription()
        }
    }

    private func stopRealtimeSubscription() async {
        realtimeObservation?.cancel()
        realtimeObservation = nil
        realtimeUserID = nil
        let channel = realtimeChannel
        realtimeChannel = nil
        if let channel {
            await client.removeChannel(channel)
        }
    }

    private func beginStateOperation() -> UInt64 {
        stateGeneration &+= 1
        return stateGeneration
    }

    private func isCurrent(_ generation: UInt64) -> Bool {
        stateGeneration == generation
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
