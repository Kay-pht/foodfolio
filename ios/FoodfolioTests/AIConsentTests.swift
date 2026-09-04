import XCTest

@testable import Foodfolio

@MainActor final class AIConsentTests: XCTestCase {
  func testConsentIsNotGrantedByDefault() {
    let store = AIConsentStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
    XCTAssertFalse(store.isGranted(for: "user-a"))
    XCTAssertFalse(store.isGranted(for: nil))
    XCTAssertFalse(store.isGranted(for: ""))
  }

  func testConsentPersistsOnlyForTheSameAccount() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let store = AIConsentStore(defaults: defaults)
    store.grant(for: "user-a")
    let restored = AIConsentStore(defaults: defaults)
    XCTAssertTrue(restored.isGranted(for: "user-a"))
    XCTAssertFalse(restored.isGranted(for: "user-b"))
    XCTAssertFalse(restored.isGranted(for: nil))
  }

  func testOldDisclosureVersionNeedsNewConsent() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set(["userID": "user-a", "version": 0], forKey: "aiProcessingConsent")
    XCTAssertFalse(AIConsentStore(defaults: defaults).isGranted(for: "user-a"))
  }

  func testRevocationRemovesPersistedConsent() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let store = AIConsentStore(defaults: defaults)
    store.grant(for: "user-a")
    store.revoke()
    XCTAssertFalse(store.isGranted(for: "user-a"))
    XCTAssertFalse(AIConsentStore(defaults: defaults).isGranted(for: "user-a"))
    XCTAssertNil(defaults.object(forKey: "aiProcessingConsent"))
  }

  func testEmptyIdentityCannotGrantConsent() {
    let store = AIConsentStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
    store.grant(for: "")
    XCTAssertFalse(store.isGranted(for: ""))
  }
}
