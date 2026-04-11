import SwiftUI

private enum AdminFilter: String, CaseIterable, Identifiable {
    case all = "全部"
    case pending = "待確認"
    case confirmed = "已確認"
    case completed = "已完成"
    case cancelled = "已取消"

    var id: String { rawValue }

    var mappedStatus: BookingStatus? {
        switch self {
        case .all: return nil
        case .pending: return .pending
        case .confirmed: return .confirmed
        case .completed: return .completed
        case .cancelled: return .cancelled
        }
    }
}

struct AdminPreviewView: View {
    let hasInternalAccess: Bool

    @State private var bookings = MockDataStore.bookings
    @State private var selectedFilter: AdminFilter = .all
    @State private var selectedBooking: BookingRecord?
    @State private var toastMessage: String?

    init(hasInternalAccess: Bool = false) {
        self.hasInternalAccess = hasInternalAccess
    }

    private var filteredBookings: [BookingRecord] {
        guard let status = selectedFilter.mappedStatus else { return bookings }
        return bookings.filter { $0.status == status }
    }

    var body: some View {
        ScreenContainer(title: "管理預覽") {
            if hasInternalAccess {
                InternalDemoBadge()

                SectionHeader(title: "預約管理示範", subtitle: "Internal / Demo access only")

                Picker("篩選", selection: $selectedFilter) {
                    ForEach(AdminFilter.allCases) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }
                .pickerStyle(.segmented)

                ForEach(filteredBookings) { booking in
                    AdminBookingCard(booking: booking) {
                        selectedBooking = booking
                    }
                }

                if filteredBookings.isEmpty {
                    QuietCard {
                        Text("目前沒有符合篩選條件的預約。")
                            .font(Theme.Typography.body)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                }
            } else {
                LockedState(title: "此頁面僅供內部展示", message: "管理預覽不對 guest 公開，請使用 internal/demo access pattern 進入。")
            }
        }
        .sheet(item: $selectedBooking) { booking in
            BookingEditSheet(booking: booking) { edited in
                updateBooking(edited)
            }
            .presentationDetents([.medium, .large])
        }
        .overlay(alignment: .top) {
            if let toastMessage {
                FloatingFeedbackToast(message: toastMessage)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.24), value: toastMessage)
    }

    private func updateBooking(_ updated: BookingRecord) {
        if let index = bookings.firstIndex(where: { $0.id == updated.id }) {
            bookings[index] = updated
            toastMessage = "已更新 \(updated.childName) 的預約狀態：\(updated.status.rawValue)"
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
                withAnimation {
                    toastMessage = nil
                }
            }
        }
    }
}

private struct AdminBookingCard: View {
    let booking: BookingRecord
    var viewDetailAction: () -> Void

    var body: some View {
        ElevatedCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(booking.parentName) · \(booking.childName)")
                        .font(Theme.Typography.cardTitle)
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Text("\(booking.courseName) · \(booking.childAgeGroup)")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                Spacer()
                BookingStatusChip(status: booking.status)
            }

            Divider().overlay(Theme.Colors.line.opacity(0.45))

            Label("日期：\(booking.dateText)", systemImage: "calendar")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
            Label("時段：\(booking.timeText)", systemImage: "clock")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
            Label(booking.campus, systemImage: "mappin.and.ellipse")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)

            Button(action: viewDetailAction) {
                HStack {
                    Text("查看詳情")
                        .font(Theme.Typography.caption.weight(.semibold))
                    Spacer()
                    Image(systemName: "arrow.up.right")
                }
            }
            .buttonStyle(RefinedSecondaryButtonStyle())
        }
    }
}

private struct BookingEditSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var editing: BookingRecord
    var onSave: (BookingRecord) -> Void

    init(booking: BookingRecord, onSave: @escaping (BookingRecord) -> Void) {
        _editing = State(initialValue: booking)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    SectionHeader(title: "預約詳情與編輯", subtitle: "可即時更新狀態與重點資訊")

                    ElevatedCard {
                        TextField("學生名稱", text: $editing.childName)
                            .textFieldStyle(.roundedBorder)

                        TextField("課程名稱", text: $editing.courseName)
                            .textFieldStyle(.roundedBorder)

                        TextField("備註", text: $editing.note, axis: .vertical)
                            .lineLimit(2...4)
                            .textFieldStyle(.roundedBorder)
                    }

                    ElevatedCard {
                        DatePicker("日期與時間", selection: $editing.bookingDate)
                            .datePickerStyle(.compact)

                        Picker("狀態", selection: $editing.status) {
                            ForEach(BookingStatus.allCases) { status in
                                Text(status.rawValue).tag(status)
                            }
                        }
                        .pickerStyle(.segmented)

                        HStack {
                            Text("目前狀態")
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Colors.textSecondary)
                            Spacer()
                            BookingStatusChip(status: editing.status)
                        }
                    }
                }
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.top, Theme.Spacing.sm)
                .padding(.bottom, Theme.Spacing.xl)
            }
            .safeAreaInset(edge: .bottom) {
                PrimaryButton(title: "儲存更新", icon: "checkmark") {
                    onSave(editing)
                    dismiss()
                }
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.top, 8)
                .padding(.bottom, 12)
                .background(Theme.Colors.background.opacity(0.95))
            }
            .navigationTitle("預約編輯")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("關閉") { dismiss() }
                        .foregroundStyle(Theme.Colors.primary)
                }
            }
        }
    }
}

#Preview {
    NavigationStack { AdminPreviewView(hasInternalAccess: true) }
}
