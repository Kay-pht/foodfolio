import Foundation
import SwiftData
import XCTest

@testable import Foodfolio

@MainActor final class SyncMetadataTests: XCTestCase {
  func testClearMetadataRemovesCursorReconciliationAndTagRepairVersion() throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: SyncMetadataTokenProvider()
      ),
      images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set("cursor", forKey: "recipeSyncCursor")
    defaults.set(Date(), forKey: "lastFullReconciliationAt")
    defaults.set(1, forKey: "tagRelationshipRepairVersion")
    let service = RecipeSyncService(
      repository: repository,
      defaults: defaults,
      fetchSync: { _ in SyncResponse(recipes: [], tags: [], nextCursor: "unused") },
      fetchRecipeIDs: { RecipeIDsResponse(recipeIds: []) })

    service.clearMetadata()

    XCTAssertNil(defaults.string(forKey: "recipeSyncCursor"))
    XCTAssertNil(defaults.object(forKey: "lastFullReconciliationAt"))
    XCTAssertEqual(defaults.integer(forKey: "tagRelationshipRepairVersion"), 0)
  }

  func testReconciliationRestoresRecipeMissingLocallyAfterCursorAdvanced() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MissingRecipeSyncURLProtocol.self]
    MissingRecipeSyncURLProtocol.requestedPaths = []
    let api = APIClient(
      baseURL: URL(string: "https://example.invalid")!,
      tokenProvider: SyncMetadataTokenProvider(),
      session: URLSession(configuration: configuration))
    let repository = RecipeRepository(
      context: container.mainContext, api: api, images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set("advanced-cursor", forKey: "recipeSyncCursor")
    defaults.set(1, forKey: "tagRelationshipRepairVersion")
    defaults.set(1, forKey: "recipeCacheSchemaVersion")
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    defaults.set(now.addingTimeInterval(-90_000), forKey: "lastFullReconciliationAt")
    let service = RecipeSyncService(api: api, repository: repository, defaults: defaults)

    try await service.sync(now: now)

    let restored = try XCTUnwrap(repository.recipe(id: "11111111-1111-4111-8111-111111111111"))
    XCTAssertEqual(restored.title, "共有された親子丼")
    XCTAssertEqual(restored.sourceType, "chatgpt")
    XCTAssertEqual(defaults.string(forKey: "recipeSyncCursor"), "next-cursor")
    XCTAssertEqual(
      MissingRecipeSyncURLProtocol.requestedPaths,
      ["/v1/sync", "/v1/sync/recipe-ids", "/v1/recipes/batch-get"])
  }

  func testSessionStartReconciliationRunsOnlyOncePerServiceLifetime() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: SyncMetadataTokenProvider()
      ),
      images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    defaults.set("cursor", forKey: "recipeSyncCursor")
    defaults.set(now, forKey: "lastFullReconciliationAt")
    defaults.set(1, forKey: "tagRelationshipRepairVersion")
    defaults.set(1, forKey: "recipeCacheSchemaVersion")
    var idFetchCount = 0
    let service = RecipeSyncService(
      repository: repository,
      defaults: defaults,
      fetchSync: { _ in SyncResponse(recipes: [], tags: [], nextCursor: "next") },
      fetchRecipeIDs: {
        idFetchCount += 1
        return RecipeIDsResponse(recipeIds: [])
      })

    try await service.sync(now: now, reconciliation: .sessionStart)
    try await service.sync(now: now, reconciliation: .sessionStart)

    XCTAssertEqual(idFetchCount, 1)
  }

  func testForcedReconciliationRunsEvenWhenScheduledIntervalHasNotElapsed() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: SyncMetadataTokenProvider()
      ),
      images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    defaults.set("cursor", forKey: "recipeSyncCursor")
    defaults.set(now, forKey: "lastFullReconciliationAt")
    defaults.set(1, forKey: "tagRelationshipRepairVersion")
    defaults.set(1, forKey: "recipeCacheSchemaVersion")
    var idFetchCount = 0
    let service = RecipeSyncService(
      repository: repository,
      defaults: defaults,
      fetchSync: { _ in SyncResponse(recipes: [], tags: [], nextCursor: "next") },
      fetchRecipeIDs: {
        idFetchCount += 1
        return RecipeIDsResponse(recipeIds: [])
      })

    try await service.sync(now: now, reconciliation: .forced)
    try await service.sync(now: now, reconciliation: .forced)

    XCTAssertEqual(idFetchCount, 2)
  }

  func testScheduledReconciliationKeepsTwentyFourHourInterval() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: SyncMetadataTokenProvider()
      ),
      images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    defaults.set("cursor", forKey: "recipeSyncCursor")
    defaults.set(now, forKey: "lastFullReconciliationAt")
    defaults.set(1, forKey: "tagRelationshipRepairVersion")
    defaults.set(1, forKey: "recipeCacheSchemaVersion")
    var idFetchCount = 0
    let service = RecipeSyncService(
      repository: repository,
      defaults: defaults,
      fetchSync: { _ in SyncResponse(recipes: [], tags: [], nextCursor: "next") },
      fetchRecipeIDs: {
        idFetchCount += 1
        return RecipeIDsResponse(recipeIds: [])
      })

    try await service.sync(now: now)
    XCTAssertEqual(idFetchCount, 0)

    try await service.sync(now: now.addingTimeInterval(86_401))
    XCTAssertEqual(idFetchCount, 1)
  }

  func testMissingRecipeBatchFetchIsChunkedAtOneHundredIDs() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: SyncMetadataTokenProvider()
      ),
      images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set("cursor", forKey: "recipeSyncCursor")
    defaults.set(1, forKey: "tagRelationshipRepairVersion")
    defaults.set(1, forKey: "recipeCacheSchemaVersion")
    let serverIDs = (0..<205).map { String(format: "recipe-%03d", $0) }
    var batchSizes: [Int] = []
    let service = RecipeSyncService(
      repository: repository,
      defaults: defaults,
      fetchSync: { _ in SyncResponse(recipes: [], tags: [], nextCursor: "next") },
      fetchRecipeIDs: { RecipeIDsResponse(recipeIds: serverIDs) },
      fetchRecipes: { ids in
        batchSizes.append(ids.count)
        return RecipeBatchResponse(recipes: [])
      })

    try await service.sync(reconciliation: .forced)

    XCTAssertEqual(batchSizes, [100, 100, 5])
  }

  func testTagRelationshipRepairForcesFullSyncUntilItSucceeds() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: SyncMetadataTokenProvider()
      ),
      images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set("stale-cursor", forKey: "recipeSyncCursor")
    defaults.set(Date(), forKey: "lastFullReconciliationAt")
    var requestedPaths: [String] = []
    var attempt = 0
    let service = RecipeSyncService(
      repository: repository,
      defaults: defaults,
      fetchSync: { path in
        requestedPaths.append(path)
        attempt += 1
        if attempt == 1 { throw SyncMetadataTestError.expectedFailure }
        return SyncResponse(recipes: [], tags: [], nextCursor: "fresh-cursor")
      },
      fetchRecipeIDs: { RecipeIDsResponse(recipeIds: []) })

    do {
      try await service.sync()
      XCTFail("Expected the first repair sync to fail")
    } catch SyncMetadataTestError.expectedFailure {
      // Expected: a failed full sync must leave the repair pending.
    }
    XCTAssertEqual(requestedPaths, ["/v1/sync"])
    XCTAssertEqual(defaults.string(forKey: "recipeSyncCursor"), "stale-cursor")
    XCTAssertEqual(defaults.integer(forKey: "tagRelationshipRepairVersion"), 0)

    try await service.sync()
    XCTAssertEqual(requestedPaths, ["/v1/sync", "/v1/sync"])
    XCTAssertEqual(defaults.string(forKey: "recipeSyncCursor"), "fresh-cursor")
    XCTAssertEqual(defaults.integer(forKey: "tagRelationshipRepairVersion"), 1)

    try await service.sync()
    XCTAssertEqual(
      requestedPaths, ["/v1/sync", "/v1/sync", "/v1/sync?cursor=fresh-cursor"])
  }
}

private enum SyncMetadataTestError: Error {
  case expectedFailure
}

private struct SyncMetadataTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "token" }
}

private final class MissingRecipeSyncURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var requestedPaths: [String] = []

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let path = request.url?.path ?? ""
    Self.requestedPaths.append(path)
    let payload: String
    switch path {
    case "/v1/sync":
      payload = #"{"recipes":[],"tags":[],"nextCursor":"next-cursor"}"#
    case "/v1/sync/recipe-ids":
      payload = #"{"recipeIds":["11111111-1111-4111-8111-111111111111"]}"#
    case "/v1/recipes/batch-get":
      payload =
        #"{"recipes":[{"id":"11111111-1111-4111-8111-111111111111","originalUrl":"https://chatgpt.com/share/example","sourceType":"chatgpt","title":"共有された親子丼","imageUrl":null,"servingsValue":2,"servingsRaw":"2人分","cookingTimeMinutes":20,"genre":"主菜","analysisStatus":"completed","wantToCookAt":null,"ingredients":[],"steps":[],"tags":[],"createdAt":"2026-09-18T00:00:00Z","updatedAt":"2026-09-18T00:00:00Z"}]}"#
    default:
      payload = #"{"error":{"code":"NOT_FOUND","message":"not found"}}"#
    }
    let statusCode = path.hasPrefix("/v1/") ? 200 : 404
    let response = HTTPURLResponse(
      url: request.url!, statusCode: statusCode, httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(payload.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}
