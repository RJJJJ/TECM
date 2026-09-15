import Foundation
import XCTest
@testable import TECM

final class NotificationDTOTests: XCTestCase {
    func testDecodesReadStateAndDeepLinkMetadata() throws {
        let notificationID = UUID()
        let entityID = UUID()
        let json = """
        {
          "id": "\(notificationID.uuidString)",
          "title": "Booking confirmed",
          "detail": "Your booking is ready.",
          "is_read": false,
          "category": "booking_confirmed",
          "deep_link": "tecm://bookings/\(entityID.uuidString)",
          "entity_type": "booking",
          "entity_id": "\(entityID.uuidString)",
          "created_at": "2026-07-15T10:00:00Z"
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let dto = try decoder.decode(NotificationDTO.self, from: Data(json.utf8))
        let model = dto.toModel()

        XCTAssertEqual(model.id, notificationID)
        XCTAssertFalse(model.isRead)
        XCTAssertEqual(model.entityID, entityID)
        XCTAssertEqual(model.deepLink, "tecm://bookings/\(entityID.uuidString)")
    }
}
