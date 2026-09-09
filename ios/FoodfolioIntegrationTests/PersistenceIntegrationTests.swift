import Foundation
import SwiftData
import XCTest

@testable import Foodfolio

@MainActor final class PersistenceIntegrationTests: XCTestCase {
  func testUpsertSearchAndHardDeleteReconciliation() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let imageStore = try RecipeImageStore(root: root)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: imageStore)
    let date = Date()
    let dto = RecipeDTO(
      id: "r1", originalUrl: "https://example.com", sourceType: "web", title: "鶏肉カレー",
      imageUrl: nil, servingsValue: 2, servingsRaw: "2人分", cookingTimeMinutes: 30, genre: "主菜",
      analysisStatus: .completed,
      ingredients: [IngredientDTO(id: "i1", name: "玉ねぎ", amount: "1個", sortOrder: 0)], steps: [],
      tags: [TagDTO(id: "t1", name: "簡単", createdAt: date)], createdAt: date, updatedAt: date)
    try await repository.upsert(dto)
    XCTAssertEqual(
      try repository.search(query: "鶏肉 玉ねぎ", genre: .main, tagID: "t1").map(\.id), ["r1"])
    XCTAssertTrue(try repository.search(query: "", genre: .main, tagID: nil).count == 1)
    let updated = RecipeDTO(
      id: "r1", originalUrl: "https://example.com", sourceType: "web", title: "更新後のカレー",
      imageUrl: nil, servingsValue: 4, servingsRaw: "4人分", cookingTimeMinutes: 25, genre: "主菜",
      analysisStatus: .completed,
      ingredients: [
        IngredientDTO(id: "i1", name: "玉ねぎ", amount: "2個", sortOrder: 0),
        IngredientDTO(id: "i2", name: "鶏肉", amount: "400g", sortOrder: 1),
      ], steps: [], tags: [TagDTO(id: "t1", name: "簡単", createdAt: date)], createdAt: date,
      updatedAt: date.addingTimeInterval(1))
    try await repository.upsert(updated)
    XCTAssertEqual(try repository.recipe(id: "r1")?.title, "更新後のカレー")
    XCTAssertEqual(try repository.recipe(id: "r1")?.ingredients.count, 2)
    try await repository.removeLocalRecipes(notIn: [])
    XCTAssertTrue(try repository.allRecipes().isEmpty)
  }

  func testImageStoreWritesReadsAndCleansUp() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let store = try RecipeImageStore(root: root)
    let data = Data("image".utf8)
    try await store.store(data, recipeID: "recipe")
    let storedData = await store.data(for: "recipe")
    XCTAssertEqual(storedData, data)
    try await store.remove(recipeID: "recipe")
    let removedData = await store.data(for: "recipe")
    XCTAssertNil(removedData)
  }

  func testImageURLChangeRetainsCachedImage() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let imageStore = try RecipeImageStore(root: root)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: imageStore)
    let date = Date()

    try await repository.upsert(
      makeRecipe(id: "recipe", date: date, imageUrl: "https://cdn.example.com/old.jpg"))
    try await imageStore.store(validPNGData, recipeID: "recipe")
    let cachedData = await imageStore.data(for: "recipe")
    let cachedBeforeUpdate = try XCTUnwrap(cachedData)

    try await repository.upsert(
      makeRecipe(id: "recipe", date: date, imageUrl: "https://cdn.example.com/new.jpg"))

    let cachedAfterUpdate = await imageStore.data(for: "recipe")
    XCTAssertEqual(cachedAfterUpdate, cachedBeforeUpdate)
  }

  func testImageURLChangeRejectsPendingOldURLImage() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let imageStore = try RecipeImageStore(root: root)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: imageStore)
    let date = Date()

    try await repository.upsert(
      makeRecipe(id: "recipe", date: date, imageUrl: "https://cdn.example.com/old.jpg"))
    let oldRequest = RecipeImageRequest(
      recipeID: "recipe", imageURL: "https://cdn.example.com/old.jpg",
      originalURL: "https://example.com/recipe")
    let fetchRecorder = RemoteImageFetchRecorder()
    let oldLoad = Task {
      await imageStore.remoteImage(for: oldRequest) {
        await fetchRecorder.fetch(validPNGData, delay: .seconds(10))
      }
    }
    await fetchRecorder.waitUntilStarted()

    try await repository.upsert(
      makeRecipe(id: "recipe", date: date, imageUrl: "https://cdn.example.com/new.jpg"))

    let oldImage = await oldLoad.value
    let stored = try await imageStore.store(try XCTUnwrap(oldImage), recipeID: "recipe")
    let cachedAfterUpdate = await imageStore.data(for: "recipe")
    XCTAssertFalse(stored)
    XCTAssertNil(cachedAfterUpdate)
  }

  func testConcurrentViewsShareRemoteLoadAndCanBothStoreItsResult() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let imageStore = try RecipeImageStore(root: root)
    let request = RecipeImageRequest(
      recipeID: "recipe", imageURL: "https://cdn.example.com/image.jpg",
      originalURL: "https://example.com/recipe")
    let fetchRecorder = RemoteImageFetchRecorder()

    async let first = imageStore.remoteImage(for: request) {
      await fetchRecorder.fetch(validPNGData, delay: .milliseconds(100))
    }
    async let second = imageStore.remoteImage(for: request) {
      await fetchRecorder.fetch(validPNGData, delay: .milliseconds(100))
    }
    let (firstImage, secondImage) = await (first, second)
    let fetchCount = await fetchRecorder.count
    let firstStored = try await imageStore.store(try XCTUnwrap(firstImage), recipeID: "recipe")
    let secondStored = try await imageStore.store(try XCTUnwrap(secondImage), recipeID: "recipe")
    let storedData = await imageStore.data(for: "recipe")

    XCTAssertEqual(fetchCount, 1)
    XCTAssertTrue(firstStored)
    XCTAssertTrue(secondStored)
    XCTAssertEqual(storedData, validPNGData)
  }

  func testRecipeRemovalRejectsPendingRemoteImage() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let imageStore = try RecipeImageStore(root: root)
    let request = RecipeImageRequest(
      recipeID: "recipe", imageURL: "https://cdn.example.com/image.jpg",
      originalURL: "https://example.com/recipe")
    let fetchRecorder = RemoteImageFetchRecorder()
    let remoteLoad = Task {
      await imageStore.remoteImage(for: request) {
        await fetchRecorder.fetch(validPNGData, delay: .seconds(10))
      }
    }
    await fetchRecorder.waitUntilStarted()

    try await imageStore.remove(recipeID: "recipe")

    let remoteImage = await remoteLoad.value
    let stored = try await imageStore.store(try XCTUnwrap(remoteImage), recipeID: "recipe")
    let storedData = await imageStore.data(for: "recipe")
    XCTAssertFalse(stored)
    XCTAssertNil(storedData)
  }

  func testDifferentialSyncPersistsCursorGlobalTagsAndReconcilesIDs() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!, tokenProvider: TestTokenProvider()),
      images: try RecipeImageStore(root: root))
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let date = Date()
    try await repository.upsert(makeRecipe(id: "local-only", date: date))
    var requestedPaths: [String] = []
    var responses = [
      SyncResponse(
        recipes: [makeRecipe(id: "server", date: date)],
        tags: [TagDTO(id: "unused-tag", name: "作り置き", createdAt: date)],
        nextCursor: "cursor-1"),
      SyncResponse(recipes: [], tags: [], nextCursor: "cursor-2"),
    ]
    var reconciliationCount = 0
    let service = RecipeSyncService(
      repository: repository, defaults: defaults,
      fetchSync: { path in
        requestedPaths.append(path)
        return responses.removeFirst()
      },
      fetchRecipeIDs: {
        reconciliationCount += 1
        return RecipeIDsResponse(recipeIds: ["server"])
      })

    try await service.sync(now: date)
    XCTAssertEqual(requestedPaths, ["/v1/sync"])
    XCTAssertEqual(defaults.string(forKey: "recipeSyncCursor"), "cursor-1")
    XCTAssertEqual(try repository.allRecipes().map(\.id), ["server"])
    XCTAssertEqual(try repository.allTags().map(\.id).sorted(), ["unused-tag"])

    try await service.sync(now: date.addingTimeInterval(60))
    XCTAssertEqual(requestedPaths, ["/v1/sync", "/v1/sync?cursor=cursor-1"])
    XCTAssertEqual(defaults.string(forKey: "recipeSyncCursor"), "cursor-2")
    XCTAssertEqual(reconciliationCount, 1)
  }
}

private let validPNGData = Data(
  base64Encoded:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)!

private func makeRecipe(id: String, date: Date, imageUrl: String? = nil) -> RecipeDTO {
  RecipeDTO(
    id: id, originalUrl: "https://example.com/\(id)", sourceType: "web", title: id,
    imageUrl: imageUrl, servingsValue: nil, servingsRaw: nil, cookingTimeMinutes: nil, genre: nil,
    analysisStatus: .completed, ingredients: [], steps: [], tags: [], createdAt: date,
    updatedAt: date)
}

private struct TestTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "token" }
}

private actor RemoteImageFetchRecorder {
  private(set) var count = 0

  func fetch(_ data: Data, delay: Duration) async -> Data {
    count += 1
    try? await Task.sleep(for: delay)
    return data
  }

  func waitUntilStarted() async {
    while count == 0 { await Task.yield() }
  }
}
