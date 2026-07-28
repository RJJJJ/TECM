import Foundation
import Supabase
import Combine

enum SupabaseClientProvider {
    private struct Context {
        let client: SupabaseClient
        let configuration: SupabaseConfig
        let authSessionPersistence: AuthSessionPersistence
    }

    private static let context: Context = {
        let configuration: SupabaseConfig
        do {
            configuration = try SupabaseConfig.load()
        } catch {
            #if DEBUG
            print("Supabase configuration unavailable; using the inert local fallback.")
            #endif
            configuration = SupabaseConfig(
                url: URL(string: "https://invalid.supabase.co")!,
                publishableKey: "invalid-publishable-key"
            )
        }

        let projectReference = configuration.url.host?.split(separator: ".").first ?? "invalid"
        let authStorageKey = "sb-\(projectReference)-auth-token"
        let authSessionPersistence = AuthSessionPersistence(
            sessionStorage: AuthClient.Configuration.defaultLocalStorage,
            logoutSafetyFenceStorage: UserDefaultsLogoutSafetyFenceStorage(
                defaults: .standard
            ),
            storageKey: authStorageKey,
            projectKey: String(projectReference)
        )
        let options = SupabaseClientOptions(
            auth: .init(storage: authSessionPersistence, storageKey: authStorageKey)
        )
        let client = SupabaseClient(
            supabaseURL: configuration.url,
            supabaseKey: configuration.publishableKey,
            options: options
        )

        return Context(
            client: client,
            configuration: configuration,
            authSessionPersistence: authSessionPersistence
        )
    }()

    static var shared: SupabaseClient { context.client }
    static var configuration: SupabaseConfig { context.configuration }
    static var authSessionPersistence: AuthSessionPersistence {
        context.authSessionPersistence
    }
}
