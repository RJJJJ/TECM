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

struct ParentBookingDetail: Identifiable {
    let id: UUID
    let parentName: String
    let phone: String
    let childName: String
    let courseTitle: String
    let campusName: String
    let bookingDate: String
    let startTime: String
    let endTime: String
    let status: BookingStatus
    let note: String

    var bookingDateText: String {
        Self.bookingDateFormatter.date(from: bookingDate)?.formatted(date: .abbreviated, time: .omitted) ?? bookingDate
    }

    var timeRangeText: String {
        "\(Self.timeText(from: startTime)) - \(Self.timeText(from: endTime))"
    }

    private static func timeText(from raw: String) -> String {
        if let date = timeFormatter.date(from: raw) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        if raw.count >= 5 {
            return String(raw.prefix(5))
        }
        return raw
    }

    private static let bookingDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()
}
