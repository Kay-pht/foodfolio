import Foundation

struct IngredientDTO: Codable, Equatable, Sendable {
  let id: String
  let name: String
  let amount: String?
  let sortOrder: Int
}
struct RecipeStepDTO: Codable, Equatable, Sendable {
  let id: String
  let text: String
  let sortOrder: Int
}
struct TagDTO: Codable, Equatable, Sendable {
  let id: String
  let name: String
  let createdAt: Date
}
struct RecipeDTO: Codable, Equatable, Sendable {
  let id: String
  let originalUrl: String
  let sourceType: String
  let title: String
  let imageUrl: String?
  let servingsValue: Double?
  let servingsRaw: String?
  let cookingTimeMinutes: Int?
  let genre: String?
  let analysisStatus: AnalysisStatus
  let ingredients: [IngredientDTO]
  let steps: [RecipeStepDTO]
  let tags: [TagDTO]
  let createdAt: Date
  let updatedAt: Date
}
struct SyncResponse: Codable, Sendable {
  let recipes: [RecipeDTO]
  let tags: [TagDTO]
  let nextCursor: String
}
struct RecipeIDsResponse: Codable, Sendable { let recipeIds: [String] }
struct SettingDTO: Codable, Sendable { let recipeAnalysisNotificationEnabled: Bool }
struct AIConsentDTO: Codable, Sendable {
  let aiConsentedAt: Date?
}
