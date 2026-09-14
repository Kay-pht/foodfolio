import Foundation
import SwiftData
import XCTest

@testable import Foodfolio

@MainActor final class RecipeMutationRaceTests: XCTestCase {
  func testLateMutationResponseDoesNotRestoreDeletedRecipe() async throws {
    let (container, repository) = try makeRepository()
    defer { withExtendedLifetime(container) {} }
    let createdAt = Date(timeIntervalSince1970: 1_800_000_000)
    try await repository.upsert(
      recipeDTO(createdAt: createdAt, updatedAt: createdAt.addingTimeInterval(30)))
    try await repository.removeLocalRecipes(notIn: [])

    do {
      _ = try await repository.applyMutationResponse(
        recipeDTO(
          createdAt: createdAt, updatedAt: createdAt.addingTimeInterval(60),
          wantToCookAt: createdAt.addingTimeInterval(60)))
      XCTFail("Mutation response recreated a removed recipe")
    } catch let error as APIError {
      XCTAssertEqual(error, .notFound)
    }
    XCTAssertNil(try repository.recipe(id: "race-recipe"))
  }

  func testOlderMutationResponseKeepsNewerSyncedState() async throws {
    let (container, repository) = try makeRepository()
    defer { withExtendedLifetime(container) {} }
    let createdAt = Date(timeIntervalSince1970: 1_800_000_000)
    let markDate = createdAt.addingTimeInterval(20)
    let newerUpdatedAt = createdAt.addingTimeInterval(120)

    try await repository.upsert(
      recipeDTO(
        createdAt: createdAt, updatedAt: newerUpdatedAt, status: .completed,
        wantToCookAt: markDate, title: "解析完了", ingredientName: "新しい材料"))

    let result = try await repository.applyMutationResponse(
      recipeDTO(
        createdAt: createdAt, updatedAt: createdAt.addingTimeInterval(60), status: .pending,
        wantToCookAt: markDate, title: "解析前", ingredientName: "古い材料"))

    XCTAssertEqual(result.updatedAt, newerUpdatedAt)
    XCTAssertEqual(result.analysisStatus, .completed)
    XCTAssertEqual(result.title, "解析完了")
    XCTAssertEqual(result.ingredients.map(\.name), ["新しい材料"])
    XCTAssertEqual(result.wantToCookAt, markDate)
  }

  private func makeRepository() throws -> (ModelContainer, RecipeRepository) {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!,
        tokenProvider: RecipeMutationRaceTokenProvider()),
      images: try RecipeImageStore(root: root))
    return (container, repository)
  }

  private func recipeDTO(
    createdAt: Date, updatedAt: Date, status: AnalysisStatus = .completed,
    wantToCookAt: Date? = nil, title: String = "親子丼", ingredientName: String = "鶏もも肉"
  ) -> RecipeDTO {
    RecipeDTO(
      id: "race-recipe", originalUrl: "https://example.com/race", sourceType: "web",
      title: title, imageUrl: nil, servingsValue: 2, servingsRaw: "2人分",
      cookingTimeMinutes: 20, genre: "主菜", analysisStatus: status,
      wantToCookAt: wantToCookAt,
      ingredients: [
        IngredientDTO(id: "race-ingredient", name: ingredientName, amount: "200g", sortOrder: 0)
      ], steps: [], tags: [], createdAt: createdAt, updatedAt: updatedAt)
  }
}

private struct RecipeMutationRaceTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "token" }
}
