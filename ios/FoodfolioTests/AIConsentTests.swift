import XCTest

@testable import Foodfolio

@MainActor final class AIConsentTests: XCTestCase {
  func testConsentIsNotGrantedByDefault() {
    let store = AIConsentStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
    XCTAssertFalse(store.isGranted)
    XCTAssertFalse(store.needsServerSync)
    XCTAssertNil(store.currentRecord)
  }

  func testExplicitConsentIsPendingOnlyForCurrentAppRun() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let consentedAt = Date(timeIntervalSince1970: 1_788_512_400)
    let store = AIConsentStore(defaults: defaults)
    store.grant(at: consentedAt)

    XCTAssertTrue(store.isGranted)
    XCTAssertTrue(store.needsServerSync)
    XCTAssertEqual(store.currentRecord?.consentedAt, consentedAt)

    let restored = AIConsentStore(defaults: defaults)
    XCTAssertFalse(restored.isGranted)
    XCTAssertFalse(restored.needsServerSync)
    XCTAssertNil(restored.currentRecord)
  }

  func testServerSynchronizationPersistsConfirmedConsentAndUsesServerTimestamp() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let localDate = Date(timeIntervalSince1970: 1_788_512_400)
    let serverDate = localDate.addingTimeInterval(30)
    let store = AIConsentStore(defaults: defaults)
    store.grant(at: localDate)

    store.markServerSynchronized(
      version: AIConsentStore.currentVersion,
      consentedAt: serverDate)

    let restored = AIConsentStore(defaults: defaults)
    XCTAssertTrue(restored.isGranted)
    XCTAssertFalse(restored.needsServerSync)
    XCTAssertEqual(restored.currentRecord?.consentedAt, serverDate)
  }

  func testMissingServerConsentRevokesStaleLocalConsent() {
    let store = AIConsentStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
    store.grant()

    store.markServerSynchronized(version: nil, consentedAt: nil)

    XCTAssertFalse(store.isGranted)
    XCTAssertFalse(store.needsServerSync)
    XCTAssertNil(store.currentRecord)
  }

  func testOldDisclosureVersionNeedsNewConsent() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set(
      [
        "version": AIConsentStore.currentVersion - 1,
        "consentedAt": Date(),
        "serverSynchronized": true,
      ],
      forKey: "aiProcessingConsent")
    XCTAssertFalse(AIConsentStore(defaults: defaults).isGranted)
  }

  func testRevocationRemovesPersistedConsent() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let store = AIConsentStore(defaults: defaults)
    store.grant()
    store.revoke()

    XCTAssertFalse(store.isGranted)
    XCTAssertFalse(store.needsServerSync)
    XCTAssertFalse(AIConsentStore(defaults: defaults).isGranted)
    XCTAssertNil(defaults.object(forKey: "aiProcessingConsent"))
  }

  func testLegacyAccountScopedConsentIsNotAcceptedWithoutTimestamp() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set(
      [
        "userID": "legacy-user",
        "version": AIConsentStore.currentVersion,
        "serverSynchronized": true,
      ],
      forKey: "aiProcessingConsent")
    XCTAssertFalse(AIConsentStore(defaults: defaults).isGranted)
  }
}
