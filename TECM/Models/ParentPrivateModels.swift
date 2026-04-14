import Foundation

struct ParentProfile: Identifiable {
    let id: UUID
    let userID: UUID
    let fullName: String
    let phone: String?
    let children: [ChildProfile]
}

struct ChildProfile: Identifiable {
    let id: UUID
    let parentID: UUID
    let name: String
    let age: Int?
    let schoolName: String?
    let notes: String?
}

struct ParentNotificationItem: Identifiable {
    let id: UUID
    let title: String
    let detail: String
    let isRead: Bool
    let createdAt: Date

    var relativeTimeText: String {
        RelativeDateTimeFormatter().localizedString(for: createdAt, relativeTo: .now)
    }
}

struct BookingFormInput {
    let courseName: String
    let childAgeLabel: String
    let schoolName: String
    let campusName: String
    let preferredDate: Date
    let startSlot: Int
    let endSlot: Int
    let parentName: String
    let phone: String
    let note: String
}
