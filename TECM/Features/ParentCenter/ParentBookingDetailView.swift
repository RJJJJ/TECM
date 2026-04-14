import SwiftUI

struct ParentBookingDetailView: View {
    @StateObject private var viewModel: ParentBookingDetailViewModel

    init(bookingID: UUID, parentID: UUID) {
        _viewModel = StateObject(wrappedValue: ParentBookingDetailViewModel(bookingID: bookingID, parentID: parentID))
    }

    var body: some View {
        ScreenContainer(title: "預約詳情", showBackButton: true) {
            PremiumSectionHeader(
                eyebrow: "Booking Detail",
                title: "單筆預約資訊",
                subtitle: "查看最新狀態與關鍵聯絡資訊。"
            )

            if viewModel.isLoading && viewModel.detail == nil {
                SkeletonCard()
                SkeletonCard()
            } else if let errorMessage = viewModel.errorMessage {
                EmptyStateView(title: "載入失敗", message: errorMessage)
                SecondaryCTAButton(title: "重新載入") {
                    Task { await viewModel.refresh() }
                }
            } else if let detail = viewModel.detail {
                detailContent(detail)
            } else {
                EmptyStateView(title: "目前沒有資料", message: "請稍後重新整理，或返回預約摘要查看其他預約。")
            }
        }
        .refreshable {
            await viewModel.refresh()
        }
        .task {
            await viewModel.load()
        }
    }

    private func detailContent(_ detail: ParentBookingDetail) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            ElevatedCard {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                        Text(detail.courseTitle)
                            .font(Theme.Typography.cardTitle)
                            .foregroundStyle(Theme.Colors.textPrimary)
                        Text(detail.campusName)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                    Spacer()
                    BookingStatusChip(status: detail.status)
                }
            }

            ElevatedCard {
                detailRow(title: "預約日期", value: detail.bookingDateText)
                detailRow(title: "時段", value: detail.timeRangeText)
                detailRow(title: "備註", value: detail.note)
            }

            ElevatedCard {
                detailRow(title: "孩子姓名", value: detail.childName)
                detailRow(title: "家長姓名", value: detail.parentName)
                detailRow(title: "聯絡電話", value: detail.phone)
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
        ParentBookingDetailView(bookingID: UUID(), parentID: UUID())
    }
}
