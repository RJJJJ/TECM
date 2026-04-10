import SwiftUI

struct AdminPreviewView: View {
    let hasInternalAccess: Bool

    init(hasInternalAccess: Bool = false) {
        self.hasInternalAccess = hasInternalAccess
    }

    var body: some View {
        ScreenContainer(title: "管理預覽") {
            if hasInternalAccess {
                InternalDemoBadge()
                SectionHeader(title: "新預約列表", subtitle: "Internal / Demo only")
                ForEach(MockDataStore.bookings) { record in
                    ElevatedCard {
                        HStack {
                            Text(record.parentName)
                                .font(Theme.Typography.cardTitle)
                            Spacer()
                            StatusChip(title: record.status.rawValue, color: record.status.color)
                        }
                        Text("孩子：\(record.childName)（\(record.childAgeGroup)）")
                        Text("課程：\(record.courseName)")
                        Text("校區：\(record.campus)")
                        Text("時段：\(record.timeSlot)")
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                }
            } else {
                LockedState(title: "此頁面僅供內部展示", message: "管理預覽不對 guest 公開，請使用 internal/demo access pattern 進入。")
            }
        }
    }
}

#Preview {
    NavigationStack { AdminPreviewView(hasInternalAccess: true) }
}
