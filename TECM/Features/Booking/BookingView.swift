import SwiftUI

struct BookingView: View {
    @EnvironmentObject private var tabRouter: TabRouter
    @Environment(\.calendar) private var calendar
    @StateObject private var viewModel = BookingViewModel()
    @StateObject private var submitViewModel = BookingSubmitViewModel()
    @EnvironmentObject private var authViewModel: AuthViewModel

    private enum Step: Int, CaseIterable {
        case service
        case schedule
        case contact
        case confirm

        var title: String {
            switch self {
            case .service: return "選擇課程、學校與孩子年齡"
            case .schedule: return "選擇日期與可預約時段"
            case .contact: return "填寫聯絡資訊"
            case .confirm: return "確認並提交"
            }
        }

        var subtitle: String {
            switch self {
            case .service: return "先確認本次課程方向、就讀學校與孩子年齡。"
            case .schedule: return "結束時間將由系統自動推算，減少重複選擇。"
            case .contact: return "僅需填寫必要資料，方便顧問與你聯繫。"
            case .confirm: return "核對重點資訊後，再進入最終摘要提交。"
            }
        }
    }

    @State private var courseType: String
    @State private var school = ""
    @State private var childAge = "6歲"
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
    @State private var hasAttemptedContactNext = false
    @State private var hasEditedParentName = false
    @State private var hasEditedPhone = false
    @State private var hasInteractedWithSlotScroll = false
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
    private let childAgeOptions = (3...17).map { "\($0)歲" } + ["18歲以上"]
    private let schools = [
        "培正中學附屬小學",
        "教業中學附屬小學",
        "聖若瑟教區中學（第五校）",
        "嘉諾撒聖心英文中學附屬小學",
        "鏡平學校（小學部）",
        "聖羅撒英文中學（小學部）",
        "中葡職業技術學校（基礎課程）",
        "澳門坊眾學校（小學部）"
    ]
    private var timeSlots: [Int] { Array(BookingPolicy.openingSlot...BookingPolicy.latestStartSlot) }

    private var availableCampuses: [String] {
        let remoteCampuses = viewModel.campuses
        if remoteCampuses.isEmpty {
            return ["澳門半島校區", "氹仔校區", "路氹城校區"]
        }
        return remoteCampuses
    }

    private let mockBookedSlotLookup: [String: Set<Int>] = [
        "澳門半島校區|2026-04-14": [22, 27, 33],
        "澳門半島校區|2026-04-15": [24, 25],
        "氹仔校區|2026-04-14": [26, 31],
        "路氹城校區|2026-04-14": [22, 23, 24]
    ]
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
                    isDisabled: isPrimaryActionDisabled || submitViewModel.isSubmitting
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
        .task {
            await viewModel.loadCampuses()
            await submitViewModel.prepare(userID: authViewModel.currentUser?.id)
            if !availableCampuses.contains(campus), let first = availableCampuses.first {
                campus = first
            }
            if let profile = submitViewModel.profile {
                if parentName.isEmpty { parentName = profile.fullName }
                if phone.isEmpty { phone = profile.phone ?? "" }
            }
        }
        .onChange(of: authViewModel.currentUser?.id) { userID in
            Task {
                await submitViewModel.prepare(userID: userID)
                if let profile = submitViewModel.profile {
                    if !hasEditedParentName { parentName = profile.fullName }
                    if !hasEditedPhone { phone = profile.phone ?? "" }
                }
            }
        }
        .onChange(of: startSlot) { newValue in
            if !timeSlots.contains(newValue) {
                startSlot = BookingPolicy.defaultStartSlot
            }
            ensureSelectedSlotIsAvailable()
        }
        .onChange(of: preferredDate) { newDate in
            preferredDate = Calendar.current.startOfDay(for: newDate)
            ensureSelectedSlotIsAvailable()
        }
        .onChange(of: campus) { _ in
            ensureSelectedSlotIsAvailable()
        }
        .navigationDestination(isPresented: $isShowingSummary) {
            BookingSummaryView(
                courseType: courseType,
                school: school,
                childAge: childAge,
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
                selectRow(title: "孩子就讀學校", selection: $school, options: schools, placeholder: "請選擇學校")
                visibleSelector(title: "孩子年齡", selection: $childAge, options: childAgeOptions)
            }
        case .schedule:
            ElevatedCard {
                selectRow(title: "校區偏好", selection: $campus, options: availableCampuses)
                if viewModel.isLoading {
                    Text("校區資料載入中…")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.blueGray)
                } else if let errorMessage = viewModel.errorMessage {
                    inlineValidationMessage("校區同步失敗：\(errorMessage)")
                } else if viewModel.campuses.isEmpty {
                    inlineValidationMessage("目前沒有可預約校區，請稍後再試。")
                }

                DatePicker("期望日期", selection: $preferredDate, displayedComponents: .date)
                    .font(Theme.Typography.body)

                Text("可預約開始時間")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .padding(.top, 4)
                startTimePicker
                slotStatusLegend
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
                    .onChange(of: parentName) { _ in
                        hasEditedParentName = true
                    }
                    .onSubmit {
                        focusedField = .phone
                    }
                if shouldShowParentNameValidation {
                    inlineValidationMessage("請填寫家長姓名。")
                }

                TextField("聯絡電話", text: $phone)
                    .foregroundStyle(Theme.Colors.textPrimary)
                    .tint(Theme.Colors.primary)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.phonePad)
                    .focused($focusedField, equals: .phone)
                    .onChange(of: phone) { _ in
                        hasEditedPhone = true
                    }
                if !phoneInlineValidationMessage.isEmpty {
                    inlineValidationMessage(phoneInlineValidationMessage)
                }

                if let prepareErrorMessage = submitViewModel.prepareErrorMessage {
                    inlineValidationMessage("帳號資料載入失敗：\(prepareErrorMessage)")
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
                Text("\(courseType) ・ \(childAge)")
                    .font(Theme.Typography.body)
                Text("就讀學校：\(school)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
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

                if !authRequiredMessage.isEmpty {
                    inlineValidationMessage(authRequiredMessage)
                }

                if let submitErrorMessage = submitViewModel.submitErrorMessage {
                    inlineValidationMessage("提交失敗：\(submitErrorMessage)")
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

            summaryCompactRow(title: "課程 / 服務", value: "\(courseType)（\(childAge)）")
            summaryCompactRow(title: "就讀學校", value: school)
            summaryCompactRow(title: "校區與日期", value: "\(campus) ・ \(preferredDate.formatted(date: .abbreviated, time: .omitted))")
            summaryCompactRow(title: "時段", value: "\(formattedSlot(startSlot)) - \(formattedSlot(recommendedEndSlot(for: startSlot)))")

            if let inserted = submitViewModel.submittedBooking {
                summaryCompactRow(title: "預約編號", value: inserted.id.uuidString.prefix(8).uppercased())
            }

            HStack(spacing: Theme.Spacing.sm) {
                Button {
                    tabRouter.select(.parentCenter)
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

    private var authRequiredMessage: String {
        if currentStep == .confirm && submitViewModel.profile == nil {
            return "請先在家長中心登入，才可提交預約。"
        }
        return ""
    }

    private var primaryTitle: String {
        currentStep == .confirm ? "查看摘要" : "下一步"
    }

    private var isPrimaryActionDisabled: Bool {
        if submitted { return false }
        if currentStep == .contact { return false }
        return !validationIssues(for: currentStep).isEmpty
    }

    private var contactValidationMessage: String {
        validationIssues(for: .contact).first ?? ""
    }

    private var shouldShowParentNameValidation: Bool {
        let isInvalid = parentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return isInvalid && (hasAttemptedContactNext || hasEditedParentName)
    }

    private var phoneInlineValidationMessage: String {
        guard hasAttemptedContactNext || hasEditedPhone else { return "" }
        let cleanedPhone = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanedPhone.isEmpty else { return "請填寫聯絡電話。" }
        return isPhoneNumberValid(cleanedPhone) ? "" : "電話格式請輸入至少 8 碼數字。"
    }

    private func handlePrimaryAction() {
        if submitted {
            restartBookingFlow()
            return
        }

        if currentStep == .contact {
            hasAttemptedContactNext = true
            if !validationIssues(for: .contact).isEmpty {
                return
            }
        } else if isPrimaryActionDisabled {
            return
        }

        if currentStep == .confirm {
            isShowingSummary = true
        } else {
            moveStep(1)
        }
    }

    private func submitBooking() {
        Task {
            let formInput = BookingFormInput(
                courseName: courseType,
                childAgeLabel: childAge,
                schoolName: school,
                campusName: campus,
                preferredDate: preferredDate,
                startSlot: startSlot,
                endSlot: recommendedEndSlot(for: startSlot),
                parentName: parentName.trimmingCharacters(in: .whitespacesAndNewlines),
                phone: phone.trimmingCharacters(in: .whitespacesAndNewlines),
                note: note.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            let succeeded = await submitViewModel.submit(formInput: formInput)
            if succeeded {
                isShowingSummary = false
                withAnimation(.easeInOut(duration: 0.28)) {
                    submitted = true
                }
            }
        }
    }

    private func restartBookingFlow() {
        withAnimation(.easeInOut(duration: 0.28)) {
            submitted = false
            currentStep = .service
            parentName = ""
            phone = ""
            note = ""
            submitViewModel.resetSubmissionState()
            hasAttemptedContactNext = false
            hasEditedParentName = false
            hasEditedPhone = false
            startSlot = BookingPolicy.defaultStartSlot
            school = ""
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

    private func selectRow(title: String, selection: Binding<String>, options: [String], placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
            Picker(title, selection: selection) {
                Text(placeholder).tag("")
                ForEach(options, id: \.self) { item in
                    Text(item).tag(item)
                }
            }
            .pickerStyle(.menu)
        }
    }

    private func visibleSelector(title: String, selection: Binding<String>, options: [String]) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.xs) {
                    ForEach(options, id: \.self) { option in
                        let isSelected = selection.wrappedValue == option
                        Button {
                            selection.wrappedValue = option
                        } label: {
                            Text(option)
                                .font(Theme.Typography.body)
                                .foregroundStyle(isSelected ? Theme.Colors.primary : Theme.Colors.textPrimary)
                                .padding(.vertical, Theme.Spacing.xs)
                                .padding(.horizontal, Theme.Spacing.sm)
                                .background(
                                    RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                        .fill(isSelected ? Theme.Colors.mistBlue.opacity(0.45) : Theme.Colors.card)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                                        .stroke(isSelected ? Theme.Colors.primary.opacity(0.7) : Theme.Colors.line.opacity(0.75), lineWidth: isSelected ? 1.2 : 0.8)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var startTimePicker: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("可預約時段")
                .font(Theme.Typography.chip)
                .foregroundStyle(Theme.Colors.blueGray)

            ZStack(alignment: .trailing) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Spacing.xs) {
                        ForEach(timeSlots, id: \.self) { slot in
                            slotButton(slot)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .simultaneousGesture(
                    DragGesture(minimumDistance: 8)
                        .onChanged { value in
                            if abs(value.translation.width) > 12 {
                                hasInteractedWithSlotScroll = true
                            }
                        }
                )

                LinearGradient(
                    colors: [Theme.Colors.background.opacity(0), Theme.Colors.background.opacity(0.9)],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(width: 28)
                .allowsHitTesting(false)
                .opacity(hasInteractedWithSlotScroll ? 0.2 : 0.9)
            }

            Text("左右滑動可查看更多時段")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
                .opacity(hasInteractedWithSlotScroll ? 0.55 : 1)

            Text("已選擇 \(formattedSlot(startSlot))，預估至 \(formattedSlot(recommendedEndSlot(for: startSlot)))")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    private func slotButton(_ slot: Int) -> some View {
        let status = slotStatus(for: slot)
        return Button {
            guard status != .booked else { return }
            startSlot = slot
        } label: {
            VStack(spacing: 2) {
                Text(formattedSlot(slot))
                    .font(Theme.Typography.body)
                if status == .booked {
                    Text("已滿")
                        .font(.system(size: 11, weight: .semibold))
                }
            }
            .foregroundStyle(slotTextColor(for: status))
            .padding(.vertical, Theme.Spacing.xs)
            .padding(.horizontal, Theme.Spacing.sm)
            .background(slotBackground(for: status), in: RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(slotBorder(for: status), lineWidth: status == .selected ? 1.2 : 0.8)
            }
        }
        .buttonStyle(.plain)
        .disabled(status == .booked)
        .accessibilityLabel("\(formattedSlot(slot)) \(status == .booked ? "已滿" : status == .selected ? "已選擇" : "可預約")")
    }

    private var slotStatusLegend: some View {
        HStack(spacing: Theme.Spacing.sm) {
            legendItem(title: "可預約", color: Theme.Colors.card)
            legendItem(title: "已滿", color: Theme.Colors.line.opacity(0.5))
            legendItem(title: "已選中", color: Theme.Colors.mistBlue.opacity(0.45))
        }
        .font(Theme.Typography.caption)
    }

    private func legendItem(title: String, color: Color) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(color)
                .frame(width: 12, height: 12)
                .overlay(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .stroke(Theme.Colors.line.opacity(0.7), lineWidth: 0.8)
                )
            Text(title)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    private enum SlotStatus {
        case available
        case booked
        case selected
    }

    private func slotStatus(for slot: Int) -> SlotStatus {
        if bookedSlotsForSelection.contains(slot) { return .booked }
        if startSlot == slot { return .selected }
        return .available
    }

    private var bookedSlotsForSelection: Set<Int> {
        let key = "\(campus)|\(dateKey(preferredDate))"
        return mockBookedSlotLookup[key] ?? []
    }

    private func dateKey(_ date: Date) -> String {
        let year = calendar.component(.year, from: date)
        let month = calendar.component(.month, from: date)
        let day = calendar.component(.day, from: date)
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    private var firstAvailableSlot: Int? {
        timeSlots.first(where: { !bookedSlotsForSelection.contains($0) })
    }

    private func ensureSelectedSlotIsAvailable() {
        if bookedSlotsForSelection.contains(startSlot), let fallbackSlot = firstAvailableSlot {
            startSlot = fallbackSlot
        }
    }

    private func slotTextColor(for status: SlotStatus) -> Color {
        switch status {
        case .available: return Theme.Colors.textPrimary
        case .booked: return Theme.Colors.textSecondary
        case .selected: return Theme.Colors.primary
        }
    }

    private func slotBackground(for status: SlotStatus) -> Color {
        switch status {
        case .available: return Theme.Colors.card
        case .booked: return Theme.Colors.line.opacity(0.28)
        case .selected: return Theme.Colors.mistBlue.opacity(0.45)
        }
    }

    private func slotBorder(for status: SlotStatus) -> Color {
        switch status {
        case .available: return Theme.Colors.line.opacity(0.75)
        case .booked: return Theme.Colors.line.opacity(0.55)
        case .selected: return Theme.Colors.primary.opacity(0.75)
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
        case .service:
            var issues: [String] = []
            if school.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                issues.append("請選擇孩子就讀學校。")
            }
            return issues
        case .schedule:
            if bookedSlotsForSelection.contains(startSlot) {
                return ["所選時段已被預約，請改選其他時段。"]
            }
            if firstAvailableSlot == nil {
                return ["該日期目前沒有可預約時段，請更改日期或校區。"]
            }
            return []
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
            if step == .confirm && submitViewModel.profile == nil {
                issues.append("請先登入家長帳號。")
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
            .foregroundStyle(Color.red)
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
        .environmentObject(TabRouter())
}
