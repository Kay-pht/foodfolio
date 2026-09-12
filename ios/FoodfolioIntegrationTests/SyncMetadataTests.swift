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
