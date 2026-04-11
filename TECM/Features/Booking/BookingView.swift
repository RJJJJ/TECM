import SwiftUI

struct BookingView: View {
    private enum Step: Int, CaseIterable {
        case service
        case schedule
        case contact
        case confirm

        var title: String {
            switch self {
            case .service: return "選擇課程與孩子階段"
            case .schedule: return "選擇日期與可預約時段"
            case .contact: return "填寫聯絡資訊"
            case .confirm: return "確認並提交"
            }
        }

        var subtitle: String {
            switch self {
            case .service: return "先確認本次要安排的課程與學習階段。"
            case .schedule: return "結束時間將由系統自動推算，減少重複選擇。"
            case .contact: return "僅需填寫必要資料，方便顧問與你聯繫。"
            case .confirm: return "核對重點資訊後，再進入最終摘要提交。"
            }
        }
    }

    @State private var courseType: String
    @State private var childProfile = "6-8歲"
    @State private var campus = "澳門半島校區"
    @State private var preferredDate = Calendar.current.startOfDay(for: Date.now.addingTimeInterval(86400 * 2))
    @State private var startSlot = BookingPolicy.defaultStartSlot
    @State private var parentName = ""
    @State private var phone = ""
    @State private var note = ""
    @State private var currentStep: Step = .service
    @State private var isLoadingStep = true
    @State private var submitted = false
    @State private var isShowingSummary = false
    @FocusState private var focusedField: BookingField?

    private enum BookingField: Hashable {
        case parentName
        case phone
        case note
    }

    private enum BookingPolicy {
        static let openingSlot = 20
        static let closingSlot = 40
        static let defaultStartSlot = 22
        static let defaultDurationSlots = 2
        static let minimumDurationSlots = 1

        static var latestStartSlot: Int { closingSlot - minimumDurationSlots }
    }

    private let courses = ["幼兒雙語啟蒙", "小學數理思維", "公開演說與表達", "學術閱讀工作坊"]
    private let profiles = ["3-5歲", "6-8歲", "9-12歲"]
    private let campuses = ["澳門半島校區", "氹仔校區", "路氹城校區"]
    private var timeSlots: [Int] { Array(BookingPolicy.openingSlot...BookingPolicy.latestStartSlot) }
    private let isSubPage: Bool

    init(prefilledCourse: String? = nil) {
        _courseType = State(initialValue: prefilledCourse ?? "小學數理思維")
        isSubPage = prefilledCourse != nil
    }

    var body: some View {
        ScreenContainer(title: "預約", showBackButton: isSubPage) {
            ConciergeStepHeader(currentStep: currentStep.rawValue + 1, totalSteps: Step.allCases.count, title: currentStep.title, subtitle: currentStep.subtitle)
                .padding(.bottom, 2)

            if submitted {
                bookingSuccessCard
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            } else if isLoadingStep {
                VStack(spacing: Theme.Spacing.md) {
                    SkeletonCard()
                    SkeletonCard()
                }
                .transition(.opacity)
            } else {
                stepContent
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.26), value: currentStep)
        .animation(.easeInOut(duration: 0.2), value: isLoadingStep)
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: Theme.Spacing.sm) {
                if currentStep != .service && !submitted {
                    SecondaryCTAButton(title: "上一步") {
                        moveStep(-1)
                    }
                    .frame(minHeight: 46)
                }

                PrimaryCTAButton(
                    title: submitted ? "再次預約" : primaryTitle,
                    isDisabled: isPrimaryActionDisabled
                ) {
                    handlePrimaryAction()
                }
                .frame(minHeight: 46)
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.top, 8)
            .padding(.bottom, 12)
            .background(Theme.Colors.background.opacity(0.96))
            .overlay(alignment: .top) {
                Divider().overlay(Theme.Colors.line.opacity(0.45))
            }
        }
        .toolbar(TabBarPolicy.isRootScreen(isSubPage), for: .tabBar)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("完成") {
                    focusedField = nil
                }
            }
        }
        .onAppear {
            simulateStepLoading()
            preferredDate = Calendar.current.startOfDay(for: preferredDate)
        }
        .onChange(of: startSlot) { newValue in
            if !timeSlots.contains(newValue) {
                startSlot = BookingPolicy.defaultStartSlot
            }
        }
        .onChange(of: preferredDate) { newDate in
            preferredDate = Calendar.current.startOfDay(for: newDate)
        }
        .navigationDestination(isPresented: $isShowingSummary) {
            BookingSummaryView(
                courseType: courseType,
                childProfile: childProfile,
                campus: campus,
                preferredDate: preferredDate,
                startTimeSlot: formattedSlot(startSlot),
                estimatedEndTimeSlot: formattedSlot(recommendedEndSlot(for: startSlot)),
                parentName: parentName,
                phone: phone,
                note: note,
                onConfirm: submitBooking
            )
        }
        .onTapGesture {
            focusedField = nil
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch currentStep {
        case .service:
            ElevatedCard {
                selectRow(title: "課程或服務", selection: $courseType, options: courses)
                selectRow(title: "孩子階段", selection: $childProfile, options: profiles)
            }
        case .schedule:
            ElevatedCard {
                selectRow(title: "校區偏好", selection: $campus, options: campuses)
                DatePicker("期望日期", selection: $preferredDate, displayedComponents: .date)
                    .font(Theme.Typography.body)

                Text("可預約開始時間")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .padding(.top, 4)
                startTimePicker
                Text("固定營業時段：\(formattedSlot(BookingPolicy.openingSlot)) - \(formattedSlot(BookingPolicy.closingSlot))。預估結束時間會依課程時長自動計算。")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        case .contact:
            ElevatedCard {
                TextField("家長姓名", text: $parentName)
                    .foregroundStyle(Theme.Colors.textPrimary)
                    .tint(Theme.Colors.primary)
                    .textFieldStyle(.roundedBorder)
                    .focused($focusedField, equals: .parentName)
                    .submitLabel(.next)
                    .onSubmit {
                        focusedField = .phone
                    }
                if parentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    inlineValidationMessage("請填寫家長姓名。")
                }

                TextField("聯絡電話", text: $phone)
                    .foregroundStyle(Theme.Colors.textPrimary)
                    .tint(Theme.Colors.primary)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.phonePad)
                    .focused($focusedField, equals: .phone)
                if !phoneValidationMessage.isEmpty {
                    inlineValidationMessage(phoneValidationMessage)
                }

                TextField("備註（選填）", text: $note, axis: .vertical)
                    .foregroundStyle(Theme.Colors.textPrimary)
                    .tint(Theme.Colors.primary)
                    .lineLimit(2 ... 4)
                    .textFieldStyle(.roundedBorder)
                    .focused($focusedField, equals: .note)
                    .submitLabel(.done)
            }
        case .confirm:
            ElevatedCard {
                Text("預約摘要")
                    .font(Theme.Typography.cardTitle)
                Text("\(courseType) ・ \(childProfile)")
                    .font(Theme.Typography.body)
                Text("\(campus) ・ 期望日期：\(preferredDate.formatted(date: .abbreviated, time: .omitted))")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Text("開始時間：\(formattedSlot(startSlot))")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Text("預估結束：\(formattedSlot(recommendedEndSlot(for: startSlot)))")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Text("聯絡人：\(parentName)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)

                if !contactValidationMessage.isEmpty {
                    inlineValidationMessage(contactValidationMessage)
                }

                OutlineCard {
                    Text("提交前提醒")
                        .font(Theme.Typography.chip)
                        .foregroundStyle(Theme.Colors.blueGray)
                    Text("我們將依你提交的資料安排預約，成功提交後會顯示確認結果。")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
        }
    }

    private var bookingSuccessCard: some View {
        ElevatedCard {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 30))
                .foregroundStyle(Theme.Colors.success)
            Text("預約已成功提交")
                .font(Theme.Typography.cardTitle)
            Text("我們已收到你的申請，顧問將於營業時段聯絡確認。")
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textSecondary)

            Divider()

            summaryCompactRow(title: "課程 / 服務", value: "\(courseType)（\(childProfile)）")
            summaryCompactRow(title: "校區與日期", value: "\(campus) ・ \(preferredDate.formatted(date: .abbreviated, time: .omitted))")
            summaryCompactRow(title: "時段", value: "\(formattedSlot(startSlot)) - \(formattedSlot(recommendedEndSlot(for: startSlot)))")

            HStack(spacing: Theme.Spacing.sm) {
                NavigationLink {
                    ParentCenterView()
                } label: {
                    Text("查看家長中心")
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.primary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Theme.Spacing.xs)
                        .overlay {
                            RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                .stroke(Theme.Colors.primary.opacity(0.45), lineWidth: 0.8)
                        }
                }

                Button("返回首頁") {
                    currentStep = .service
                }
                .font(Theme.Typography.body)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Theme.Spacing.xs)
                .background(Theme.Colors.mistBlue.opacity(0.4), in: RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                .foregroundStyle(Theme.Colors.primary)
            }
        }
    }

    private var primaryTitle: String {
        currentStep == .confirm ? "查看摘要" : "下一步"
    }

    private var isPrimaryActionDisabled: Bool {
        !submitted && !validationIssues(for: currentStep).isEmpty
    }

    private var contactValidationMessage: String {
        validationIssues(for: .contact).first ?? ""
    }

    private var phoneValidationMessage: String {
        let cleanedPhone = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanedPhone.isEmpty else { return "" }
        return isPhoneNumberValid(cleanedPhone) ? "" : "電話格式請輸入至少 8 碼數字。"
    }

    private func handlePrimaryAction() {
        if submitted {
            restartBookingFlow()
            return
        }

        if isPrimaryActionDisabled { return }

        if currentStep == .confirm {
            isShowingSummary = true
        } else {
            moveStep(1)
        }
    }

    private func submitBooking() {
        isShowingSummary = false
        withAnimation(.easeInOut(duration: 0.28)) {
            submitted = true
        }
    }

    private func restartBookingFlow() {
        withAnimation(.easeInOut(duration: 0.28)) {
            submitted = false
            currentStep = .service
            parentName = ""
            phone = ""
            note = ""
            startSlot = BookingPolicy.defaultStartSlot
            preferredDate = Calendar.current.startOfDay(for: Date.now.addingTimeInterval(86400 * 2))
        }
        simulateStepLoading()
    }

    private func moveStep(_ delta: Int) {
        let next = max(0, min(Step.allCases.count - 1, currentStep.rawValue + delta))
        currentStep = Step(rawValue: next) ?? .service
        simulateStepLoading()
    }

    private func simulateStepLoading() {
        isLoadingStep = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            isLoadingStep = false
        }
    }

    private func selectRow(title: String, selection: Binding<String>, options: [String]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
            Picker(title, selection: selection) {
                ForEach(options, id: \.self) { item in
                    Text(item).tag(item)
                }
            }
            .pickerStyle(.menu)
        }
    }

    private var startTimePicker: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            pickerColumn(title: "可預約時段", value: $startSlot, options: timeSlots)
            Text("已選擇 \(formattedSlot(startSlot))，預估至 \(formattedSlot(recommendedEndSlot(for: startSlot)))")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    private func pickerColumn(title: String, value: Binding<Int>, options: [Int]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(title)
                .font(Theme.Typography.chip)
                .foregroundStyle(Theme.Colors.blueGray)
            Picker(title, selection: value) {
                ForEach(options, id: \.self) { slot in
                    Text(formattedSlot(slot)).tag(slot)
                }
            }
            .pickerStyle(.wheel)
            .frame(maxWidth: .infinity)
            .frame(height: 120)
            .clipped()
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(Theme.Colors.line.opacity(0.75), lineWidth: 0.8)
            }
            .background(Theme.Colors.card, in: RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        }
    }

    private func formattedSlot(_ slot: Int) -> String {
        let hour = slot / 2
        let minute = slot % 2 == 0 ? "00" : "30"
        return String(format: "%02d:%@", hour, minute)
    }

    private func recommendedEndSlot(for start: Int) -> Int {
        min(start + BookingPolicy.defaultDurationSlots, BookingPolicy.closingSlot)
    }

    private func validationIssues(for step: Step) -> [String] {
        switch step {
        case .contact, .confirm:
            var issues: [String] = []
            if parentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                issues.append("請填寫家長姓名。")
            }
            let cleanedPhone = phone.trimmingCharacters(in: .whitespacesAndNewlines)
            if cleanedPhone.isEmpty {
                issues.append("請填寫聯絡電話。")
            } else if !isPhoneNumberValid(cleanedPhone) {
                issues.append("聯絡電話格式有誤，請輸入至少 8 碼數字。")
            }
            return issues
        default:
            return []
        }
    }

    private func isPhoneNumberValid(_ value: String) -> Bool {
        value.filter(\.isNumber).count >= 8
    }

    private func inlineValidationMessage(_ message: String) -> some View {
        Text(message)
            .font(Theme.Typography.caption)
            .foregroundStyle(Theme.Colors.error)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func summaryCompactRow(title: String, value: String) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.xs) {
            Text(title)
                .font(Theme.Typography.chip)
                .foregroundStyle(Theme.Colors.blueGray)
                .frame(width: 84, alignment: .leading)
            Text(value)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

#Preview {
    NavigationStack { BookingView() }
}
