import Foundation
import XCTest
@testable import TECM

final class UserRoleCapabilitiesTests: XCTestCase {
    func testMultiRoleAdminParentPreservesParentCapability() {
        let capabilities = UserRoleCapabilities.resolve(
            organizationRoleNames: ["teacher", "admin"],
            hasParentProfile: true
        )

        XCTAssertEqual(capabilities.primaryRole, .admin)
        XCTAssertTrue(capabilities.hasParentRole)
        XCTAssertTrue(capabilities.hasTeacherRole)
        XCTAssertTrue(capabilities.canAccessTeacherTools)
    }

    func testStaffRemainsDistinctFromAdmin() {
        let capabilities = UserRoleCapabilities.resolve(
            organizationRoleNames: ["staff"],
            hasParentProfile: false
        )

        XCTAssertEqual(capabilities.primaryRole, .staff)
        XCTAssertFalse(capabilities.canAccessTeacherTools)
    }

    func testParentCapabilityComesFromProfileNotOrganizationRole() {
        let capabilities = UserRoleCapabilities.resolve(
            organizationRoleNames: ["parent"],
            hasParentProfile: false
        )

        XCTAssertEqual(capabilities.primaryRole, .guest)
        XCTAssertFalse(capabilities.hasParentRole)
        XCTAssertFalse(capabilities.organizationRoles.contains(.parent))
    }
}
