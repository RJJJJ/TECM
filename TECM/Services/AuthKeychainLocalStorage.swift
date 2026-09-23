import Auth
import Foundation
import Security

struct AuthKeychainReadResult: Sendable {
    let status: OSStatus
    let data: Data?
}

protocol AuthKeychainOperating: Sendable {
    func add(
        service: String?,
        accessGroup: String?,
        account: String,
        value: Data
    ) -> OSStatus

    func update(
        service: String?,
        accessGroup: String?,
        account: String,
        value: Data
    ) -> OSStatus

    func retrieve(
        service: String?,
        accessGroup: String?,
        account: String
    ) -> AuthKeychainReadResult

    func remove(
        service: String?,
        accessGroup: String?,
        account: String
    ) -> OSStatus
}

struct SystemAuthKeychainOperations: AuthKeychainOperating {
    func add(
        service: String?,
        accessGroup: String?,
        account: String,
        value: Data
    ) -> OSStatus {
        var query = baseQuery(
            service: service,
            accessGroup: accessGroup,
            account: account
        )
        query[kSecValueData as String] = value
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(query as CFDictionary, nil)
    }

    func update(
        service: String?,
        accessGroup: String?,
        account: String,
        value: Data
    ) -> OSStatus {
        let query = baseQuery(
            service: service,
            accessGroup: accessGroup,
            account: account
        )
        let attributes = [kSecValueData as String: value]
        return SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    }

    func retrieve(
        service: String?,
        accessGroup: String?,
        account: String
    ) -> AuthKeychainReadResult {
        var query = baseQuery(
            service: service,
            accessGroup: accessGroup,
            account: account
        )
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else {
            return AuthKeychainReadResult(status: status, data: nil)
        }
        guard let data = result as? Data else {
            return AuthKeychainReadResult(status: errSecDecode, data: nil)
        }
        return AuthKeychainReadResult(status: status, data: data)
    }

    func remove(
        service: String?,
        accessGroup: String?,
        account: String
    ) -> OSStatus {
        let query = baseQuery(
            service: service,
            accessGroup: accessGroup,
            account: account
        )
        return SecItemDelete(query as CFDictionary)
    }

    private func baseQuery(
        service: String?,
        accessGroup: String?,
        account: String
    ) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
        ]
        if let service {
            query[kSecAttrService as String] = service
        }
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }
}

struct AuthKeychainStorageError: Error, Equatable, Sendable {
    enum Operation: String, Hashable, Sendable {
        case add
        case update
        case retrieve
        case remove
    }

    let operation: Operation
    let status: OSStatus
}

struct AuthKeychainLocalStorage: AuthLocalStorage, Sendable {
    static let defaultService = "supabase.gotrue.swift"

    private let service: String?
    private let accessGroup: String?
    private let operations: any AuthKeychainOperating

    init(
        service: String? = AuthKeychainLocalStorage.defaultService,
        accessGroup: String? = nil,
        operations: any AuthKeychainOperating = SystemAuthKeychainOperations()
    ) {
        self.service = service
        self.accessGroup = accessGroup
        self.operations = operations
    }

    func store(key: String, value: Data) throws {
        let addStatus = operations.add(
            service: service,
            accessGroup: accessGroup,
            account: key,
            value: value
        )
        if addStatus == errSecDuplicateItem {
            let updateStatus = operations.update(
                service: service,
                accessGroup: accessGroup,
                account: key,
                value: value
            )
            guard updateStatus == errSecSuccess else {
                throw failure(operation: .update, status: updateStatus)
            }
            return
        }
        guard addStatus == errSecSuccess else {
            throw failure(operation: .add, status: addStatus)
        }
    }

    func retrieve(key: String) throws -> Data? {
        let result = operations.retrieve(
            service: service,
            accessGroup: accessGroup,
            account: key
        )
        if result.status == errSecItemNotFound {
            return nil
        }
        guard result.status == errSecSuccess else {
            throw failure(operation: .retrieve, status: result.status)
        }
        return result.data
    }

    func remove(key: String) throws {
        let status = operations.remove(
            service: service,
            accessGroup: accessGroup,
            account: key
        )
        if status == errSecItemNotFound {
            return
        }
        guard status == errSecSuccess else {
            throw failure(operation: .remove, status: status)
        }
    }

    private func failure(
        operation: AuthKeychainStorageError.Operation,
        status: OSStatus
    ) -> AuthKeychainStorageError {
        #if DEBUG
        print("Auth keychain stage=\(operation.rawValue) osstatus=\(status)")
        #endif
        return AuthKeychainStorageError(operation: operation, status: status)
    }
}
