import SwiftUI

struct InternalAccessGateView: View {
    @State private var inputCode = ""
    @State private var isUnlocked = false
    @State private var showError = false

    // Demo/internal access pattern：以本地常數模擬內部示範入口，不接後端驗證。
    private let demoAccessCode = "DEMO2026"

    var body: some View {
        ScreenContainer(title: "內部示範入口") {
            InfoCard {
                Text("僅供職員／演示使用")
                    .font(.headline)
                Text("此區為內部示範流程。一般訪客於日常操作不會看到本入口。")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }

            InfoCard {
                SecureField("請輸入示範碼", text: $inputCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled(true)
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.vertical, Theme.Spacing.sm)
                    .background(Theme.Colors.softBlue)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.CornerRadius.button, style: .continuous))

                if showError {
                    Text("示範碼不正確，請再確認")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.danger)
                }

                PrimaryButton(title: isUnlocked ? "已授權" : "進入管理預覽") {
                    verifyCode()
                }
                .disabled(isUnlocked)
                .opacity(isUnlocked ? 0.55 : 1)
            }

            if isUnlocked {
                NavigationLink(destination: ManagementPreviewView()) {
                    Text("前往管理預覽")
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
    }

    private func verifyCode() {
        if inputCode.uppercased() == demoAccessCode {
            isUnlocked = true
            showError = false
        } else {
            showError = true
        }
    }
}
