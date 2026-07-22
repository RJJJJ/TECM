import Foundation
import Supabase
import Combine

enum SupabaseClientProvider {
    static let shared: SupabaseClient = {
        do {
            let config = try SupabaseConfig.load()
            return SupabaseClient(supabaseURL: config.url, supabaseKey: config.publishableKey)
        } catch {
            #if DEBUG
            print("Supabase configuration unavailable; using the inert local fallback.")
            #endif
            return SupabaseClient(
                supabaseURL: URL(string: "https://invalid.supabase.co")!,
                supabaseKey: "invalid-publishable-key"
            )
        }
    }()
}
