import SwiftUI

struct ParentCenterView: View {
    var body: some View {
        ScreenContainer(title: "家長中心") {
            profileSummary
            bookingRecords
            notifications
            upcomingClass
            actionButtons
        }
    }

    private var profileSummary: some View {
        InfoCard {
            Text("家長資訊")
                .font(.headline)
            Text("陳太 ・ 會員編號 P-1024")
            Text("主要聯絡方式：+853 6XXX XXXX")
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    private var bookingRecords: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            SectionHeader(title: "預約紀錄", subtitle: nil)
            InfoCard {
                ForEach(MockDataStore.bookings.prefix(2)) { item in
                    BookingRow(item: item)
                }
            }
        }
    }

    private var notifications: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            SectionHeader(title: "最新通知", subtitle: nil)
            ForEach(MockDataStore.notifications) { item in
                InfoCard {
                    Text(item.title)
                    Text(item.time)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
        }
    }

    private var upcomingClass: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            SectionHeader(title: "即將上課", subtitle: nil)
            InfoCard {
                Text("小學數理思維")
                    .font(.headline)
                Text("2026/04/13（一）16:00 - 澳門半島校區")
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }

    private var actionButtons: some View {
        VStack(spacing: Theme.Spacing.sm) {
            SecondaryButton(title: "聯絡中心") { }
            NavigationLink(destination: AdminPreviewView()) {
                Text("管理預約（管理預覽）")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Theme.Spacing.sm)
                    .background(Theme.Colors.softBlue)
                    .foregroundStyle(Theme.Colors.primaryBlue)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.button, style: .continuous))
            }
        }
    }
}
