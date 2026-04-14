import SwiftUI

struct ParentReservationSummaryView: View {
    @StateObject private var viewModel = ParentCenterViewModel()
    @EnvironmentObject private var authViewModel: AuthViewModel

    @State private var selectedFilter: ReservationSummaryFilter = .all
    @State private var selectedReservation: ParentReservationSummaryItem?

    private var filteredReservations: [ParentReservationSummaryItem] {
        guard let status = selectedFilter.status else { return viewModel.reservations }
        return viewModel.reservations.filter { $0.status == status }
    }

    var body: some View {
        ScreenContainer(title: "預約摘要", showBackButton: true) {
            PremiumSectionHeader(
                eyebrow: "Reservation Summary",
                title: "我的預約",
                subtitle: "集中查看已提交、待確認與已安排的體驗進度。"
            )

            filterChips

            if authViewModel.currentUser == nil {
                EmptyStateView(title: "尚未登入", message: "請先登入家長帳號以查看私人預約資料。")
            } else if viewModel.isLoading {
                SkeletonCard()
                SkeletonCard()
            } else if let errorMessage = viewModel.errorMessage {
                EmptyStateView(title: "載入失敗", message: errorMessage)
            } else if filteredReservations.isEmpty {
                EmptyStateView(
                    title: "目前沒有\(selectedFilter.title)預約",
                    message: "你可以先切換其他狀態，或返回家長中心提交新的體驗需求。"
                )
            } else {
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    ForEach(filteredReservations) { item in
                        reservationCard(item)
                    }
                }
            }
        }
        .tecmDetailTabBar()
        .sheet(item: $selectedReservation) { item in
            ReservationDetailSheet(item: item)
                .presentationDetents([.medium, .large])
        }
        .task {
            await viewModel.load(userID: authViewModel.currentUser?.id)
        }
        .onChange(of: authViewModel.currentUser?.id) { userID in
            Task { await viewModel.load(userID: userID) }
        }
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Spacing.xs) {
                ForEach(ReservationSummaryFilter.allCases) { filter in
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedFilter = filter
                        }
                    } label: {
                        FAQChip(title: filter.title, selected: selectedFilter == filter)
                    }
                    .buttonStyle(PressableScaleStyle())
                }
            }
        }
    }

    private func reservationCard(_ item: ParentReservationSummaryItem) -> some View {
        ElevatedCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(item.parentName) ・ \(item.childName)")
                        .font(Theme.Typography.cardTitle)
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Text(item.courseDirection)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                Spacer()
                BookingStatusChip(status: item.status)
            }

            HStack(spacing: Theme.Spacing.md) {
                infoCell(title: "日期", value: item.dateText)
                infoCell(title: "時間", value: item.timeText)
                infoCell(title: "校區", value: item.campus)
            }

            Text(item.note)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.blueGray)

            Button {
                selectedReservation = item
            } label: {
                HStack {
                    Spacer()
                    Text("查看詳情")
                        .font(Theme.Typography.caption.weight(.semibold))
                        .foregroundStyle(Theme.Colors.primary)
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.Colors.primary)
                }
            }
            .buttonStyle(.plain)
        }
    }

    private func infoCell(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(Theme.Typography.chip)
                .foregroundStyle(Theme.Colors.blueGray)
            Text(value)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ReservationDetailSheet: View {
    let item: ParentReservationSummaryItem
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    PremiumSectionHeader(
                        eyebrow: "Reservation Detail",
                        title: "預約詳情",
                        subtitle: "集中檢視本次預約的安排與備註資訊。"
                    )

                    ElevatedCard {
                        detailRow(title: "家長 / 孩子", value: "\(item.parentName) ・ \(item.childName)")
                        detailRow(title: "課程方向", value: item.courseDirection)
                        detailRow(title: "狀態", value: item.status.rawValue)
                        detailRow(title: "日期", value: item.dateText)
                        detailRow(title: "時間", value: item.timeText)
                        detailRow(title: "校區", value: item.campus)
                        detailRow(title: "備註", value: item.note)
                    }
                }
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.top, Theme.Spacing.sm)
                .padding(.bottom, Theme.Spacing.xl)
            }
            .navigationTitle("預約詳情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("關閉") { dismiss() }
                        .foregroundStyle(Theme.Colors.primary)
                }
            }
        }
    }

    private func detailRow(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(title)
                .font(Theme.Typography.chip)
                .foregroundStyle(Theme.Colors.blueGray)
            Text(value)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textPrimary)
        }
    }
}

#Preview {
    NavigationStack {
        ParentReservationSummaryView()
            .environmentObject(AuthViewModel())
    }
}
