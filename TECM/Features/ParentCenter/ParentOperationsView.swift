import Combine
import Foundation
import SwiftUI

@MainActor
final class ParentOperationsViewModel: ObservableObject {
    @Published private(set) var snapshot: ParentOperationsSnapshot?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var confirmationMessage: String?

    private let service: ParentOperationsServicing

    init(service: ParentOperationsServicing = ParentOperationsService()) {
        self.service = service
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            snapshot = try await service.fetchSnapshot()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func submitLeave(studentID: UUID, sessionID: UUID, reason: String) async -> Bool {
        do {
            let identifier = try await service.submitLeaveRequest(
                studentID: studentID,
                sessionID: sessionID,
                reason: reason.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            confirmationMessage = "Leave request submitted: \(identifier.uuidString.prefix(8))"
            await load()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}

struct ParentOperationsView: View {
    @StateObject private var viewModel = ParentOperationsViewModel()
    @State private var selectedStudentID: UUID?
    @State private var selectedSessionID: UUID?
    @State private var reason = ""

    var body: some View {
        ScreenContainer(title: "Parent operations", showBackButton: true) {
            if viewModel.isLoading, viewModel.snapshot == nil {
                SkeletonCard()
                SkeletonCard()
            } else if let errorMessage = viewModel.errorMessage, viewModel.snapshot == nil {
                EmptyStateView(title: "Unable to load", message: errorMessage)
                SecondaryCTAButton(title: "Retry") { Task { await viewModel.load() } }
            } else if let snapshot = viewModel.snapshot {
                classesSection(snapshot.classes)
                leaveSection(snapshot)
                makeupSection(snapshot.makeupEntitlements)
                financeSection(snapshot)
            }
        }
        .tecmDetailTabBar()
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
    }

    private func classesSection(_ classes: [ParentExamAttendanceSummary]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            PremiumSectionHeader(title: "Classes", subtitle: "Current enrolments and progress")
            if classes.isEmpty {
                EmptyStateView(title: "No classes", message: "No linked class enrolments are visible.")
            } else {
                ForEach(classes) { item in
                    ElevatedCard {
                        Text(item.cohortName).font(Theme.Typography.cardTitle)
                        Text(item.studentName).font(Theme.Typography.caption)
                        Text("Attendance: \(item.attendanceRateText) · \(item.displayText)")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                }
            }
        }
    }

    private func leaveSection(_ snapshot: ParentOperationsSnapshot) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            PremiumSectionHeader(title: "Leave", subtitle: "Submit and review leave requests")
            if !snapshot.classes.isEmpty {
                Picker("Student", selection: $selectedStudentID) {
                    Text("Select student").tag(UUID?.none)
                    ForEach(snapshot.classes) { item in
                        Text(item.studentName).tag(Optional(item.studentID))
                    }
                }
                .pickerStyle(.menu)
                Picker("Lesson session", selection: $selectedSessionID) {
                    Text("Select session").tag(UUID?.none)
                    ForEach(availableSessions(in: snapshot)) { session in
                        Text("\(session.lessonTitle) · \(session.startsAt.formatted(date: .abbreviated, time: .shortened))")
                            .tag(Optional(session.id))
                    }
                }
                .pickerStyle(.menu)
                .disabled(selectedStudentID == nil)
                TextField("Reason", text: $reason, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                PrimaryCTAButton(title: "Submit leave request", isDisabled: !canSubmitLeave) {
                    guard let studentID = selectedStudentID,
                          let sessionUUID = selectedSessionID else { return }
                    Task {
                        if await viewModel.submitLeave(
                            studentID: studentID,
                            sessionID: sessionUUID,
                            reason: reason
                        ) {
                            selectedSessionID = nil
                            reason = ""
                        }
                    }
                }
            }
            if let confirmation = viewModel.confirmationMessage {
                Text(confirmation).font(Theme.Typography.caption).foregroundStyle(Theme.Colors.primary)
            }
            ForEach(snapshot.leaveRequests) { item in
                summaryRow(title: item.reason, detail: item.status.capitalized)
            }
        }
        .onChange(of: selectedStudentID) { _ in
            selectedSessionID = nil
        }
    }

    private func makeupSection(_ items: [ParentMakeupEntitlementItem]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            PremiumSectionHeader(title: "Makeup entitlements", subtitle: "Available units and status")
            if items.isEmpty {
                Text("No makeup entitlements.").foregroundStyle(Theme.Colors.textSecondary)
            }
            ForEach(items) { item in
                summaryRow(
                    title: "\(item.unitsRemaining) of \(item.unitsGranted) units remaining",
                    detail: item.status.capitalized
                )
            }
        }
    }

    private func financeSection(_ snapshot: ParentOperationsSnapshot) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            PremiumSectionHeader(title: "Finance", subtitle: "Credits, charges, payments, and receipts")
            let balance = snapshot.credits.reduce(0) { $0 + $1.deltaUnits }
            summaryRow(title: "Credit balance", detail: "\(balance) units")
            ForEach(snapshot.charges) { item in
                summaryRow(title: item.description, detail: money(item.amountMinor, item.currencyCode) + " · " + item.status)
            }
            ForEach(snapshot.payments) { item in
                summaryRow(title: "Payment · \(item.method)", detail: money(item.amountMinor, item.currencyCode) + " · " + item.status)
            }
            ForEach(snapshot.receipts) { item in
                summaryRow(title: "Receipt \(item.receiptNumber)", detail: money(item.amountMinor, item.currencyCode))
            }
        }
    }

    private func summaryRow(title: String, detail: String) -> some View {
        ElevatedCard {
            Text(title).font(Theme.Typography.body.weight(.semibold))
            Text(detail).font(Theme.Typography.caption).foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    private var canSubmitLeave: Bool {
        selectedStudentID != nil && selectedSessionID != nil &&
            !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func availableSessions(in snapshot: ParentOperationsSnapshot) -> [ParentLessonSessionItem] {
        guard let selectedStudentID else { return [] }
        return snapshot.sessionsByStudent[selectedStudentID] ?? []
    }

    private func money(_ minor: Int64, _ currency: String) -> String {
        let amount = (Double(minor) / 100).formatted(.number.precision(.fractionLength(2)))
        return "\(currency) \(amount)"
    }
}
