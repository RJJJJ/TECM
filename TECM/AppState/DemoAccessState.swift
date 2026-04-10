import SwiftUI

final class DemoAccessState: ObservableObject {
    enum Role: String {
        case parent = "家長模式"
        case internalCenter = "中心內部示範"
    }

    @Published var role: Role = .parent

    var isInternal: Bool {
        role == .internalCenter
    }

    func toggleRole() {
        withAnimation(.easeInOut(duration: 0.2)) {
            role = isInternal ? .parent : .internalCenter
        }
    }
}
