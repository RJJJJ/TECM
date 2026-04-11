import SwiftUI

struct ParentReservationSummaryView: View {
    @State private var selectedFilter: ReservationSummaryFilter = .all
    private let reservations = MockDataStore.parentReservationSummaries

    private var filteredReservations: [ParentReservationSummaryItem] {
        guard let status = selectedFilter.status else { return reservations }
        return reservations.filter { $0.status == status }
    }

    var body: some View {
        ScreenContainer(title: "預約摘要", showBackButton: true) {
            PremiumSectionHeader(
                eyebrow: "Reservation Summary",
                title: "我的預約",
                subtitle: "集中查看已提交、待確認與已安排的體驗進度。"
            )

            filterChips

            if filteredReservations.isEmpty {
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

            HStack {
                Spacer()
                Text("查看詳情")
                    .font(Theme.Typography.caption.weight(.semibold))
                    .foregroundStyle(Theme.Colors.primary)
                Image(systemName: "arrow.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.Colors.primary)
            }
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

#Preview {
    NavigationStack {
        ParentReservationSummaryView()
    }
}
