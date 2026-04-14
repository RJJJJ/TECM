import Foundation
import Supabase

protocol BookingServicing {
    func submitBooking(input: BookingFormInput, profile: ParentProfile) async throws -> BookingRecord
    func fetchMyBookings(parentID: UUID) async throws -> [ParentReservationSummaryItem]
    func fetchBookingDetail(bookingID: UUID, parentID: UUID) async throws -> ParentBookingDetail
}

struct BookingService: BookingServicing {
    private let client: SupabaseClient

    init(client: SupabaseClient = SupabaseClientProvider.shared) {
        self.client = client
    }

    func submitBooking(input: BookingFormInput, profile: ParentProfile) async throws -> BookingRecord {
        let selectedChild = profile.children.first
        let courseID = try await resolveCourseID(title: input.courseName)
        let campusID = try await resolveCampusID(name: input.campusName)

        let payload = BookingInsertPayload(
            parentID: profile.id,
            childID: selectedChild?.id,
            parentName: input.parentName,
            phone: input.phone,
            childName: selectedChild?.name ?? "孩子待補",
            childAge: selectedChild?.age,
            schoolName: input.schoolName,
            courseID: courseID,
            courseTitleSnapshot: input.courseName,
            campusID: campusID,
            bookingDate: Self.dateFormatter.string(from: input.preferredDate),
            startTime: Self.slotToTime(input.startSlot),
            endTime: Self.slotToTime(input.endSlot),
            note: input.note,
            status: "pending"
        )

        let inserted: BookingDTO = try await client
            .from("bookings")
            .insert(payload)
            .select("id,parent_name,phone,child_name,child_age,school_name,course_title_snapshot,booking_date,start_time,end_time,note,status,created_at,campus:campuses(name)")
            .single()
            .execute()
            .value

        return inserted.toBookingRecord()
    }

    func fetchMyBookings(parentID: UUID) async throws -> [ParentReservationSummaryItem] {
        let rows: [BookingDTO] = try await client
            .from("bookings")
            .select("id,parent_name,phone,child_name,child_age,school_name,course_title_snapshot,booking_date,start_time,end_time,note,status,created_at,campus:campuses(name)")
            .eq("parent_id", value: parentID)
            .order("created_at", ascending: false)
            .execute()
            .value

        return rows.map { $0.toSummaryItem() }
    }

    func fetchBookingDetail(bookingID: UUID, parentID: UUID) async throws -> ParentBookingDetail {
        let rows: [BookingDTO] = try await client
            .from("bookings")
            .select("id,parent_name,phone,child_name,child_age,school_name,course_title_snapshot,booking_date,start_time,end_time,note,status,created_at,campus:campuses(name)")
            .eq("id", value: bookingID)
            .eq("parent_id", value: parentID)
            .limit(1)
            .execute()
            .value

        guard let row = rows.first else {
            throw BookingServiceError.bookingNotFound
        }
        return row.toParentBookingDetail()
    }

    private func resolveCourseID(title: String) async throws -> UUID? {
        let courses: [CourseLookupDTO] = try await client
            .from("courses")
            .select("id")
            .eq("title", value: title)
            .limit(1)
            .execute()
            .value
        return courses.first?.id
    }

    private func resolveCampusID(name: String) async throws -> UUID? {
        let campuses: [CampusLookupDTO] = try await client
            .from("campuses")
            .select("id")
            .eq("name", value: name)
            .limit(1)
            .execute()
            .value
        return campuses.first?.id
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static func slotToTime(_ slot: Int) -> String {
        let hour = slot / 2
        let minute = slot % 2 == 0 ? "00" : "30"
        return String(format: "%02d:%@:00", hour, minute)
    }
}

enum BookingServiceError: LocalizedError {
    case bookingNotFound

    var errorDescription: String? {
        switch self {
        case .bookingNotFound:
            return "找不到這筆預約資料，可能已被移除或你沒有檢視權限。"
        }
    }
}

private struct CourseLookupDTO: Decodable {
    let id: UUID
}

private struct CampusLookupDTO: Decodable {
    let id: UUID
}
