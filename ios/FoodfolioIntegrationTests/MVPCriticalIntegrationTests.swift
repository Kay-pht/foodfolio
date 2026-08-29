import Foundation
import SwiftData
import XCTest

@testable import Foodfolio

@MainActor final class MVPCriticalIntegrationTests: XCTestCase {
  func testOfflineReadAndSearchRemainAvailableWhileMutationsKeepLocalState() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let images = try RecipeImageStore(root: root)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [OfflineURLProtocol.self]
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://offline.example")!,
        tokenProvider: MVPCriticalTokenProvider(),
        session: URLSession(configuration: configuration)),
      images: images)
    let date = Date()
    try repository.upsert(
      RecipeDTO(
        id: "offline-recipe", originalUrl: "https://example.com/offline", sourceType: "web",
        title: "鶏肉カレー", imageUrl: nil, servingsValue: 2, servingsRaw: "2人分",
        cookingTimeMinutes: 30, genre: "主菜", analysisStatus: .completed,
        ingredients: [
          IngredientDTO(id: "ingredient-chicken", name: "鶏肉", amount: "200g", sortOrder: 0),
          IngredientDTO(id: "ingredient-onion", name: "玉ねぎ", amount: "1個", sortOrder: 1),
        ], steps: [], tags: [TagDTO(id: "tag-easy", name: "簡単", createdAt: date)],
        createdAt: date, updatedAt: date))
    try await images.store(Data("image".utf8), recipeID: "offline-recipe")

    XCTAssertEqual(try repository.allRecipes().map(\.id), ["offline-recipe"])
    XCTAssertEqual(
      try repository.search(query: "鶏肉", genre: nil, tagID: nil).map(\.id), ["offline-recipe"])
    XCTAssertNotNil(await images.data(for: "offline-recipe"))

    do {
      try await repository.delete(id: "offline-recipe")
      XCTFail("Offline delete must fail")
    } catch {
      XCTAssertEqual(error as? APIError, .offline)
    }
    XCTAssertNotNil(try repository.recipe(id: "offline-recipe"))
    XCTAssertNotNil(await images.data(for: "offline-recipe"))
  }

  func testLocalSearchCoversTitleIngredientAndCombinedFiltersWithoutFalseMatches() throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let repository = try makeRepository(container: container)
    let date = Date()
    try repository.upsert(
      RecipeDTO(
        id: "search-a", originalUrl: "https://example.com/a", sourceType: "web", title: "鶏肉カレー",
        imageUrl: nil, servingsValue: nil, servingsRaw: nil, cookingTimeMinutes: nil, genre: "主菜",
        analysisStatus: .completed,
        ingredients: [IngredientDTO(id: "ia", name: "玉ねぎ", amount: nil, sortOrder: 0)],
        steps: [], tags: [TagDTO(id: "easy", name: "簡単", createdAt: date)], createdAt: date,
        updatedAt: date))
    try repository.upsert(
      RecipeDTO(
        id: "search-b", originalUrl: "https://example.com/b", sourceType: "web", title: "冷やしうどん",
        imageUrl: nil, servingsValue: nil, servingsRaw: nil, cookingTimeMinutes: nil, genre: "麺",
        analysisStatus: .completed,
        ingredients: [IngredientDTO(id: "ib", name: "鶏肉", amount: nil, sortOrder: 0)],
        steps: [], tags: [TagDTO(id: "summer", name: "夏", createdAt: date)], createdAt: date,
        updatedAt: date.addingTimeInterval(1)))

    XCTAssertEqual(try repository.search(query: "カレー", genre: nil, tagID: nil).map(\.id), ["search-a"])
    XCTAssertEqual(Set(try repository.search(query: "鶏肉", genre: nil, tagID: nil).map(\.id)), Set(["search-a", "search-b"]))
    XCTAssertEqual(try repository.search(query: "鶏肉 玉ねぎ", genre: nil, tagID: nil).map(\.id), ["search-a"])
    XCTAssertEqual(try repository.search(query: "", genre: .noodles, tagID: nil).map(\.id), ["search-b"])
    XCTAssertEqual(try repository.search(query: "", genre: nil, tagID: "easy").map(\.id), ["search-a"])
    XCTAssertEqual(try repository.search(query: "鶏肉", genre: .main, tagID: "easy").map(\.id), ["search-a"])
    XCTAssertTrue(try repository.search(query: "存在しない", genre: nil, tagID: nil).isEmpty)
  }

  func testRecipeDeletionReconciliationAndFullClearRemoveAssociatedImages() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let images = try RecipeImageStore(root: root)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: MVPCriticalTokenProvider()),
      images: images)
    let date = Date()
    for id in ["keep", "remove"] {
      try repository.upsert(
        RecipeDTO(
          id: id, originalUrl: "https://example.com/\(id)", sourceType: "web", title: id,
          imageUrl: nil, servingsValue: nil, servingsRaw: nil, cookingTimeMinutes: nil, genre: nil,
          analysisStatus: .completed, ingredients: [], steps: [], tags: [], createdAt: date,
          updatedAt: date))
      try await images.store(Data(id.utf8), recipeID: id)
    }

    try await repository.removeLocalRecipes(notIn: ["keep"])
    XCTAssertNotNil(try repository.recipe(id: "keep"))
    XCTAssertNil(try repository.recipe(id: "remove"))
    XCTAssertNotNil(await images.data(for: "keep"))
    XCTAssertNil(await images.data(for: "remove"))

    try await repository.clearLocalData()
    XCTAssertTrue(try repository.allRecipes().isEmpty)
    XCTAssertTrue(try repository.allTags().isEmpty)
    XCTAssertNil(await images.data(for: "keep"))
  }

  func testSyncDoesNotAdvanceCursorOrReconciliationTimestampWhenFetchFails() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let repository = try makeRepository(container: container)
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    defaults.set("existing-cursor", forKey: "recipeSyncCursor")
    let previousReconciliation = Date(timeIntervalSince1970: 1_000)
    defaults.set(previousReconciliation, forKey: "lastFullReconciliationAt")
    let service = RecipeSyncService(
      repository: repository,
      defaults: defaults,
      fetchSync: { _ in throw APIError.offline },
      fetchRecipeIDs: { XCTFail("ID reconciliation must not run"); return RecipeIDsResponse(recipeIds: []) })

    do {
      try await service.sync(now: previousReconciliation.addingTimeInterval(90_000))
      XCTFail("Sync must fail")
    } catch {
      XCTAssertEqual(error as? APIError, .offline)
    }
    XCTAssertEqual(defaults.string(forKey: "recipeSyncCursor"), "existing-cursor")
    XCTAssertEqual(defaults.object(forKey: "lastFullReconciliationAt") as? Date, previousReconciliation)
  }

  private func makeRepository(container: ModelContainer) throws -> RecipeRepository {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    return RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: MVPCriticalTokenProvider()),
      images: try RecipeImageStore(root: root))
  }
}

private struct MVPCriticalTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "token" }
}

private final class OfflineURLProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
  }
  override func stopLoading() {}
}
