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

  func testAPIErrorMapsBackendCodesToUserMessages() throws {
    let data = try XCTUnwrap(
      """
      {"error":{"code":"DUPLICATE_RECIPE","message":"duplicate","details":{"recipeId":"r1"},"requestId":"req"}}
      """.data(using: .utf8))
    let error = APIError.from(status: 409, data: data)
    XCTAssertEqual(error, .duplicateRecipe("r1"))
    XCTAssertEqual(error.userMessage, "このレシピはすでに保存されています。")
    XCTAssertEqual(APIError.from(status: 401, data: Data()), .unauthenticated)
  }
}

@MainActor final class AddRecipeViewModelTests: XCTestCase {
  func testSubmitValidatesURLAndMapsOfflineError() async {
    let model = AddRecipeViewModel()
    model.url = "ftp://example.com/recipe"
    let invalidResult = await model.submit { _ in XCTFail("Invalid URL must not be submitted") }
    XCTAssertFalse(invalidResult)
    XCTAssertEqual(model.errorMessage, APIError.invalidURL.userMessage)

    model.url = "https://example.com/recipe"
    let offlineResult = await model.submit { _ in throw APIError.offline }
    XCTAssertFalse(offlineResult)
    XCTAssertEqual(model.errorMessage, APIError.offline.userMessage)
    XCTAssertFalse(model.isSubmitting)
  }

  func testSubmitSucceedsForHTTPSURL() async {
    let model = AddRecipeViewModel()
    model.url = "https://example.com/recipe"
    var submittedURL: String?
    let result = await model.submit { submittedURL = $0 }
    XCTAssertTrue(result)
    XCTAssertEqual(submittedURL, model.url)
    XCTAssertNil(model.errorMessage)
  }
}

final class NotificationPresentationTests: XCTestCase {
  func testSettingsLinkRequiresAppEnabledAndOSDenied() {
    XCTAssertTrue(
      NotificationService.shouldShowOpenSettings(appNotificationEnabled: true, status: .denied))
    XCTAssertFalse(
      NotificationService.shouldShowOpenSettings(appNotificationEnabled: false, status: .denied))
    XCTAssertFalse(
      NotificationService.shouldShowOpenSettings(appNotificationEnabled: true, status: .authorized))
  }

  func testAlreadyAuthorizedNotificationsAreRegisteredAgainAtLogin() {
    XCTAssertTrue(NotificationService.shouldRegisterForRemoteNotifications(status: .authorized))
    XCTAssertTrue(NotificationService.shouldRegisterForRemoteNotifications(status: .provisional))
    XCTAssertFalse(NotificationService.shouldRegisterForRemoteNotifications(status: .denied))
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

  func testAppleAuthorizationCancellationStopsBackendAndCleanup() async {
    await assertAppleAuthorizationFailureStopsDeletion(.authorizationCancelled)
  }

  func testMissingAppleAuthorizationCodeStopsBackendAndCleanup() async {
    await assertAppleAuthorizationFailureStopsDeletion(.authorizationCodeMissing)
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

  func testNonAppleAccountDeletesBackendThenLocalState() async throws {
    let events = EventRecorder()
    let auth = FakeAuth(events: events, providers: ["password"])
    let service = AccountDeletionService(
      auth: auth, backend: FakeBackend(events: events), cleaner: FakeCleaner(events: events))
    try await service.deleteAccount()
    XCTAssertEqual(events.values, ["backend", "signout", "cleanup"])
  }

  private func assertAppleAuthorizationFailureStopsDeletion(_ error: FakeAppleAuthError) async {
    let events = EventRecorder()
    let auth = FakeAuth(events: events, providers: ["apple.com"], revokeError: error)
    let service = AccountDeletionService(
      auth: auth, backend: FakeBackend(events: events), cleaner: FakeCleaner(events: events))
    do {
      try await service.deleteAccount()
      XCTFail("Expected failure")
    } catch {}
    XCTAssertEqual(events.values, ["revoke"])
  }
}

@MainActor private final class EventRecorder { var values: [String] = [] }
private enum FakeAppleAuthError: Error { case authorizationCancelled, authorizationCodeMissing }
@MainActor private final class FakeAuth: AuthService {
  let events: EventRecorder
  let failRevoke: Bool
  let revokeError: Error?
  var currentUser: AuthenticatedUser?
  init(
    events: EventRecorder, providers: [String], failRevoke: Bool = false,
    revokeError: Error? = nil
  ) {
    self.events = events
    self.failRevoke = failRevoke
    self.revokeError = revokeError
    currentUser = AuthenticatedUser(uid: "u", email: nil, providers: providers)
  }
  func signIn(email: String, password: String) async throws {}
  func signUp(email: String, password: String) async throws {}
  func resetPassword(email: String) async throws {}
  func signInWithGoogle() async throws {}
  func signInWithApple() async throws {}
  func revokeAppleToken() async throws {
    events.values.append("revoke")
    if let revokeError { throw revokeError }
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
