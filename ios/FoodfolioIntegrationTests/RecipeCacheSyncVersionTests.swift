import Foundation
import SwiftData
import XCTest

@testable import Foodfolio

@MainActor final class RecipeCacheSyncVersionTests: XCTestCase {
  func testCacheSchemaUpgradeForcesFullSyncUntilSuccessAndClearsWithMetadata() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!,
        tokenProvider: RecipeCacheSyncTokenProvider()),
      images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set("stale-cursor", forKey: "recipeSyncCursor")
    defaults.set(Date(), forKey: "lastFullReconciliationAt")
    defaults.set(1, forKey: "tagRelationshipRepairVersion")
    var requestedPaths: [String] = []
    var attempt = 0
    let service = RecipeSyncService(
      repository: repository,
      defaults: defaults,
      fetchSync: { path in
        requestedPaths.append(path)
        attempt += 1
        if attempt == 1 { throw RecipeCacheSyncTestError.expectedFailure }
        return SyncResponse(recipes: [], tags: [], nextCursor: "fresh-cursor")
      },
      fetchRecipeIDs: { RecipeIDsResponse(recipeIds: []) })

    do {
      try await service.sync()
      XCTFail("Expected the first cache refresh sync to fail")
    } catch RecipeCacheSyncTestError.expectedFailure {
      // A failed full sync must leave the cache refresh pending.
    }
    XCTAssertEqual(requestedPaths, ["/v1/sync"])
    XCTAssertEqual(defaults.string(forKey: "recipeSyncCursor"), "stale-cursor")
    XCTAssertEqual(defaults.integer(forKey: "recipeCacheSchemaVersion"), 0)

    try await service.sync()
    XCTAssertEqual(requestedPaths, ["/v1/sync", "/v1/sync"])
    XCTAssertEqual(defaults.string(forKey: "recipeSyncCursor"), "fresh-cursor")
    XCTAssertEqual(defaults.integer(forKey: "recipeCacheSchemaVersion"), 1)

    try await service.sync()
    XCTAssertEqual(
      requestedPaths, ["/v1/sync", "/v1/sync", "/v1/sync?cursor=fresh-cursor"])

    service.clearMetadata()
    XCTAssertNil(defaults.string(forKey: "recipeSyncCursor"))
    XCTAssertEqual(defaults.integer(forKey: "recipeCacheSchemaVersion"), 0)
  }
}

private enum RecipeCacheSyncTestError: Error {
  case expectedFailure
}

private struct RecipeCacheSyncTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "token" }
}
