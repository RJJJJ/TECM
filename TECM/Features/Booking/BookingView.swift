import SwiftUI

struct BookingView: View {
    private enum Step: Int, CaseIterable {
        case service
        case schedule
        case contact
        case confirm

        var title: String {
            switch self {
            case .service: return "選擇課程或服務類型"
            case .schedule: return "選擇時段與到訪安排"
            case .contact: return "填寫聯絡資訊"
            case .confirm: return "確認並提交"
            }
        }

        var subtitle: String {
            switch self {
            case .service: return "先確認本次要安排的核心服務。"
            case .schedule: return "每次只決定一件事，顧問可更快為你安排。"
            case .contact: return "僅保留必要資料，避免表單負擔。"
            case .confirm: return "核對資訊後送出預約申請。"
            }
        }
    }

    @State private var courseType: String
    @State private var childProfile = "6-8歲"
    @State private var campus = "澳門半島校區"
    @State private var preferredDate = Date.now.addingTimeInterval(86400 * 2)
    @State private var startHour = 14
    @State private var parentName = ""
    @State private var phone = ""
    @State private var note = ""
    @State private var currentStep: Step = .service
    @State private var isLoadingStep = true
    @State private var submitted = false

    private let courses = ["幼兒雙語啟蒙", "小學數理思維", "公開演說與表達", "學術閱讀工作坊"]
    private let profiles = ["3-5歲", "6-8歲", "9-12歲"]
    private let campuses = ["澳門半島校區", "氹仔校區", "路氹城校區"]
    private let startHourOptions = Array(6...21)
    private let endHourOptions = Array(7...22)

    init(prefilledCourse: String? = nil) {
        _courseType = State(initialValue: prefilledCourse ?? "小學數理思維")
    }

    var body: some View {
        ScreenContainer(title: "預約") {
            ConciergeStepHeader(currentStep: currentStep.rawValue + 1, totalSteps: Step.allCases.count, title: currentStep.title, subtitle: currentStep.subtitle)

            if submitted {
                SuccessStateView(
                    title: "我們已收到你的預約申請",
                    message: "顧問將按你選擇的時段與校區回覆確認，感謝你選擇 TECM。"
                )
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
                }

                PrimaryCTAButton(title: submitted ? "已提交" : primaryTitle) {
                    handlePrimaryAction()
                }
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.top, 8)
            .padding(.bottom, 12)
            .background(Theme.Colors.background.opacity(0.96))
        }
        .onAppear { simulateStepLoading() }
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

                Text("到訪時間")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .padding(.top, 4)
                timeRangePicker
            }
        case .contact:
            ElevatedCard {
                TextField("家長姓名", text: $parentName)
                    .textFieldStyle(.roundedBorder)
                TextField("聯絡電話", text: $phone)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.phonePad)
                TextField("備註（選填）", text: $note, axis: .vertical)
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)
            }
        case .confirm:
            ElevatedCard {
                Text("預約摘要")
                    .font(Theme.Typography.cardTitle)
                Text("\(courseType) ・ \(childProfile)")
                    .font(Theme.Typography.body)
                Text(selectedTimeSlot)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Text("\(campus) ・ 期望日期：\(preferredDate.formatted(date: .abbreviated, time: .omitted))")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Text("聯絡人：\(parentName)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }

    private var primaryTitle: String {
        currentStep == .confirm ? "確認提交" : "下一步"
    }

    private func handlePrimaryAction() {
        guard !submitted else { return }
        if currentStep == .contact && (parentName.isEmpty || phone.isEmpty) { return }

        if currentStep == .confirm {
            withAnimation(.easeInOut(duration: 0.28)) { submitted = true }
        } else {
            moveStep(1)
        }
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

    private var selectedTimeSlot: String {
        "\(formattedHour(startHour)):00 - \(formattedHour(endHour)):00"
    }

    private var endHour: Int {
        min(startHour + 1, 22)
    }

    private func formattedHour(_ hour: Int) -> String {
        String(format: "%02d", hour)
    }

    private var timeRangePicker: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(spacing: Theme.Spacing.md) {
                pickerColumn(title: "開始", value: $startHour, options: startHourOptions)
                VStack {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.Colors.blueGray)
                }
                pickerColumn(title: "結束", value: .constant(endHour), options: endHourOptions, isInteractive: false)
            }
            Text("已選擇 \(selectedTimeSlot)")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    private func pickerColumn(title: String, value: Binding<Int>, options: [Int], isInteractive: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(title)
                .font(Theme.Typography.chip)
                .foregroundStyle(Theme.Colors.blueGray)
            Picker(title, selection: value) {
                ForEach(options, id: \.self) { hour in
                    Text("\(formattedHour(hour)):00").tag(hour)
                }
            }
            .pickerStyle(.wheel)
            .frame(maxWidth: .infinity)
            .frame(height: 118)
            .clipped()
            .allowsHitTesting(isInteractive)
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous)
                    .stroke(Theme.Colors.line.opacity(0.75), lineWidth: 0.8)
            }
            .background(Theme.Colors.card, in: RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
        }
    }
}

#Preview {
    NavigationStack { BookingView() }
}
