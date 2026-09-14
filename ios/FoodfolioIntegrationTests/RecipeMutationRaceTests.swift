import Foundation
import SwiftData
import XCTest

@testable import Foodfolio

@MainActor final class RecipeMutationRaceTests: XCTestCase {
  func testLateMutationResponseDoesNotRestoreDeletedRecipe() async throws {
    let container = try ModelContainerFactory.make(inMemory: true)
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let repository = RecipeRepository(
      context: container.mainContext,
      api: APIClient(
        baseURL: URL(string: "https://example.invalid")!,
        tokenProvider: RecipeMutationRaceTokenProvider()),
      images: try RecipeImageStore(root: root))
    let createdAt = Date(timeIntervalSince1970: 1_800_000_000)

    try await repository.upsert(makeRecipe(createdAt: createdAt, wantToCookAt: nil))
    try await repository.removeLocalRecipes(notIn: [])

    do {
      _ = try await repository.applyMutationResponse(
        makeRecipe(createdAt: createdAt, wantToCookAt: createdAt.addingTimeInterval(60)))
      XCTFail("A late mutation response must not recreate a deleted recipe")
    } catch let error as APIError {
      XCTAssertEqual(error, .notFound)
    }

    XCTAssertNil(try repository.recipe(id: "race-recipe"))
    XCTAssertTrue(try repository.allRecipes().isEmpty)
  }

  private func makeRecipe(createdAt: Date, wantToCookAt: Date?) -> RecipeDTO {
    RecipeDTO(
      id: "race-recipe", originalUrl: "https://example.com/race", sourceType: "web",
      title: "親子丼", imageUrl: nil, servingsValue: 2, servingsRaw: "2人分",
      cookingTimeMinutes: 20, genre: "主菜", analysisStatus: .completed,
      wantToCookAt: wantToCookAt, ingredients: [], steps: [], tags: [], createdAt: createdAt,
      updatedAt: createdAt.addingTimeInterval(60))
  }
}

private struct RecipeMutationRaceTokenProvider: IDTokenProvider {
  func idToken() async throws -> String { "token" }
}
