import SwiftUI

struct BookingView: View {
    @State private var ageGroup = "6-8歲"
    @State private var courseType: String
    @State private var campus = "澳門半島校區"
    @State private var selectedDate = Date.now.addingTimeInterval(86400 * 3)
    @State private var selectedSlot = "16:00"
    @State private var parentName = ""
    @State private var phone = ""
    @State private var submitted = false

    private let ageGroups = ["3-5歲", "6-8歲", "9-12歲"]
    private let courseTypes = ["幼兒雙語啟蒙", "小學數理思維", "公開演說與表達"]
    private let campuses = ["澳門半島校區", "氹仔校區", "路氹城校區"]
    private let slots = ["10:00", "14:00", "16:00", "18:00"]

    init(prefilledCourse: String? = nil) {
        _courseType = State(initialValue: prefilledCourse ?? "小學數理思維")
    }

    var body: some View {
        ScreenContainer(title: "預約") {
            SectionHeader(title: "服務流程", subtitle: "1 選擇課程  ·  2 安排時段  ·  3 提交確認")

            ElevatedCard {
                pickerRow(title: "年齡組別", selection: $ageGroup, items: ageGroups)
                pickerRow(title: "課程", selection: $courseType, items: courseTypes)
                pickerRow(title: "校區", selection: $campus, items: campuses)
            }

            ElevatedCard {
                DatePicker("日期", selection: $selectedDate, displayedComponents: .date)
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text("時段")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                    HStack {
                        ForEach(slots, id: \.self) { slot in
                            Button(slot) { selectedSlot = slot }
                                .font(Theme.Typography.caption.weight(.semibold))
                                .foregroundStyle(selectedSlot == slot ? .white : Theme.Colors.primary)
                                .padding(.horizontal, Theme.Spacing.sm)
                                .padding(.vertical, Theme.Spacing.xs)
                                .background(selectedSlot == slot ? Theme.Colors.primary : Theme.Colors.mistBlue.opacity(0.55))
                                .clipShape(Capsule())
                                .buttonStyle(PressableScaleStyle())
                        }
                    }
                }
            }

            BookingSummaryCard(course: courseType, campus: campus, dateText: summaryDateText, status: submitted ? .pending : nil)

            ElevatedCard {
                TextField("家長姓名", text: $parentName)
                    .textFieldStyle(.roundedBorder)
                TextField("聯絡電話", text: $phone)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.phonePad)
                PrimaryButton(title: submitted ? "已提交" : "確認預約", icon: "paperplane.fill") {
                    submitted = true
                }
            }

            if submitted {
                QuietCard {
                    StatusChip(title: "待確認", color: Theme.Colors.warning)
                    Text("預約已送出，顧問將盡快與您聯絡。")
                        .font(Theme.Typography.body)
                    Text("此流程設計旨在降低等待焦慮，您可於家長中心追蹤狀態。")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
        }
    }

    private var summaryDateText: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy/MM/dd"
        return "\(formatter.string(from: selectedDate)) \(selectedSlot)"
    }

    private func pickerRow(title: String, selection: Binding<String>, items: [String]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
            Picker(title, selection: selection) {
                ForEach(items, id: \.self) { item in
                    Text(item).tag(item)
                }
            }
            .pickerStyle(.menu)
        }
    }
}

#Preview {
    NavigationStack { BookingView() }
}
