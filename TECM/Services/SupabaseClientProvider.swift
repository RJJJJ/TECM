import Foundation
import Supabase

enum SupabaseClientProvider {
    static let shared: SupabaseClient = {
        do {
            let config = try SupabaseConfig.load()
            return SupabaseClient(supabaseURL: config.url, supabaseKey: config.publishableKey)
        } catch {
            assertionFailure(error.localizedDescription)
            return SupabaseClient(
                supabaseURL: URL(string: "https://invalid.supabase.co")!,
                supabaseKey: "invalid-publishable-key"
            )
        }
    }()
}
