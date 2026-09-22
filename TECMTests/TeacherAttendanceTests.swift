import Foundation
import XCTest
@testable import TECM

@MainActor
final class TeacherAttendanceTests: XCTestCase {
    func testRosterDTOPreservesNullStatusAndRevisionAsNewEditableRow() throws {
        let studentID = UUID()
        let json = """
        {
          "student_id": "\(studentID.uuidString)",
          "display_name": "New student",
          "school_name": null,
          "attendance_status": null,
          "attendance_revision": null
        }
        """

        let dto = try JSONDecoder().decode(
            TeacherSessionStudentDTO.self,
            from: Data(json.utf8)
        )
        let model = dto.toModel()

        XCTAssertNil(dto.attendanceRevision)
        XCTAssertNil(model.attendanceStatusRawValue)
        XCTAssertEqual(model.status, .present)
        XCTAssertTrue(model.isEditable)
    }

    func testUnknownOrIncompleteServerStatusFailsClosed() throws {
        let unknownStatusID = UUID()
        let incompleteStatusID = UUID()
        let json = """
        [
          {
            "student_id": "\(unknownStatusID.uuidString)",
            "display_name": "Unknown status",
            "school_name": null,
            "attendance_status": "late",
            "attendance_revision": 3
          },
          {
            "student_id": "\(incompleteStatusID.uuidString)",
            "display_name": "Incomplete status",
            "school_name": null,
            "attendance_status": "present",
            "attendance_revision": null
          }
        ]
        """

        let models = try JSONDecoder()
            .decode([TeacherSessionStudentDTO].self, from: Data(json.utf8))
            .map { $0.toModel() }

        XCTAssertEqual(models[0].status, .unsupported("late"))
        XCTAssertFalse(models[0].isEditable)
        XCTAssertFalse(models[1].isEditable)
    }

    func testSubmitParamsEncodeEveryFieldAndExplicitNullRevision() throws {
        let sessionID = UUID()
        let studentID = UUID()
        let request = AttendanceSubmissionRequest(
            sessionID: sessionID,
            studentID: studentID,
            status: .absent,
            expectedRevision: nil,
            reason: "家長臨時請假",
            requestID: "ios:test-request"
        )

        let data = try JSONEncoder().encode(SubmitTeacherAttendanceRPCParams(request: request))
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        XCTAssertEqual(body["target_session_id"] as? String, sessionID.uuidString)
        XCTAssertEqual(body["target_student_id"] as? String, studentID.uuidString)
        XCTAssertEqual(body["target_status"] as? String, "absent")
        XCTAssertTrue(body["target_expected_revision"] is NSNull)
        XCTAssertEqual(body["target_reason"] as? String, "家長臨時請假")
        XCTAssertEqual(body["target_request_id"] as? String, "ios:test-request")
    }

    func testSubmissionResultDTODecodesOptionalReplayFlag() throws {
        let json = """
        { "changed": false, "revision": 7, "idempotent_replay": true }
        """

        let dto = try JSONDecoder().decode(
            TeacherAttendanceSubmissionResultDTO.self,
            from: Data(json.utf8)
        )

        XCTAssertEqual(dto.toModel(), AttendanceSubmissionResult(
            changed: false,
            revision: 7,
            idempotentReplay: true
        ))
    }

    func testRPCFailureClassificationUsesSafeOperatorMessages() {
        let retryable = AttendanceServiceError.from(
            NSError(
                domain: "rpc",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "attendance update is already in progress"]
            )
        )
        let denied = AttendanceServiceError.from(
            NSError(
                domain: "rpc",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "permission denied for assigned teacher"]
            )
        )
        let unknown = AttendanceServiceError.from(
            NSError(
                domain: "rpc",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "internal SQL detail with secret-id"]
            )
        )

        XCTAssertEqual(retryable, .retryable)
        XCTAssertEqual(denied, .authorizationDenied)
        XCTAssertEqual(
            AttendanceServiceError.from(
                NSError(
                    domain: "rpc",
                    code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "student is not active in this session cohort"]
                )
            ),
            .authorizationDenied
        )
        XCTAssertEqual(unknown, .generic)
        XCTAssertEqual(AttendanceServiceError.from(URLError(.cancelled)), .retryable)
        XCTAssertEqual(AttendanceServiceError.from(CancellationError()), .retryable)
        XCTAssertFalse(unknown.localizedDescription.contains("secret-id"))
        XCTAssertFalse(unknown.localizedDescription.contains("SQL"))
    }

    func testInitialNullRevisionSubmitsRowWithReasonAndAppliesRevision() async {
        let sessionID = UUID()
        let studentID = UUID()
        let service = MockAttendanceService(
            rosters: [[TeacherSessionStudent(
                id: studentID,
                displayName: "New student",
                schoolName: nil,
                status: .present
            )]],
            outcomes: [.success(AttendanceSubmissionResult(
                changed: true,
                revision: 1,
                idempotentReplay: nil
            ))]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        viewModel.correctionReason = "  家長臨時請假  "
        await viewModel.submit(sessionID: sessionID, sessionEnded: true)

        XCTAssertEqual(service.requests.count, 1)
        XCTAssertEqual(service.requests[0].expectedRevision, nil)
        XCTAssertEqual(service.requests[0].status, .absent)
        XCTAssertEqual(service.requests[0].reason, "家長臨時請假")
        XCTAssertEqual(viewModel.students[0].attendanceRevision, 1)
        XCTAssertNotNil(viewModel.successMessage)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testTransportRetryReusesStableRequestID() async {
        let sessionID = UUID()
        let studentID = UUID()
        let service = MockAttendanceService(
            rosters: [[TeacherSessionStudent(
                id: studentID,
                displayName: "Retry student",
                schoolName: nil,
                status: .present,
                attendanceRevision: 4,
                attendanceStatusRawValue: "present"
            )]],
            outcomes: [
                .failure(TestAttendanceError.transport),
                .success(AttendanceSubmissionResult(
                    changed: true,
                    revision: 5,
                    idempotentReplay: nil
                ))
            ]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        await viewModel.submit(sessionID: sessionID)
        XCTAssertNil(viewModel.successMessage)
        XCTAssertNotNil(viewModel.errorMessage)

        await viewModel.submit(sessionID: sessionID)

        XCTAssertEqual(service.requests.count, 2)
        XCTAssertEqual(service.requests[0].requestID, service.requests[1].requestID)
        XCTAssertEqual(service.requests[0].expectedRevision, 4)
        XCTAssertEqual(viewModel.students[0].attendanceRevision, 5)
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testTransportFailureOrdinaryLoadPreservesExactRequestAndReason() async {
        let sessionID = UUID()
        let studentID = UUID()
        let initial = TeacherSessionStudent(
            id: studentID,
            displayName: "Retry student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 4,
            attendanceStatusRawValue: "present"
        )
        let service = MockAttendanceService(
            rosters: [[initial], [initial]],
            outcomes: [
                .failure(TestAttendanceError.transport),
                .success(AttendanceSubmissionResult(changed: true, revision: 5, idempotentReplay: nil))
            ]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        viewModel.correctionReason = "保留原因"
        await viewModel.submit(sessionID: sessionID, sessionEnded: true)
        let originalRequest = try! XCTUnwrap(service.requests.first)

        await viewModel.load(sessionID: sessionID)

        XCTAssertEqual(viewModel.students.first?.status, .present)
        XCTAssertEqual(viewModel.students.first?.attendanceRevision, 4)
        XCTAssertEqual(viewModel.correctionReason, "保留原因")
        XCTAssertFalse(viewModel.canEdit(studentID: studentID))

        await viewModel.submit(sessionID: sessionID, sessionEnded: true)

        XCTAssertEqual(service.requests.count, 2)
        XCTAssertEqual(service.requests[1], originalRequest)
        XCTAssertEqual(viewModel.students.first?.status, .absent)
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testOrdinaryReloadPreservesUnsentDraftAndReason() async {
        let sessionID = UUID()
        let studentID = UUID()
        let roster = TeacherSessionStudent(
            id: studentID,
            displayName: "Draft student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 3,
            attendanceStatusRawValue: "present"
        )
        let service = MockAttendanceService(rosters: [[roster], [roster]], outcomes: [])
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        viewModel.correctionReason = "草稿原因"
        await viewModel.load(sessionID: sessionID)

        XCTAssertEqual(viewModel.students.first?.status, .absent)
        XCTAssertEqual(viewModel.students.first?.attendanceRevision, 3)
        XCTAssertEqual(viewModel.correctionReason, "草稿原因")
        XCTAssertTrue(viewModel.visibleUnsubmittedDrafts.isEmpty)
    }

    func testChangedSnapshotMovesUnsentDraftToConflictWithoutRebasingIt() async {
        let sessionID = UUID()
        let studentID = UUID()
        let initial = TeacherSessionStudent(
            id: studentID,
            displayName: "Changed student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 3,
            attendanceStatusRawValue: "present"
        )
        let changed = TeacherSessionStudent(
            id: studentID,
            displayName: "Changed student",
            schoolName: nil,
            status: .excused,
            attendanceRevision: 4,
            attendanceStatusRawValue: "excused"
        )
        let service = MockAttendanceService(rosters: [[initial], [changed]], outcomes: [])
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        viewModel.correctionReason = "衝突原因"
        await viewModel.load(sessionID: sessionID)

        XCTAssertEqual(viewModel.students.first?.status, .excused)
        XCTAssertEqual(viewModel.students.first?.attendanceRevision, 4)
        XCTAssertEqual(viewModel.conflictingDrafts.first?.status, .absent)
        XCTAssertEqual(viewModel.correctionReason, "衝突原因")
        XCTAssertTrue(viewModel.canEdit(studentID: studentID))

        await viewModel.load(sessionID: sessionID)
        XCTAssertEqual(viewModel.conflictingDrafts.map(\.id), [studentID])
        XCTAssertEqual(viewModel.students.first?.status, .excused)
    }

    func testEmptyRosterPreservesPendingAndBlocksRetryUntilStudentReappears() async {
        let sessionID = UUID()
        let studentID = UUID()
        let initial = TeacherSessionStudent(
            id: studentID,
            displayName: "Missing student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 1,
            attendanceStatusRawValue: "present"
        )
        let reappeared = TeacherSessionStudent(
            id: studentID,
            displayName: "Missing student",
            schoolName: nil,
            status: .excused,
            attendanceRevision: 3,
            attendanceStatusRawValue: "excused"
        )
        let service = MockAttendanceService(
            rosters: [[initial], [], [reappeared], [reappeared]],
            outcomes: [
                .failure(TestAttendanceError.transport),
                .success(AttendanceSubmissionResult(changed: false, revision: 3, idempotentReplay: true))
            ]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        viewModel.correctionReason = "待確認原因"
        await viewModel.submit(sessionID: sessionID)
        let originalRequest = try! XCTUnwrap(service.requests.first)

        await viewModel.load(sessionID: sessionID)
        XCTAssertTrue(viewModel.students.isEmpty)
        XCTAssertEqual(viewModel.unavailablePendingStudents.map(\.id), [studentID])
        await viewModel.submit(sessionID: sessionID)
        XCTAssertEqual(service.requests.count, 1)

        await viewModel.load(sessionID: sessionID)
        XCTAssertFalse(viewModel.students.isEmpty)
        XCTAssertFalse(viewModel.canEdit(studentID: studentID))
        await viewModel.submit(sessionID: sessionID)

        XCTAssertEqual(service.requests.count, 2)
        XCTAssertEqual(service.requests[1], originalRequest)
        XCTAssertEqual(viewModel.students.first?.status, .excused)
        XCTAssertEqual(viewModel.students.first?.attendanceRevision, 3)
    }

    func testAuthorizationLoadFailureRetainsPendingAndBlocksWrite() async {
        let sessionID = UUID()
        let studentID = UUID()
        let student = TeacherSessionStudent(
            id: studentID,
            displayName: "Unauthorized student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 1,
            attendanceStatusRawValue: "present"
        )
        let service = MockAttendanceService(
            rosters: [[student]],
            outcomes: [.failure(TestAttendanceError.transport)]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        await viewModel.submit(sessionID: sessionID)
        XCTAssertEqual(service.requests.count, 1)
        service.fetchOutcomes = [.failure(AttendanceServiceError.authorizationDenied)]

        await viewModel.load(sessionID: sessionID)

        XCTAssertTrue(viewModel.students.isEmpty)
        XCTAssertTrue(viewModel.requiresAuthoritativeReload)
        XCTAssertEqual(viewModel.unavailablePendingStudents.map(\.id), [studentID])
        await viewModel.submit(sessionID: sessionID)
        XCTAssertEqual(service.requests.count, 1)
    }

    func testInitialAuthorizationDenialClearsRosterAndPreservesOtherDraft() async {
        let sessionID = UUID()
        let firstID = UUID()
        let secondID = UUID()
        let first = TeacherSessionStudent(
            id: firstID,
            displayName: "First student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 1,
            attendanceStatusRawValue: "present"
        )
        let second = TeacherSessionStudent(
            id: secondID,
            displayName: "Second student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 1,
            attendanceStatusRawValue: "present"
        )
        let service = MockAttendanceService(
            rosters: [[first, second]],
            outcomes: [.failure(AttendanceServiceError.authorizationDenied)]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: firstID, status: .absent)
        viewModel.updateStatus(for: secondID, status: .absent)
        await viewModel.submit(sessionID: sessionID)

        XCTAssertTrue(viewModel.students.isEmpty)
        XCTAssertTrue(viewModel.requiresAuthoritativeReload)
        XCTAssertEqual(viewModel.visibleUnsubmittedDrafts.map(\.id), [firstID, secondID])
        XCTAssertEqual(service.requests.count, 1)
    }

    func testFailedLoadKeepsUnsentDraftVisibleAndDiscardableWithEmptyRoster() async {
        let sessionID = UUID()
        let studentID = UUID()
        let student = TeacherSessionStudent(
            id: studentID,
            displayName: "Draft student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 1,
            attendanceStatusRawValue: "present"
        )
        let service = MockAttendanceService(rosters: [[student]], outcomes: [])
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        viewModel.correctionReason = "保留草稿原因"
        service.fetchOutcomes = [.failure(TestAttendanceError.transport)]
        await viewModel.load(sessionID: sessionID)

        XCTAssertTrue(viewModel.students.isEmpty)
        XCTAssertEqual(viewModel.visibleUnsubmittedDrafts.map(\.id), [studentID])
        viewModel.discardConflictingDraft(studentID: studentID)
        XCTAssertTrue(viewModel.visibleUnsubmittedDrafts.isEmpty)
        XCTAssertEqual(viewModel.correctionReason, "保留草稿原因")
    }

    func testEmptyRosterKeepsConflictVisibleAndAllowsDiscardDuringReload() async {
        let sessionID = UUID()
        let studentID = UUID()
        let student = TeacherSessionStudent(
            id: studentID,
            displayName: "Conflict student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 1,
            attendanceStatusRawValue: "present"
        )
        let service = MockAttendanceService(
            rosters: [[student], []],
            outcomes: [.failure(AttendanceServiceError.attendanceChanged)]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        await viewModel.submit(sessionID: sessionID)

        XCTAssertTrue(viewModel.students.isEmpty)
        XCTAssertEqual(viewModel.conflictingDrafts.map(\.id), [studentID])
        viewModel.discardConflictingDraft(studentID: studentID)
        XCTAssertTrue(viewModel.conflictingDrafts.isEmpty)
    }

    func testUncertainRequestSurvivesLaterAuthorizationDenialAndClearsRoster() async {
        let sessionID = UUID()
        let studentID = UUID()
        let student = TeacherSessionStudent(
            id: studentID,
            displayName: "Uncertain student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 1,
            attendanceStatusRawValue: "present"
        )
        let service = MockAttendanceService(
            rosters: [[student]],
            outcomes: [
                .failure(TestAttendanceError.transport),
                .failure(NSError(
                    domain: "rpc",
                    code: 9,
                    userInfo: [NSLocalizedDescriptionKey: "student is not active in this session cohort"]
                ))
            ]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        await viewModel.submit(sessionID: sessionID)
        await viewModel.load(sessionID: sessionID)
        await viewModel.submit(sessionID: sessionID)

        XCTAssertTrue(viewModel.students.isEmpty)
        XCTAssertTrue(viewModel.requiresAuthoritativeReload)
        XCTAssertEqual(viewModel.unavailablePendingStudents.map(\.id), [studentID])
        XCTAssertEqual(service.requests.count, 2)
        XCTAssertEqual(service.requests[1], service.requests[0])
    }

    func testPartialSuccessKeepsSuccessfulRevisionAndRetriesOnlyFailedRow() async {
        let sessionID = UUID()
        let firstID = UUID()
        let secondID = UUID()
        let service = MockAttendanceService(
            rosters: [[
                TeacherSessionStudent(
                    id: firstID,
                    displayName: "First student",
                    schoolName: nil,
                    status: .present
                ),
                TeacherSessionStudent(
                    id: secondID,
                    displayName: "Second student",
                    schoolName: nil,
                    status: .present
                )
            ]],
            outcomes: [
                .success(AttendanceSubmissionResult(
                    changed: true,
                    revision: 1,
                    idempotentReplay: nil
                )),
                .failure(TestAttendanceError.transport),
                .success(AttendanceSubmissionResult(
                    changed: true,
                    revision: 2,
                    idempotentReplay: nil
                ))
            ]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        await viewModel.submit(sessionID: sessionID)

        XCTAssertEqual(service.requests.count, 2)
        XCTAssertNil(viewModel.successMessage)
        XCTAssertTrue(viewModel.errorMessage?.contains("部分提交") == true)
        XCTAssertEqual(viewModel.students.first(where: { $0.id == firstID })?.attendanceRevision, 1)
        XCTAssertNil(viewModel.students.first(where: { $0.id == secondID })?.attendanceRevision)

        let failedRequestID = service.requests[1].requestID
        await viewModel.submit(sessionID: sessionID)

        XCTAssertEqual(service.requests.count, 3)
        XCTAssertEqual(service.requests[2].studentID, secondID)
        XCTAssertEqual(service.requests[2].requestID, failedRequestID)
        XCTAssertEqual(viewModel.students.first(where: { $0.id == secondID })?.attendanceRevision, 2)
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testStaleSubmissionReloadsAuthoritativeRosterBeforeEditingAgain() async {
        let sessionID = UUID()
        let studentID = UUID()
        let initialStudent = TeacherSessionStudent(
            id: studentID,
            displayName: "Stale student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 1,
            attendanceStatusRawValue: "present"
        )
        let authoritativeStudent = TeacherSessionStudent(
            id: studentID,
            displayName: "Stale student",
            schoolName: nil,
            status: .excused,
            attendanceRevision: 2,
            attendanceStatusRawValue: "excused"
        )
        let service = MockAttendanceService(
            rosters: [[initialStudent], [authoritativeStudent]],
            outcomes: [.failure(AttendanceServiceError.attendanceChanged)]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        await viewModel.submit(sessionID: sessionID)

        XCTAssertEqual(service.fetchCallCount, 2)
        XCTAssertEqual(viewModel.students[0].status, .excused)
        XCTAssertEqual(viewModel.students[0].attendanceRevision, 2)
        XCTAssertFalse(viewModel.requiresAuthoritativeReload)
        XCTAssertNil(viewModel.successMessage)
        XCTAssertTrue(viewModel.errorMessage?.contains("已變更") == true)

        viewModel.updateStatus(for: studentID, status: .absent)
        XCTAssertEqual(viewModel.students[0].status, .absent)
    }

    func testReplayReloadsRosterBeforeNewEdits() async {
        let sessionID = UUID()
        let studentID = UUID()
        let initialStudent = TeacherSessionStudent(
            id: studentID,
            displayName: "Replay student",
            schoolName: nil,
            status: .present,
            attendanceRevision: 1,
            attendanceStatusRawValue: "present"
        )
        let authoritativeStudent = TeacherSessionStudent(
            id: studentID,
            displayName: "Replay student",
            schoolName: nil,
            status: .absent,
            attendanceRevision: 3,
            attendanceStatusRawValue: "absent"
        )
        let service = MockAttendanceService(
            rosters: [[initialStudent], [authoritativeStudent]],
            outcomes: [.success(AttendanceSubmissionResult(
                changed: false,
                revision: 2,
                idempotentReplay: true
            ))]
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .absent)
        await viewModel.submit(sessionID: sessionID)

        XCTAssertEqual(service.fetchCallCount, 2)
        XCTAssertEqual(viewModel.students[0].status, .absent)
        XCTAssertEqual(viewModel.students[0].attendanceRevision, 3)
        XCTAssertNil(viewModel.successMessage)
        XCTAssertTrue(viewModel.noticeMessage?.contains("重新載入") == true)
    }

    func testReplayPreservesUnsubmittedDraftAndReasonAcrossSessionEnd() async {
        let sessionID = UUID()
        let first = TeacherSessionStudent(id: UUID(), displayName: "A", schoolName: nil, status: .present)
        let second = TeacherSessionStudent(id: UUID(), displayName: "B", schoolName: nil, status: .present)
        let confirmed = TeacherSessionStudent(id: first.id, displayName: "A", schoolName: nil,
            status: .absent, attendanceRevision: 1, attendanceStatusRawValue: "absent")
        let service = MockAttendanceService(rosters: [[first, second], [confirmed, second]], outcomes: [
            .failure(TestAttendanceError.transport),
            .success(AttendanceSubmissionResult(changed: false, revision: 1, idempotentReplay: true)),
            .success(AttendanceSubmissionResult(changed: true, revision: 1, idempotentReplay: nil))
        ])
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)
        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: first.id, status: .absent)
        viewModel.updateStatus(for: second.id, status: .absent)
        await viewModel.submit(sessionID: sessionID, sessionEnded: false)
        viewModel.correctionReason = "下課後確認"
        await viewModel.submit(sessionID: sessionID, sessionEnded: true)

        XCTAssertEqual(service.requests.count, 2)
        XCTAssertEqual(service.requests[0], service.requests[1])
        XCTAssertEqual(service.requests[1].reason, "")
        XCTAssertEqual(viewModel.students.first(where: { $0.id == second.id })?.status, .absent)
        XCTAssertEqual(viewModel.correctionReason, "下課後確認")
        XCTAssertNil(viewModel.successMessage)

        await viewModel.submit(sessionID: sessionID, sessionEnded: true)
        XCTAssertEqual(service.requests.count, 3)
        XCTAssertEqual(service.requests[2].studentID, second.id)
        XCTAssertEqual(service.requests[2].reason, "下課後確認")
        XCTAssertNil(service.requests[2].expectedRevision)
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testStaleReloadKeepsConflictingDraftVisibleWithoutRebasingIt() async {
        let sessionID = UUID()
        let first = TeacherSessionStudent(id: UUID(), displayName: "A", schoolName: nil,
            status: .present, attendanceRevision: 1, attendanceStatusRawValue: "present")
        let second = TeacherSessionStudent(id: UUID(), displayName: "B", schoolName: nil,
            status: .present, attendanceRevision: 1, attendanceStatusRawValue: "present")
        let changedSecond = TeacherSessionStudent(id: second.id, displayName: "B", schoolName: nil,
            status: .excused, attendanceRevision: 2, attendanceStatusRawValue: "excused")
        let service = MockAttendanceService(rosters: [[first, second], [first, changedSecond]],
            outcomes: [
                .failure(AttendanceServiceError.attendanceChanged),
                .success(AttendanceSubmissionResult(changed: true, revision: 3, idempotentReplay: nil))
            ])
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)
        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: first.id, status: .absent)
        viewModel.updateStatus(for: second.id, status: .absent)
        viewModel.correctionReason = "保留原因"
        await viewModel.submit(sessionID: sessionID)

        XCTAssertEqual(Set(viewModel.conflictingDrafts.map(\.id)), Set([first.id, second.id]))
        XCTAssertEqual(viewModel.conflictingDrafts.first?.status, .absent)
        XCTAssertEqual(viewModel.students.first(where: { $0.id == second.id })?.status, .excused)
        XCTAssertEqual(viewModel.correctionReason, "保留原因")
        await viewModel.submit(sessionID: sessionID)
        XCTAssertEqual(service.requests.count, 1)
        XCTAssertNil(viewModel.successMessage)
        viewModel.updateStatus(for: second.id, status: .absent)
        await viewModel.submit(sessionID: sessionID)
        XCTAssertEqual(service.requests.last?.studentID, second.id)
        XCTAssertEqual(service.requests.last?.expectedRevision, 2)
        XCTAssertNil(viewModel.successMessage)
        viewModel.discardConflictingDraft(studentID: first.id)
        XCTAssertTrue(viewModel.conflictingDrafts.isEmpty)
    }

    func testLoadSerializesSubmissionsAndRejectsCancelledResponse() async {
        let sessionID = UUID()
        let student = TeacherSessionStudent(id: UUID(), displayName: "A", schoolName: nil,
            status: .present, attendanceRevision: 1, attendanceStatusRawValue: "present")
        let newer = TeacherSessionStudent(id: student.id, displayName: "A", schoolName: nil,
            status: .excused, attendanceRevision: 2, attendanceStatusRawValue: "excused")
        let service = MockAttendanceService(rosters: [[student], [newer]], outcomes: [])
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)
        await viewModel.load(sessionID: sessionID)
        let started = expectation(description: "suspended roster read")
        service.suspendFetch = true
        service.onFetchSuspended = { started.fulfill() }
        let loading = Task { await viewModel.load(sessionID: sessionID) }
        await fulfillment(of: [started], timeout: 2)
        XCTAssertTrue(viewModel.isLoading)
        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: student.id, status: .absent)
        await viewModel.submit(sessionID: sessionID)
        XCTAssertEqual(service.fetchCallCount, 2)
        XCTAssertTrue(service.requests.isEmpty)
        XCTAssertFalse(viewModel.canEdit(studentID: student.id))
        loading.cancel()
        service.resumeFetch?.resume()
        await loading.value
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertEqual(viewModel.students.first?.attendanceRevision, 1)
        XCTAssertEqual(viewModel.students.first?.status, .present)
    }

    func testFailedConflictReloadPreservesDraftUntilExplicitRetry() async {
        let sessionID = UUID()
        let first = TeacherSessionStudent(id: UUID(), displayName: "A", schoolName: nil,
            status: .present, attendanceRevision: 1, attendanceStatusRawValue: "present")
        let second = TeacherSessionStudent(id: UUID(), displayName: "B", schoolName: nil, status: .present)
        let service = MockAttendanceService(rosters: [[first, second]],
            outcomes: [.failure(AttendanceServiceError.attendanceChanged)])
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)
        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: first.id, status: .absent)
        viewModel.updateStatus(for: second.id, status: .absent)
        viewModel.correctionReason = "保留"
        service.fetchError = TestAttendanceError.transport
        await viewModel.submit(sessionID: sessionID)
        XCTAssertTrue(viewModel.requiresAuthoritativeReload)
        XCTAssertNil(viewModel.successMessage)
        await viewModel.submit(sessionID: sessionID)
        XCTAssertEqual(service.requests.count, 1)
        service.fetchError = nil
        await viewModel.load(sessionID: sessionID)
        XCTAssertFalse(viewModel.requiresAuthoritativeReload)
        XCTAssertEqual(viewModel.students.first(where: { $0.id == second.id })?.status, .absent)
        XCTAssertEqual(viewModel.correctionReason, "保留")
    }

    func testMakeupCompletedRowIsReadOnlyAndNeverSubmitted() async {
        let sessionID = UUID()
        let studentID = UUID()
        let service = MockAttendanceService(
            rosters: [[TeacherSessionStudent(
                id: studentID,
                displayName: "Makeup student",
                schoolName: nil,
                status: .makeupCompleted,
                attendanceRevision: 6,
                attendanceStatusRawValue: "makeup_completed"
            )]],
            outcomes: []
        )
        let viewModel = TeacherAttendanceViewModel(attendanceService: service)

        await viewModel.load(sessionID: sessionID)
        viewModel.updateStatus(for: studentID, status: .present)
        await viewModel.submit(sessionID: sessionID)

        XCTAssertFalse(viewModel.students[0].isEditable)
        XCTAssertEqual(viewModel.students[0].status, .makeupCompleted)
        XCTAssertTrue(service.requests.isEmpty)
        XCTAssertNotNil(viewModel.noticeMessage)
    }
}

private final class MockAttendanceService: AttendanceServicing {
    var suspendFetch = false
    var onFetchSuspended: (() -> Void)?
    var resumeFetch: CheckedContinuation<Void, Never>?
    var fetchError: Error?
    var fetchOutcomes: [Result<[TeacherSessionStudent], Error>] = []
    var rosters: [[TeacherSessionStudent]]
    var outcomes: [Result<AttendanceSubmissionResult, Error>]
    private(set) var requests: [AttendanceSubmissionRequest] = []
    private(set) var fetchCallCount = 0

    init(
        rosters: [[TeacherSessionStudent]],
        outcomes: [Result<AttendanceSubmissionResult, Error>]
    ) {
        self.rosters = rosters
        self.outcomes = outcomes
    }

    func fetchSessionStudents(sessionID: UUID) async throws -> [TeacherSessionStudent] {
        fetchCallCount += 1
        if suspendFetch {
            await withCheckedContinuation { continuation in
                resumeFetch = continuation
                onFetchSuspended?()
            }
        }
        if !fetchOutcomes.isEmpty {
            switch fetchOutcomes.removeFirst() {
            case .success(let roster):
                return roster
            case .failure(let error):
                throw error
            }
        }
        if let fetchError { throw fetchError }
        if rosters.count > 1 {
            return rosters.removeFirst()
        }
        return rosters.first ?? []
    }

    func submitAttendance(request: AttendanceSubmissionRequest) async throws -> AttendanceSubmissionResult {
        requests.append(request)
        guard !outcomes.isEmpty else {
            return AttendanceSubmissionResult(changed: true, revision: 1, idempotentReplay: nil)
        }

        switch outcomes.removeFirst() {
        case .success(let result):
            return result
        case .failure(let error):
            throw error
        }
    }
}

private enum TestAttendanceError: Error {
    case transport
}
