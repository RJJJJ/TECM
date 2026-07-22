import Foundation
import XCTest
@testable import TECM

@MainActor
final class ParentLeaveOperationTests: XCTestCase {
    func testInitialSubmissionCreatesOneStableOperation() async {
        let service = SequencedParentOperationsService(outcomes: [.success(UUID())])
        let viewModel = ParentOperationsViewModel(service: service)
        let studentID = UUID()
        let sessionID = UUID()

        let submitted = await viewModel.submitLeave(
            studentID: studentID,
            sessionID: sessionID,
            reason: "  Medical appointment  "
        )

        XCTAssertTrue(submitted)
        XCTAssertEqual(service.operations.count, 1)
        XCTAssertEqual(service.operations.first?.payload.studentID, studentID)
        XCTAssertEqual(service.operations.first?.payload.sessionID, sessionID)
        XCTAssertEqual(service.operations.first?.payload.reason, "Medical appointment")
        XCTAssertTrue(service.operations.first?.idempotencyKey.hasPrefix("ios:") ?? false)
    }

    func testRetryAfterTimeoutReusesSameIdempotencyKey() async {
        await assertRetryReusesSameKey(firstError: .timeout)
    }

    func testRetryAfterUnknownServerOutcomeReusesSameIdempotencyKey() async {
        await assertRetryReusesSameKey(firstError: .unknownOutcome)
    }

    func testDoubleTapCannotCreateParallelRequests() async {
        let started = expectation(description: "submission started")
        let service = BlockingParentOperationsService { started.fulfill() }
        let viewModel = ParentOperationsViewModel(service: service)
        let studentID = UUID()
        let sessionID = UUID()

        let firstSubmission = Task {
            await viewModel.submitLeave(
                studentID: studentID,
                sessionID: sessionID,
                reason: "Medical appointment"
            )
        }
        await fulfillment(of: [started], timeout: 1)

        let secondSubmission = await viewModel.submitLeave(
            studentID: studentID,
            sessionID: sessionID,
            reason: "Medical appointment"
        )
        service.finishSubmission()
        let firstResult = await firstSubmission.value

        XCTAssertFalse(secondSubmission)
        XCTAssertTrue(firstResult)
        XCTAssertEqual(service.operations.count, 1)
    }

    func testSuccessfulOperationClosesLifecycleAndPreventsAccidentalResubmission() async {
        let service = SequencedParentOperationsService(outcomes: [.success(UUID())])
        let viewModel = ParentOperationsViewModel(service: service)
        let studentID = UUID()
        let sessionID = UUID()

        let firstResult = await viewModel.submitLeave(
            studentID: studentID,
            sessionID: sessionID,
            reason: "Medical appointment"
        )
        let repeatedResult = await viewModel.submitLeave(
            studentID: studentID,
            sessionID: sessionID,
            reason: "Medical appointment"
        )

        XCTAssertTrue(firstResult)
        XCTAssertTrue(repeatedResult)
        XCTAssertEqual(service.operations.count, 1)
        XCTAssertEqual(viewModel.confirmationMessage, "This leave request was already submitted.")
    }

    func testNewLogicalOperationGetsNewKey() async {
        let service = SequencedParentOperationsService(outcomes: [.success(UUID()), .success(UUID())])
        let viewModel = ParentOperationsViewModel(service: service)
        let studentID = UUID()

        let firstResult = await viewModel.submitLeave(
            studentID: studentID,
            sessionID: UUID(),
            reason: "Medical appointment"
        )
        let secondResult = await viewModel.submitLeave(
            studentID: studentID,
            sessionID: UUID(),
            reason: "Medical appointment"
        )

        XCTAssertTrue(firstResult)
        XCTAssertTrue(secondResult)
        XCTAssertEqual(service.operations.count, 2)
        XCTAssertNotEqual(service.operations[0].idempotencyKey, service.operations[1].idempotencyKey)
    }

    func testChangedPayloadAfterFailureDoesNotReuseIncompatibleKey() async {
        let service = SequencedParentOperationsService(
            outcomes: [.failure(.timeout), .success(UUID())]
        )
        let viewModel = ParentOperationsViewModel(service: service)
        let studentID = UUID()
        let sessionID = UUID()

        let firstResult = await viewModel.submitLeave(
            studentID: studentID,
            sessionID: sessionID,
            reason: "Medical appointment"
        )
        let secondResult = await viewModel.submitLeave(
            studentID: studentID,
            sessionID: sessionID,
            reason: "Family appointment"
        )

        XCTAssertFalse(firstResult)
        XCTAssertTrue(secondResult)
        XCTAssertEqual(service.operations.count, 2)
        XCTAssertNotEqual(service.operations[0].idempotencyKey, service.operations[1].idempotencyKey)
        XCTAssertNotEqual(service.operations[0].payload, service.operations[1].payload)
    }

    private func assertRetryReusesSameKey(firstError: LeaveTestError) async {
        let requestID = UUID()
        let service = SequencedParentOperationsService(
            outcomes: [.failure(firstError), .success(requestID)]
        )
        let viewModel = ParentOperationsViewModel(service: service)
        let studentID = UUID()
        let sessionID = UUID()

        let firstResult = await viewModel.submitLeave(
            studentID: studentID,
            sessionID: sessionID,
            reason: "Medical appointment"
        )
        let retryResult = await viewModel.submitLeave(
            studentID: studentID,
            sessionID: sessionID,
            reason: "Medical appointment"
        )

        XCTAssertFalse(firstResult)
        XCTAssertTrue(retryResult)
        XCTAssertEqual(service.operations.count, 2)
        XCTAssertEqual(service.operations[0].idempotencyKey, service.operations[1].idempotencyKey)
        XCTAssertEqual(service.operations[0].payload, service.operations[1].payload)
    }
}

@MainActor
private final class SequencedParentOperationsService: ParentOperationsServicing {
    private var outcomes: [Result<UUID, LeaveTestError>]
    private(set) var operations: [ParentLeaveOperation] = []

    init(outcomes: [Result<UUID, LeaveTestError>]) {
        self.outcomes = outcomes
    }

    func fetchSnapshot() async throws -> ParentOperationsSnapshot { .emptyForTests }

    func submitLeaveRequest(_ operation: ParentLeaveOperation) async throws -> UUID {
        operations.append(operation)
        return try outcomes.removeFirst().get()
    }
}

@MainActor
private final class BlockingParentOperationsService: ParentOperationsServicing {
    private let onSubmit: () -> Void
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var operations: [ParentLeaveOperation] = []

    init(onSubmit: @escaping () -> Void) {
        self.onSubmit = onSubmit
    }

    func fetchSnapshot() async throws -> ParentOperationsSnapshot { .emptyForTests }

    func submitLeaveRequest(_ operation: ParentLeaveOperation) async throws -> UUID {
        operations.append(operation)
        onSubmit()
        await withCheckedContinuation { continuation = $0 }
        return UUID()
    }

    func finishSubmission() {
        continuation?.resume()
        continuation = nil
    }
}

private enum LeaveTestError: Error {
    case timeout
    case unknownOutcome
}

private extension ParentOperationsSnapshot {
    static let emptyForTests = ParentOperationsSnapshot(
        classes: [],
        sessionsByStudent: [:],
        leaveRequests: [],
        makeupEntitlements: [],
        credits: [],
        charges: [],
        payments: [],
        receipts: []
    )
}
