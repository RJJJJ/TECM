import SwiftUI

struct BookingView: View {
    @State private var ageGroup = "6-8歲"
    @State private var courseType = "小學數理思維"
    @State private var campus = "澳門半島校區"
    @State private var selectedDate = Date.now.addingTimeInterval(86400 * 3)
    @State private var parentName = ""
    @State private var phone = ""
    @State private var submitted = false

    private let ageGroups = ["3-5歲", "6-8歲", "9-12歲"]
    private let courseTypes = ["幼兒雙語啟蒙", "小學數理思維", "公開演說與表達"]
    private let campuses = ["澳門半島校區", "氹仔校區", "路氹城校區"]

    var body: some View {
        ScreenContainer(title: "預約試堂") {
            InfoCard {
                pickerSection(title: "小朋友年齡組別", selection: $ageGroup, items: ageGroups)
                pickerSection(title: "課程類型", selection: $courseType, items: courseTypes)
                pickerSection(title: "校區", selection: $campus, items: campuses)

                DatePicker("日期與時段", selection: $selectedDate, displayedComponents: [.date, .hourAndMinute])
                    .datePickerStyle(.compact)

                TextField("家長姓名", text: $parentName)
                    .textFieldStyle(.roundedBorder)
                TextField("聯絡電話", text: $phone)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.phonePad)

                PrimaryButton(title: "確認預約") {
                    submitted = true
                }
            }

            if submitted {
                InfoCard {
                    HStack {
                        Image(systemName: "checkmark.seal.fill")
                            .foregroundStyle(Theme.Colors.success)
                        Text("預約已成功提交")
                            .font(.headline)
                    }
                    Text("我們會盡快與您確認 \(courseType) 之試堂安排。")
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
        }
    }

    private func pickerSection(title: String, selection: Binding<String>, items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            Picker(title, selection: selection) {
                ForEach(items, id: \.self) { item in
                    Text(item).tag(item)
                }
            }
            .pickerStyle(.menu)
        }
    }
}
