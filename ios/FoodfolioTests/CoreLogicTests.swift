import XCTest

@testable import Foodfolio

final class CoreLogicTests: XCTestCase {
  func testEveryRecipeGenreHasItsOwnBadgeColor() {
    let colors = RecipeGenre.allCases.map(\.badgeColor)
    XCTAssertEqual(colors.count, GenreBadgeColor.allCases.count)
    XCTAssertEqual(Set(colors.map(\.rawValue)).count, RecipeGenre.allCases.count)
  }

  func testAmountScalerScalesNumericAndFractionAmounts() {
    XCTAssertEqual(AmountScaler.scale("200g", multiplier: 2), "400g")
    XCTAssertEqual(AmountScaler.scale("大さじ2", multiplier: 1.5), "大さじ3")
    XCTAssertEqual(AmountScaler.scale("1/2個", multiplier: 2), "1個")
    XCTAssertEqual(AmountScaler.scale("少々", multiplier: 2), "少々")
  }

  func testAmountScalerPreservesOriginalFractionAtBaseServings() {
    XCTAssertEqual(AmountScaler.scale("1/6個", multiplier: 1), "1/6個")
    XCTAssertEqual(AmountScaler.scale("1/8個", multiplier: 1), "1/8個")
    XCTAssertEqual(AmountScaler.scale("小さじ1/3", multiplier: 1), "小さじ1/3")
  }

  func testAmountScalerScalesFractionsWithoutConvertingToDecimals() {
    XCTAssertEqual(AmountScaler.scale("1/6個", multiplier: 2), "1/3個")
    XCTAssertEqual(AmountScaler.scale("1/8個", multiplier: 2), "1/4個")
    XCTAssertEqual(AmountScaler.scale("小さじ1/3", multiplier: 2), "小さじ2/3")
    XCTAssertEqual(AmountScaler.scale("3/4個", multiplier: 2), "1と1/2個")
    XCTAssertEqual(AmountScaler.scale("1と1/2個", multiplier: 2), "3個")
    XCTAssertEqual(AmountScaler.scale("1/2個", multiplier: 1.0 / 3.0), "1/6個")
  }

  func testServingDisplayFormatterUsesJapaneseUnitForNumericServings() {
    XCTAssertEqual(ServingDisplayFormatter.text(value: 2, raw: "2 servings"), "2人分")
    XCTAssertEqual(ServingDisplayFormatter.text(value: 2, raw: "2人前"), "2人分")
    XCTAssertEqual(ServingDisplayFormatter.text(value: 1.5, raw: "1.5 servings"), "1.5人分")
  }

  func testServingDisplayFormatterNormalizesRecognizedRawUnitsOnly() {
    XCTAssertEqual(ServingDisplayFormatter.text(value: nil, raw: "1〜2人前"), "1〜2人分")
    XCTAssertEqual(ServingDisplayFormatter.text(value: nil, raw: "2〜3 servings"), "2〜3人分")
    XCTAssertEqual(ServingDisplayFormatter.text(value: nil, raw: "6個分"), "6個分")
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

  func testSearchHistoryRemovesOnlySelectedEntry() {
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let store = SearchHistoryStore(defaults: defaults, key: "test")
    store.add("残す履歴")
    store.add("削除する履歴")

    store.remove("削除する履歴")

    XCTAssertEqual(store.values, ["残す履歴"])
  }

  func testServingsControlIsHiddenWithoutRawServings() {
    XCTAssertEqual(
      RecipeDetailPresentation.servingsControl(raw: nil, base: nil, displayed: nil), .hidden)
  }

  func testServingsControlShowsNormalizedFixedTextWithoutNumericBase() {
    XCTAssertEqual(
      RecipeDetailPresentation.servingsControl(
        raw: "1〜2 servings", base: nil, displayed: nil),
      .fixed(text: "1〜2人分"))
  }

  func testServingsControlUsesBaseValueAndAllowsChangesWithinBounds() {
    XCTAssertEqual(
      RecipeDetailPresentation.servingsControl(raw: "2 servings", base: 2, displayed: nil),
      .adjustable(text: "2人分", canDecrease: true, canIncrease: true))
  }

  func testServingsControlDisablesDecreaseAtOnePersonBoundary() {
    XCTAssertEqual(
      RecipeDetailPresentation.servingsControl(raw: "1 serving", base: 1, displayed: 1),
      .adjustable(text: "1人分", canDecrease: false, canIncrease: true))
  }

  func testServingsControlDisablesIncreaseAtTwentyPersonBoundary() {
    XCTAssertEqual(
      RecipeDetailPresentation.servingsControl(raw: "20 servings", base: 20, displayed: 20),
      .adjustable(text: "20人分", canDecrease: true, canIncrease: false))
  }

  func testServingsUpdatesClampToSupportedBoundaries() {
    XCTAssertEqual(
      RecipeDetailPresentation.updatedServings(current: 1, base: 2, delta: -1), 1)
    XCTAssertEqual(
      RecipeDetailPresentation.updatedServings(current: 20, base: 2, delta: 1), 20)
    XCTAssertEqual(
      RecipeDetailPresentation.updatedServings(current: nil, base: 2, delta: 1), 3)
  }

  func testScaledAmountPreservesNonNumericValuesAndStartsFromBaseAmount() {
    XCTAssertEqual(
      RecipeDetailPresentation.scaledAmount("少々", base: 2, displayed: 3), "少々")
    XCTAssertEqual(
      RecipeDetailPresentation.scaledAmount("200g", base: 2, displayed: nil), "200g")
  }

  func testPendingAndProcessingRecipesCannotBeEdited() {
    XCTAssertFalse(RecipeDetailPresentation.canEdit(status: .pending))
    XCTAssertFalse(RecipeDetailPresentation.canEdit(status: .processing))
    XCTAssertTrue(RecipeDetailPresentation.canEdit(status: .completed))
    XCTAssertTrue(RecipeDetailPresentation.canEdit(status: .failed))
  }

  func testOnlyFailedRecipesShowAnalysisFailure() {
    XCTAssertFalse(RecipeDetailPresentation.showsAnalysisFailure(for: .pending))
    XCTAssertFalse(RecipeDetailPresentation.showsAnalysisFailure(for: .processing))
    XCTAssertFalse(RecipeDetailPresentation.showsAnalysisFailure(for: .completed))
    XCTAssertTrue(RecipeDetailPresentation.showsAnalysisFailure(for: .failed))
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

  func testAPIClientDoesNotSendJSONContentTypeWithEmptyDeleteBody() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [APIRequestCaptureURLProtocol.self]
    let session = URLSession(configuration: configuration)
    let client = APIClient(
      baseURL: URL(string: "https://api.example.test")!,
      tokenProvider: CoreLogicStaticTokenProvider(),
      session: session)

    try await client.sendWithoutResponse(
      "/v1/recipes/recipe-1", method: "DELETE", body: Optional<String>.none)

    let request = try XCTUnwrap(APIRequestCaptureURLProtocol.lastRequest)
    XCTAssertNil(request.value(forHTTPHeaderField: "Content-Type"))
    XCTAssertNil(request.httpBody)
  }

  func testGoogleOAuthClientMatchesRegisteredURLScheme() throws {
    let configURL = try XCTUnwrap(
      Bundle.main.url(forResource: "GoogleService-Info", withExtension: "plist"))
    let data = try Data(contentsOf: configURL)
    let config = try XCTUnwrap(
      PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
    let reversedClientID = try XCTUnwrap(config["REVERSED_CLIENT_ID"] as? String)
    let urlTypes = try XCTUnwrap(
      Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]])
    let schemes = urlTypes.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
    XCTAssertTrue(schemes.contains(reversedClientID))
  }
}

private struct CoreLogicStaticTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "test-token" }
}

private final class APIRequestCaptureURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var lastRequest: URLRequest?

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.lastRequest = request
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 204, httpVersion: "HTTP/1.1", headerFields: nil)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
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
