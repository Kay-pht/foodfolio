import Foundation
import SwiftData
import XCTest

@testable import Foodfolio

@MainActor final class SyncMetadataTests: XCTestCase {
  func testClearMetadataRemovesCursorAndReconciliationTimestamp() throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: SyncMetadataTokenProvider()),
      images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set("cursor", forKey: "recipeSyncCursor")
    defaults.set(Date(), forKey: "lastFullReconciliationAt")
    let service = RecipeSyncService(
      repository: repository,
      defaults: defaults,
      fetchSync: { _ in SyncResponse(recipes: [], tags: [], nextCursor: "unused") },
      fetchRecipeIDs: { RecipeIDsResponse(recipeIds: []) })

    service.clearMetadata()

    XCTAssertNil(defaults.string(forKey: "recipeSyncCursor"))
    XCTAssertNil(defaults.object(forKey: "lastFullReconciliationAt"))
  }
}

private struct SyncMetadataTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "token" }
}
