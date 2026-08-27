import XCTest

@testable import Foodfolio

final class CoreLogicTests: XCTestCase {
  func testAmountScalerScalesNumericAndFractionAmounts() {
    XCTAssertEqual(AmountScaler.scale("200g", multiplier: 2), "400g")
    XCTAssertEqual(AmountScaler.scale("大さじ2", multiplier: 1.5), "大さじ3")
    XCTAssertEqual(AmountScaler.scale("1/2個", multiplier: 2), "1個")
    XCTAssertEqual(AmountScaler.scale("少々", multiplier: 2), "少々")
  }

  func testSearchHistoryDeduplicatesAndCapsAtTen() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let store = SearchHistoryStore(defaults: defaults, key: "test")
    for value in 0..<12 { store.add("word\(value)") }
    store.add("word5")
    XCTAssertEqual(store.values.count, 10)
    XCTAssertEqual(store.values.first, "word5")
    XCTAssertEqual(store.values.filter { $0 == "word5" }.count, 1)
    store.removeAll()
    XCTAssertTrue(store.values.isEmpty)
  }
}

@MainActor final class AccountDeletionTests: XCTestCase {
  func testAppleAccountRevokesBeforeBackendAndCleanup() async throws {
    let events = EventRecorder()
    let auth = FakeAuth(events: events, providers: ["apple.com"])
    let service = AccountDeletionService(
      auth: auth, backend: FakeBackend(events: events), cleaner: FakeCleaner(events: events))
    try await service.deleteAccount()
    XCTAssertEqual(events.values, ["revoke", "backend", "signout", "cleanup"])
  }

  func testRevokeFailureStopsBackendAndCleanup() async {
    let events = EventRecorder()
    let auth = FakeAuth(events: events, providers: ["apple.com"], failRevoke: true)
    let service = AccountDeletionService(
      auth: auth, backend: FakeBackend(events: events), cleaner: FakeCleaner(events: events))
    do {
      try await service.deleteAccount()
      XCTFail("Expected failure")
    } catch {}
    XCTAssertEqual(events.values, ["revoke"])
  }

  func testNonAppleAccountSkipsRevokeAndBackendFailureKeepsLocalState() async {
    let events = EventRecorder()
    let auth = FakeAuth(events: events, providers: ["password"])
    let service = AccountDeletionService(
      auth: auth, backend: FakeBackend(events: events, fail: true),
      cleaner: FakeCleaner(events: events))
    do {
      try await service.deleteAccount()
      XCTFail("Expected failure")
    } catch {}
    XCTAssertEqual(events.values, ["backend"])
  }
}

@MainActor private final class EventRecorder { var values: [String] = [] }
@MainActor private final class FakeAuth: AuthService {
  let events: EventRecorder
  let failRevoke: Bool
  var currentUser: AuthenticatedUser?
  init(events: EventRecorder, providers: [String], failRevoke: Bool = false) {
    self.events = events
    self.failRevoke = failRevoke
    currentUser = AuthenticatedUser(uid: "u", email: nil, providers: providers)
  }
  func signIn(email: String, password: String) async throws {}
  func signUp(email: String, password: String) async throws {}
  func resetPassword(email: String) async throws {}
  func signInWithGoogle() async throws {}
  func signInWithApple() async throws {}
  func revokeAppleToken() async throws {
    events.values.append("revoke")
    if failRevoke { throw APIError.server }
  }
  func signOut() throws { events.values.append("signout") }
}
@MainActor private struct FakeBackend: AccountBackend {
  let events: EventRecorder
  var fail = false
  func deleteAccount() async throws {
    events.values.append("backend")
    if fail { throw APIError.server }
  }
}
@MainActor private struct FakeCleaner: LocalDataCleaner {
  let events: EventRecorder
  func clear() async throws { events.values.append("cleanup") }
}
