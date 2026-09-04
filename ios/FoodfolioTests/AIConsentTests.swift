import XCTest

@testable import Foodfolio

@MainActor final class AIConsentTests: XCTestCase {
  func testConsentIsNotGrantedByDefault() {
    let store = AIConsentStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
    XCTAssertFalse(store.isGranted)
    XCTAssertNil(store.currentRecord)
  }

  func testConsentPersistsVersionAndTimestamp() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let consentedAt = Date(timeIntervalSince1970: 1_788_512_400)
    let store = AIConsentStore(defaults: defaults)
    store.grant(at: consentedAt)

    let restored = AIConsentStore(defaults: defaults)
    XCTAssertTrue(restored.isGranted)
    XCTAssertEqual(restored.currentRecord?.version, AIConsentStore.currentVersion)
    XCTAssertEqual(restored.currentRecord?.consentedAt, consentedAt)
  }

  func testOldDisclosureVersionNeedsNewConsent() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set(
      ["version": AIConsentStore.currentVersion - 1, "consentedAt": Date()],
      forKey: "aiProcessingConsent")
    XCTAssertFalse(AIConsentStore(defaults: defaults).isGranted)
  }

  func testRevocationRemovesPersistedConsent() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let store = AIConsentStore(defaults: defaults)
    store.grant()
    store.revoke()

    XCTAssertFalse(store.isGranted)
    XCTAssertFalse(AIConsentStore(defaults: defaults).isGranted)
    XCTAssertNil(defaults.object(forKey: "aiProcessingConsent"))
  }

  func testLegacyAccountScopedConsentIsNotAcceptedWithoutTimestamp() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set(
      ["userID": "legacy-user", "version": AIConsentStore.currentVersion],
      forKey: "aiProcessingConsent")
    XCTAssertFalse(AIConsentStore(defaults: defaults).isGranted)
  }
}
