import Foundation
import Supabase

struct ParentLeaveRequestItem: Decodable, Identifiable {
    let id: UUID
    let studentID: UUID
    let lessonSessionID: UUID?
    let reason: String
    let status: String
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, reason, status
        case studentID = "student_id"
        case lessonSessionID = "lesson_session_id"
        case createdAt = "created_at"
    }
}

struct ParentMakeupEntitlementItem: Decodable, Identifiable {
    let id: UUID
    let studentID: UUID
    let unitsGranted: Int
    let unitsRemaining: Int
    let status: String
    let expiresAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, status
        case studentID = "student_id"
        case unitsGranted = "units_granted"
        case unitsRemaining = "units_remaining"
        case expiresAt = "expires_at"
    }
}

struct ParentCreditLedgerItem: Decodable, Identifiable {
    let id: UUID
    let studentID: UUID
    let deltaUnits: Int
    let entryType: String
    let note: String?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, note
        case studentID = "student_id"
        case deltaUnits = "delta_units"
        case entryType = "entry_type"
        case createdAt = "created_at"
    }
}

struct ParentChargeItem: Decodable, Identifiable {
    let id: UUID
    let description: String
    let amountMinor: Int64
    let currencyCode: String
    let status: String
    let dueOn: String?

    enum CodingKeys: String, CodingKey {
        case id, description, status
        case amountMinor = "amount_minor"
        case currencyCode = "currency_code"
        case dueOn = "due_on"
    }
}

struct ParentPaymentItem: Decodable, Identifiable {
    let id: UUID
    let amountMinor: Int64
    let currencyCode: String
    let method: String
    let status: String
    let receivedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, method, status
        case amountMinor = "amount_minor"
        case currencyCode = "currency_code"
        case receivedAt = "received_at"
    }
}

struct ParentReceiptItem: Decodable, Identifiable {
    let id: UUID
    let receiptNumber: String
    let amountMinor: Int64
    let currencyCode: String
    let issuedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case receiptNumber = "receipt_number"
        case amountMinor = "amount_minor"
        case currencyCode = "currency_code"
        case issuedAt = "issued_at"
    }
}

struct ParentLessonSessionItem: Decodable, Identifiable {
    let sessionID: UUID
    let cohortID: UUID
    let cohortName: String
    let lessonTitle: String
    let startsAt: Date
    let endsAt: Date
    let status: String

    var id: UUID { sessionID }

    enum CodingKeys: String, CodingKey {
        case status
        case sessionID = "session_id"
        case cohortID = "cohort_id"
        case cohortName = "cohort_name"
        case lessonTitle = "lesson_title"
        case startsAt = "starts_at"
        case endsAt = "ends_at"
    }
}

struct ParentOperationsSnapshot {
    let classes: [ParentExamAttendanceSummary]
    let sessionsByStudent: [UUID: [ParentLessonSessionItem]]
    let leaveRequests: [ParentLeaveRequestItem]
    let makeupEntitlements: [ParentMakeupEntitlementItem]
    let credits: [ParentCreditLedgerItem]
    let charges: [ParentChargeItem]
    let payments: [ParentPaymentItem]
    let receipts: [ParentReceiptItem]
}

struct ParentLeaveOperation: Equatable {
    struct Payload: Hashable {
        let studentID: UUID
        let sessionID: UUID
        let reason: String
    }

    let payload: Payload
    let idempotencyKey: String

    init(payload: Payload, operationID: UUID = UUID()) {
        self.payload = payload
        idempotencyKey = "ios:\(operationID.uuidString.lowercased())"
    }
}

protocol ParentOperationsServicing {
    func fetchSnapshot() async throws -> ParentOperationsSnapshot
    func submitLeaveRequest(_ operation: ParentLeaveOperation) async throws -> UUID
}

struct ParentOperationsService: ParentOperationsServicing {
    private let clientResolver: SupabaseClientResolver
    private var client: SupabaseClient { clientResolver.client }
    private let examCohortService: ExamCohortServicing

    init(
        client: SupabaseClient? = nil,
        examCohortService: ExamCohortServicing = ExamCohortService()
    ) {
        clientResolver = SupabaseClientResolver(client: client)
        self.examCohortService = examCohortService
    }

    func fetchSnapshot() async throws -> ParentOperationsSnapshot {
        let classes = try await examCohortService.fetchParentAttendanceSummary()
        var sessionsByStudent: [UUID: [ParentLessonSessionItem]] = [:]
        for studentID in Set(classes.map(\.studentID)) {
            struct Parameters: Encodable {
                let studentID: UUID

                enum CodingKeys: String, CodingKey {
                    case studentID = "p_student_id"
                }
            }
            let sessions: [ParentLessonSessionItem] = try await client.rpc(
                "get_parent_lesson_sessions",
                params: Parameters(studentID: studentID)
            ).execute().value
            sessionsByStudent[studentID] = sessions
        }
        let leaveRequests: [ParentLeaveRequestItem] = try await client
            .from("leave_requests")
            .select("id,student_id,lesson_session_id,reason,status,created_at")
            .order("created_at", ascending: false)
            .execute().value
        let makeupEntitlements: [ParentMakeupEntitlementItem] = try await client
            .from("makeup_entitlements")
            .select("id,student_id,units_granted,units_remaining,status,expires_at")
            .order("created_at", ascending: false)
            .execute().value
        let credits: [ParentCreditLedgerItem] = try await client
            .from("credit_ledger")
            .select("id,student_id,delta_units,entry_type,note,created_at")
            .order("created_at", ascending: false)
            .execute().value
        let charges: [ParentChargeItem] = try await client
            .from("charges")
            .select("id,description,amount_minor,currency_code,status,due_on")
            .order("created_at", ascending: false)
            .execute().value
        let payments: [ParentPaymentItem] = try await client
            .from("payments")
            .select("id,amount_minor,currency_code,method,status,received_at")
            .order("received_at", ascending: false)
            .execute().value
        let receipts: [ParentReceiptItem] = try await client
            .from("receipts")
            .select("id,receipt_number,amount_minor,currency_code,issued_at")
            .order("issued_at", ascending: false)
            .execute().value

        return ParentOperationsSnapshot(
            classes: classes,
            sessionsByStudent: sessionsByStudent,
            leaveRequests: leaveRequests,
            makeupEntitlements: makeupEntitlements,
            credits: credits,
            charges: charges,
            payments: payments,
            receipts: receipts
        )
    }

    func submitLeaveRequest(_ operation: ParentLeaveOperation) async throws -> UUID {
        struct Parameters: Encodable {
            let studentID: UUID
            let sessionID: UUID
            let reason: String
            let idempotencyKey: String

            enum CodingKeys: String, CodingKey {
                case studentID = "p_student_id"
                case sessionID = "p_session_id"
                case reason = "p_reason"
                case idempotencyKey = "p_idempotency_key"
            }
        }

        return try await client.rpc(
            "submit_parent_leave_request",
            params: Parameters(
                studentID: operation.payload.studentID,
                sessionID: operation.payload.sessionID,
                reason: operation.payload.reason,
                idempotencyKey: operation.idempotencyKey
            )
        ).execute().value
    }
}
