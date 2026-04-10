import SwiftUI

struct AdminPreviewView: View {
    var body: some View {
        ScreenContainer(title: "管理預覽頁") {
            SectionHeader(title: "新預約列表", subtitle: "示範中心端查看 incoming bookings")
            ForEach(MockDataStore.bookings) { record in
                InfoCard {
                    HStack {
                        Text(record.parentName)
                            .font(.headline)
                        Spacer()
                        StatusBadge(title: record.status.rawValue, color: record.status.color)
                    }
                    Text("小朋友年齡組別：\(record.childAgeGroup)")
                    Text("選擇課程：\(record.courseName)")
                    Text("校區：\(record.campus)")
                    Text("預約時段：\(record.timeSlot)")
                        .foregroundStyle(Theme.Colors.textSecondary)
                    HStack(spacing: Theme.Spacing.sm) {
                        SecondaryButton(title: "查看詳情") { }
                        PrimaryButton(title: "確認", action: { })
                    }
                }
            }
        }
    }
}
