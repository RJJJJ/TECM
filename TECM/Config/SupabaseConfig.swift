import Foundation

struct SupabaseConfig {
    let url: URL
    let publishableKey: String

    enum ConfigError: LocalizedError {
        case missingValue(String)
        case invalidURL(String)

        var errorDescription: String? {
            switch self {
            case let .missingValue(key):
                return "缺少 Supabase 設定：\(key)。請確認 Secrets.xcconfig 與 Build Settings。"
            case let .invalidURL(raw):
                return "SUPABASE_URL 格式錯誤：\(raw)"
            }
        }
    }

    static func load(from bundle: Bundle = .main) throws -> SupabaseConfig {
        guard let urlString = bundle.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
              !urlString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ConfigError.missingValue("SUPABASE_URL")
        }

        guard let publishableKey = bundle.object(forInfoDictionaryKey: "SUPABASE_PUBLISHABLE_KEY") as? String,
              !publishableKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ConfigError.missingValue("SUPABASE_PUBLISHABLE_KEY")
        }

        guard let url = URL(string: urlString) else {
            throw ConfigError.invalidURL(urlString)
        }

        return SupabaseConfig(url: url, publishableKey: publishableKey)
    }
}
