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
    try repository.upsert(dto)
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
    try repository.upsert(updated)
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
}

private struct TestTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "token" }
}
