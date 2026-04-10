import SwiftUI

struct ParentCenterView: View {
    @State private var revealTapCount = 0
    @State private var showsInternalEntry = false

    var body: some View {
        ScreenContainer(title: "家長中心") {
            profileSummary
            bookingRecords
            notifications
            upcomingClass
            actionButtons
            internalAccessFooter
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
            NavigationLink(destination: LearningCenterView()) {
                Text("前往學習中心")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Theme.Spacing.sm)
                    .background(Theme.Colors.softBlue)
                    .foregroundStyle(Theme.Colors.primaryBlue)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.button, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    private var internalAccessFooter: some View {
        VStack(spacing: Theme.Spacing.sm) {
            if showsInternalEntry {
                InfoCard {
                    Text("內部示範入口")
                        .font(.subheadline.weight(.semibold))
                    Text("僅供職員／演示使用")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)

                    NavigationLink(destination: InternalAccessGateView()) {
                        Text("開啟內部示範")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Theme.Spacing.sm)
                            .background(Theme.Colors.softBlue)
                            .foregroundStyle(Theme.Colors.primaryBlue)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.button, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            Text("版本資訊")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary.opacity(0.7))
                .onTapGesture {
                    revealTapCount += 1
                    if revealTapCount >= 5 {
                        withAnimation(.easeOut(duration: 0.2)) {
                            showsInternalEntry = true
                        }
                    }
                }
        }
    }
}
