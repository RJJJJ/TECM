import Foundation
import XCTest
@testable import TECM

final class SupabaseConfigTests: XCTestCase {
    func testRejectsHostlessBuildSettingPlaceholders() {
        for value in ["$(SUPABASE_URL)", "https:/YOUR_PROJECT_ID.supabase.co"] {
            XCTAssertThrowsError(
                try SupabaseConfig.make(urlString: value, publishableKey: "placeholder-key")
            ) { error in
                guard let configError = error as? SupabaseConfig.ConfigError else {
                    return XCTFail("Unexpected error: \(error)")
                }
                guard case .invalidURL = configError else {
                    return XCTFail("Expected invalidURL, received \(configError)")
                }
            }
        }
    }

    func testAcceptsNetworkURLsWithHosts() throws {
        let remote = try SupabaseConfig.make(
            urlString: "https://project.supabase.co",
            publishableKey: "placeholder-key"
        )
        let local = try SupabaseConfig.make(
            urlString: "http://127.0.0.1:54321",
            publishableKey: "placeholder-key"
        )

        XCTAssertEqual(remote.url.host, "project.supabase.co")
        XCTAssertEqual(local.url.port, 54321)
    }
}
